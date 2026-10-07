import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── Tracking number generator ────────────────────────────
async function generateTrackingNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `MBCFL-${year}-`;

  const latest = await prisma.shipment.findFirst({
    where: { trackingNumber: { startsWith: prefix } },
    orderBy: { trackingNumber: 'desc' },
  });

  let nextNumber = 1;
  if (latest) {
    const parts = latest.trackingNumber.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) nextNumber = lastNum + 1;
  }

  return `${prefix}${String(nextNumber).padStart(5, '0')}`;
}

// ─── Validation schemas ────────────────────────────────────
const createShipmentSchema = z.object({
  customerId: z.string().optional().nullable(),
  customerName: z.string().min(2),
  customerEmail: z.string().email(),
  customerPhone: z.string().min(7),
  assignedToId: z.string().optional().nullable(),
  description: z.string().min(3),
  cargoType: z.string().min(1),
  weightKg: z.string().min(1),
  volumeCbm: z.string().optional().nullable(),
  pieces: z.string().min(1),
  originCountry: z.string().min(1),
  originCity: z.string().min(1),
  destinationCountry: z.string().min(1),
  destinationCity: z.string().min(1),
  reference: z.string().optional().nullable(),
});

const updateShipmentSchema = z.object({
  customerName: z.string().min(2).optional(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().min(7).optional(),
  description: z.string().min(3).optional(),
  cargoType: z.string().min(1).optional(),
  weightKg: z.string().min(1).optional(),
  volumeCbm: z.string().optional().nullable(),
  pieces: z.string().min(1).optional(),
  originCountry: z.string().min(1).optional(),
  originCity: z.string().min(1).optional(),
  destinationCountry: z.string().min(1).optional(),
  destinationCity: z.string().min(1).optional(),
  reference: z.string().optional().nullable(),
  status: z.enum([
    'PENDING',
    'PICKED_UP',
    'IN_TRANSIT',
    'AT_CUSTOMS',
    'CUSTOMS_HOLD',
    'CUSTOMS_CLEARED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'EXCEPTION',
    'CANCELLED',
  ]).optional(),
});

const createEventSchema = z.object({
  status: z.enum([
    'PENDING',
    'PICKED_UP',
    'IN_TRANSIT',
    'AT_CUSTOMS',
    'CUSTOMS_HOLD',
    'CUSTOMS_CLEARED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'EXCEPTION',
    'CANCELLED',
  ]),
  location: z.string().min(1, 'Location is required'),
  note: z.string().optional().nullable(),
});

// ═══════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════

// ─── GET /api/shipments/track/:trackingNumber ─────────────
router.get('/track/:trackingNumber', async (req, res) => {
  try {
    const { trackingNumber } = req.params;

    const shipment = await prisma.shipment.findUnique({
      where: { trackingNumber: trackingNumber as string },
      include: {
        events: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            location: true,
            note: true,
            createdAt: true,
          },
        },
        documents: {
          select: {
            id: true,
            fileName: true,
            fileUrl: true,
            fileSize: true,
            mimeType: true,
            createdAt: true,
          },
        },
      },
    });

    if (!shipment) {
      res.status(404).json({ error: 'Tracking number not found' });
      return;
    }

    res.json({
      trackingNumber: shipment.trackingNumber,
      status: shipment.status,
      description: shipment.description,
      cargoType: shipment.cargoType,
      weightKg: shipment.weightKg,
      pieces: shipment.pieces,
      originCountry: shipment.originCountry,
      originCity: shipment.originCity,
      destinationCountry: shipment.destinationCountry,
      destinationCity: shipment.destinationCity,
      createdAt: shipment.createdAt,
      updatedAt: shipment.updatedAt,
      events: shipment.events,
      documents: shipment.documents,
    });
  } catch (err) {
    console.error('[GET /shipments/track/:num]', err);
    res.status(500).json({ error: 'Failed to fetch shipment' });
  }
});

// ═══════════════════════════════════════════════════════════
// AUTHENTICATED ROUTES
// ═══════════════════════════════════════════════════════════

router.use(requireAuth);

