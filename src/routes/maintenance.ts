import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireStaffRole, AuthRequest } from '../middleware/auth';
import { sendChecklistCleared } from '../lib/mailer';

const router = Router();

// Photos come as base64 data URLs from the client camera.
// We cap the payload size to 5MB per photo (roughly ~3.5MB decoded).
const MAX_PHOTO_LENGTH = 5 * 1024 * 1024;

const startSchema = z.object({
  note: z.string().optional().nullable(),
});

const photoBeforeSchema = z.object({
  photo: z.string().min(100).max(MAX_PHOTO_LENGTH),
});

const photoAfterSchema = z.object({
  photo: z.string().min(100).max(MAX_PHOTO_LENGTH),
});

const resolveSchema = z.object({
  resolutionNote: z.string().min(3).max(2000),
});

router.use(requireAuth);
router.use(requireStaffRole('OPERATIONS'));

// ─── GET /api/maintenance — queue ─────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;
    const where: any = {};
    if (status) where.status = status;
    else where.status = { in: ['OPEN', 'IN_PROGRESS'] };

    const tickets = await prisma.maintenanceTicket.findMany({
      where,
      include: {
        checklist: {
          include: {
            vehicle: { select: { id: true, plate: true, type: true } },
            driver: { select: { id: true, name: true, email: true, phone: true } },
          },
        },
        assignedTo: { select: { id: true, name: true, email: true } },
        startedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(tickets);
  } catch (err) {
    console.error('[GET /maintenance]', err);
    res.status(500).json({ error: 'Failed to fetch maintenance queue' });
  }
});

// ─── GET /api/maintenance/mine — tickets I'm working on ───
router.get('/mine', async (req: AuthRequest, res: Response) => {
  try {
    const tickets = await prisma.maintenanceTicket.findMany({
      where: { startedById: req.user!.userId },
      include: {
        checklist: {
          include: {
            vehicle: { select: { plate: true, type: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(tickets);
  } catch (err) {
    console.error('[GET /maintenance/mine]', err);
    res.status(500).json({ error: 'Failed to fetch your tickets' });
  }
});

// ─── GET /api/maintenance/:id — single ticket full detail ─
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const ticket = await prisma.maintenanceTicket.findUnique({
      where: { id },
      include: {
        checklist: {
          include: {
            vehicle: true,
            driver: { select: { id: true, name: true, email: true, phone: true } },
            maintenanceTickets: true,
          },
        },
        assignedTo: { select: { id: true, name: true, email: true } },
        startedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    res.json(ticket);
  } catch (err) {
    console.error('[GET /maintenance/:id]', err);
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

// ─── PATCH /api/maintenance/:id/start — begin repair ──────
router.patch('/:id/start', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const ticket = await prisma.maintenanceTicket.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        assignedToId: req.user!.userId,
        startedById: req.user!.userId,
        startedAt: new Date(),
      },
      include: { checklist: true },
    });

    await prisma.checklist.update({
      where: { id: ticket.checklistId },
      data: { status: 'UNDER_REPAIR' },
    });

    res.json(ticket);
  } catch (err) {
    console.error('[PATCH /maintenance/:id/start]', err);
    res.status(500).json({ error: 'Failed to start ticket' });
  }
});

// ─── PATCH /api/maintenance/:id/photo-before ─────────────
router.patch('/:id/photo-before', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const parsed = photoBeforeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Photo invalid or too large (max ~5MB)',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const ticket = await prisma.maintenanceTicket.findUnique({
      where: { id },
    });
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    if (ticket.status !== 'IN_PROGRESS') {
      res.status(400).json({ error: 'Start the repair before taking the before photo' });
      return;
    }
    if (ticket.startedById !== req.user!.userId && req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Only the assigned technician can take photos' });
      return;
    }

    const updated = await prisma.maintenanceTicket.update({
      where: { id },
      data: {
        photoBefore: parsed.data.photo,
        photoBeforeTakenAt: new Date(),
      },
    });

    res.json({
      id: updated.id,
      photoBeforeTakenAt: updated.photoBeforeTakenAt,
      // Don't return the full photo back — saves bandwidth
      hasPhotoBefore: true,
    });
  } catch (err) {
    console.error('[PATCH /maintenance/:id/photo-before]', err);
    res.status(500).json({ error: 'Failed to save before photo' });
  }
});

// ─── PATCH /api/maintenance/:id/photo-after ──────────────
router.patch('/:id/photo-after', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const parsed = photoAfterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Photo invalid or too large (max ~5MB)',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const ticket = await prisma.maintenanceTicket.findUnique({
      where: { id },
    });
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    if (ticket.status !== 'IN_PROGRESS') {
      res.status(400).json({ error: 'Ticket is not in progress' });
      return;
    }
    if (ticket.startedById !== req.user!.userId && req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Only the assigned technician can take photos' });
      return;
    }
    if (!ticket.photoBefore) {
      res.status(400).json({ error: 'Take the BEFORE photo first' });
      return;
    }

    const updated = await prisma.maintenanceTicket.update({
      where: { id },
      data: {
        photoAfter: parsed.data.photo,
        photoAfterTakenAt: new Date(),
      },
    });

    res.json({
      id: updated.id,
      photoAfterTakenAt: updated.photoAfterTakenAt,
      hasPhotoAfter: true,
    });
  } catch (err) {
    console.error('[PATCH /maintenance/:id/photo-after]', err);
    res.status(500).json({ error: 'Failed to save after photo' });
  }
});

// ─── PATCH /api/maintenance/:id/resolve ──────────────────
router.patch('/:id/resolve', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const existing = await prisma.maintenanceTicket.findUnique({
      where: { id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    if (!existing.photoBefore) {
      res.status(400).json({ error: 'Before photo is required before resolving' });
      return;
    }
    if (!existing.photoAfter) {
      res.status(400).json({ error: 'After photo is required before resolving' });
      return;
    }

    const ticket = await prisma.maintenanceTicket.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolutionNote: parsed.data.resolutionNote,
        resolvedAt: new Date(),
      },
      include: { checklist: true },
    });

    // Check if all tickets for this checklist are resolved
    const remaining = await prisma.maintenanceTicket.count({
      where: {
        checklistId: ticket.checklistId,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
      },
    });

    if (remaining === 0) {
      const checklist = await prisma.checklist.update({
        where: { id: ticket.checklistId },
        data: { status: 'CLEARED' },
        include: {
          driver: { select: { email: true, name: true } },
          vehicle: { select: { plate: true } },
        },
      });

      await prisma.vehicle.update({
        where: { id: checklist.vehicleId },
        data: { status: 'AVAILABLE' },
      });

      sendChecklistCleared({
        driverEmail: checklist.driver.email,
        driverName: checklist.driver.name,
        vehiclePlate: checklist.vehicle.plate,
        checklistId: checklist.id,
      }).catch((e) => console.error('[maintenance] email failed', e));
    }

    res.json(ticket);
  } catch (err) {
    console.error('[PATCH /maintenance/:id/resolve]', err);
    res.status(500).json({ error: 'Failed to resolve ticket' });
  }
});

export default router;