// ─── GET /api/shipments/mine — staff assignments ──────────
router.get('/mine', async (req: AuthRequest, res: Response) => {
  try {
    const shipments = await prisma.shipment.findMany({
      where: { assignedToId: req.user!.userId },
      include: {
        events: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { events: true, documents: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(shipments);
  } catch (err) {
    console.error('[GET /shipments/mine]', err);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// ─── POST /api/shipments — admin creates ──────────────────
router.post('/', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createShipmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    const trackingNumber = await generateTrackingNumber();

    const shipment = await prisma.shipment.create({
      data: {
        trackingNumber,
        reference: data.reference || null,
        customerId: data.customerId || null,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone,
        assignedToId: data.assignedToId || null,
        description: data.description,
        cargoType: data.cargoType,
        weightKg: data.weightKg,
        volumeCbm: data.volumeCbm || null,
        pieces: data.pieces,
        originCountry: data.originCountry,
        originCity: data.originCity,
        destinationCountry: data.destinationCountry,
        destinationCity: data.destinationCity,
        status: 'PENDING',
        events: {
          create: {
            status: 'PENDING',
            location: data.originCity,
            note: 'Shipment created',
            createdById: req.user!.userId,
          },
        },
      },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
      },
    });

    res.status(201).json(shipment);
  } catch (err) {
    console.error('[POST /shipments]', err);
    res.status(500).json({ error: 'Failed to create shipment' });
  }
});

// ─── GET /api/shipments — admin lists all ─────────────────
router.get('/', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { status, assignedToId, search } = req.query;

    const where: any = {};
    if (status) where.status = status;
    if (assignedToId) where.assignedToId = assignedToId;
    if (search) {
      where.OR = [
        { trackingNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    const shipments = await prisma.shipment.findMany({
      where,
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { events: true, documents: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(shipments);
  } catch (err) {
    console.error('[GET /shipments]', err);
    res.status(500).json({ error: 'Failed to fetch shipments' });
  }
});

// ─── GET /api/shipments/:id — admin/staff view one ────────
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const shipment = await prisma.shipment.findUnique({
      where: { id },
      include: {
        events: {
          orderBy: { createdAt: 'desc' },
          include: {
            createdBy: { select: { id: true, name: true, role: true } },
          },
        },
        documents: {
          include: {
            uploadedBy: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
        customer: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!shipment) {
      res.status(404).json({ error: 'Shipment not found' });
      return;
    }

    if (
      req.user!.role === 'STAFF' &&
      shipment.assignedToId !== req.user!.userId
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json(shipment);
  } catch (err) {
    console.error('[GET /shipments/:id]', err);
    res.status(500).json({ error: 'Failed to fetch shipment' });
  }
});

// ─── PATCH /api/shipments/:id — admin updates ─────────────
router.patch('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const parsed = updateShipmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;

    const shipment = await prisma.shipment.update({
      where: { id },
      data: {
        ...(data.customerName !== undefined && { customerName: data.customerName }),
        ...(data.customerEmail !== undefined && { customerEmail: data.customerEmail }),
        ...(data.customerPhone !== undefined && { customerPhone: data.customerPhone }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.cargoType !== undefined && { cargoType: data.cargoType }),
        ...(data.weightKg !== undefined && { weightKg: data.weightKg }),
        ...(data.volumeCbm !== undefined && { volumeCbm: data.volumeCbm || null }),
        ...(data.pieces !== undefined && { pieces: data.pieces }),
        ...(data.originCountry !== undefined && { originCountry: data.originCountry }),
        ...(data.originCity !== undefined && { originCity: data.originCity }),
        ...(data.destinationCountry !== undefined && { destinationCountry: data.destinationCountry }),
        ...(data.destinationCity !== undefined && { destinationCity: data.destinationCity }),
        ...(data.reference !== undefined && { reference: data.reference || null }),
        ...(data.status !== undefined && { status: data.status }),
      },
    });

    res.json(shipment);
  } catch (err) {
    console.error('[PATCH /shipments/:id]', err);
    res.status(500).json({ error: 'Failed to update shipment' });
  }
});

// ─── PATCH /api/shipments/:id/assign — admin assigns staff
router.patch('/:id/assign', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { assignedToId } = req.body;

    if (assignedToId) {
      const user = await prisma.user.findUnique({
        where: { id: assignedToId },
      });
      if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
        res.status(400).json({ error: 'User is not a staff member' });
        return;
      }
    }

    const shipment = await prisma.shipment.update({
      where: { id },
      data: { assignedToId: assignedToId || null },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

    await prisma.shipmentEvent.create({
      data: {
        shipmentId: shipment.id,
        status: shipment.status,
        location: shipment.originCity,
        note: assignedToId
          ? `Assigned to ${shipment.assignedTo?.name || 'staff'}`
          : 'Unassigned',
        createdById: req.user!.userId,
      },
    });

    res.json(shipment);
  } catch (err) {
    console.error('[PATCH /shipments/:id/assign]', err);
    res.status(500).json({ error: 'Failed to assign staff' });
  }
});

// ─── DELETE /api/shipments/:id — admin deletes ────────────
router.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.shipment.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /shipments/:id]', err);
    res.status(500).json({ error: 'Failed to delete shipment' });
  }
});

// ═══════════════════════════════════════════════════════════
// EVENT ROUTES
// ═══════════════════════════════════════════════════════════

// ─── POST /api/shipments/:id/events — add event ───────────
router.post(
  '/:id/events',
  requireRole('ADMIN', 'STAFF'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;

      const parsed = createEventSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const { status, location, note } = parsed.data;

      const shipment = await prisma.shipment.findUnique({
        where: { id },
      });
      if (!shipment) {
        res.status(404).json({ error: 'Shipment not found' });
        return;
      }

      if (
        req.user!.role === 'STAFF' &&
        shipment.assignedToId !== req.user!.userId
      ) {
        res.status(403).json({
          error: 'You can only update shipments assigned to you',
        });
        return;
      }

      const event = await prisma.shipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          status,
          location,
          note: note || null,
          createdById: req.user!.userId,
        },
        include: {
          createdBy: { select: { id: true, name: true, role: true } },
        },
      });

      await prisma.shipment.update({
        where: { id: shipment.id },
        data: { status },
      });

      res.status(201).json(event);
    } catch (err) {
      console.error('[POST /shipments/:id/events]', err);
      res.status(500).json({ error: 'Failed to create event' });
    }
  }
);

// ─── GET /api/shipments/:id/events — timeline ─────────────
router.get('/:id/events', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: { id: true, assignedToId: true },
    });
    if (!shipment) {
      res.status(404).json({ error: 'Shipment not found' });
      return;
    }

    if (
      req.user!.role === 'STAFF' &&
      shipment.assignedToId !== req.user!.userId
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const events = await prisma.shipmentEvent.findMany({
      where: { shipmentId: shipment.id },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(events);
  } catch (err) {
    console.error('[GET /shipments/:id/events]', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

export default router;