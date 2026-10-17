import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole, requireStaffRole, AuthRequest } from '../middleware/auth';
import { sendMaintenanceAlert } from '../lib/email';

const router = Router();

// ─── Validation ────────────────────────────────────────────
const createChecklistSchema = z.object({
  vehicleId: z.string().min(1),

  driverName: z.string().min(2),
  driverPermitNo: z.string().min(2),
  driverPermitClass: z.string().min(1),
  driverPermitExpiry: z.string().min(1), // ISO date string

  oilOk: z.boolean(),
  waterOk: z.boolean(),
  tyresOk: z.boolean(),
  brakesOk: z.boolean(),
  engineOk: z.boolean(),
  lightsOk: z.boolean(),
  hornOk: z.boolean(),
  mirrorsOk: z.boolean(),
  bodyOk: z.boolean(),

  issuesNotes: z.string().optional().nullable(),
});

// Human-readable labels for each check
const CHECK_LABELS: Record<string, string> = {
  oilOk: 'Oil level',
  waterOk: 'Water / coolant level',
  tyresOk: 'Tyre condition',
  brakesOk: 'Brake system',
  engineOk: 'Engine',
  lightsOk: 'Lights',
  hornOk: 'Horn',
  mirrorsOk: 'Mirrors',
  bodyOk: 'Body / structure',
};

// ═══════════════════════════════════════════════════════════
// ALL ROUTES REQUIRE AUTH
// ═══════════════════════════════════════════════════════════
router.use(requireAuth);

// ─── POST /api/checklists — driver submits ────────────────
router.post(
  '/',
  requireStaffRole('DRIVER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = createChecklistSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }
      const data = parsed.data;

      // Verify vehicle exists
      const vehicle = await prisma.vehicle.findUnique({
        where: { id: data.vehicleId },
      });
      if (!vehicle) {
        res.status(404).json({ error: 'Vehicle not found' });
        return;
      }
      if (vehicle.status === 'OUT_OF_SERVICE') {
        res.status(400).json({ error: 'Vehicle is out of service' });
        return;
      }

      // Determine which checks failed
      const failedChecks: string[] = [];
      (Object.keys(CHECK_LABELS) as (keyof typeof CHECK_LABELS)[]).forEach((key) => {
        if (data[key as keyof typeof data] === false) {
          failedChecks.push(CHECK_LABELS[key]);
        }
      });

      const hasIssues = failedChecks.length > 0;

      // Create checklist
      const checklist = await prisma.checklist.create({
        data: {
          driverId: req.user!.userId,
          vehicleId: data.vehicleId,
          driverName: data.driverName,
          driverPermitNo: data.driverPermitNo,
          driverPermitClass: data.driverPermitClass,
          driverPermitExpiry: new Date(data.driverPermitExpiry),
          oilOk: data.oilOk,
          waterOk: data.waterOk,
          tyresOk: data.tyresOk,
          brakesOk: data.brakesOk,
          engineOk: data.engineOk,
          lightsOk: data.lightsOk,
          hornOk: data.hornOk,
          mirrorsOk: data.mirrorsOk,
          bodyOk: data.bodyOk,
          issuesNotes: data.issuesNotes || null,
          status: hasIssues ? 'FLAGGED' : 'APPROVED',
        },
      });

      // If issues, create a maintenance ticket per failed check + update vehicle + email
      if (hasIssues) {
        await prisma.maintenanceTicket.createMany({
          data: failedChecks.map((issue) => ({
            checklistId: checklist.id,
            issue,
            status: 'OPEN',
          })),
        });

        await prisma.vehicle.update({
          where: { id: vehicle.id },
          data: { status: 'MAINTENANCE' },
        });

        // Alert this company's operations team (falls back to its admins)
        const opsUsers = await prisma.user.findMany({
          where: { isActive: true, role: 'STAFF', staffRole: 'OPERATIONS' },
          select: { email: true },
        });
        const recipients = opsUsers.length
          ? opsUsers
          : await prisma.user.findMany({
              where: { isActive: true, role: 'ADMIN' },
              select: { email: true },
            });

        // Fire-and-forget email — don't block the response
        sendMaintenanceAlert({
          recipients: recipients.map((u) => u.email),
          driverName: data.driverName,
          vehiclePlate: vehicle.plate,
          checklistId: checklist.id,
          issues: failedChecks,
          notes: data.issuesNotes,
        }).catch((e) => console.error('[checklists] email failed', e));
      }

      const full = await prisma.checklist.findUnique({
        where: { id: checklist.id },
        include: {
          vehicle: true,
          maintenanceTickets: true,
        },
      });

      res.status(201).json(full);
    } catch (err) {
      console.error('[POST /checklists]', err);
      res.status(500).json({ error: 'Failed to submit checklist' });
    }
  }
);

// ─── GET /api/checklists/mine — driver's own ──────────────
router.get(
  '/mine',
  requireStaffRole('DRIVER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const checklists = await prisma.checklist.findMany({
        where: { driverId: req.user!.userId },
        include: {
          vehicle: { select: { plate: true, type: true } },
          maintenanceTickets: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json(checklists);
    } catch (err) {
      console.error('[GET /checklists/mine]', err);
      res.status(500).json({ error: 'Failed to fetch your checklists' });
    }
  }
);

// ─── GET /api/checklists — admin/ops list ─────────────────
router.get(
  '/',
  requireRole('ADMIN', 'STAFF'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { status } = req.query;
      const where: any = {};
      if (status) where.status = status;

      const checklists = await prisma.checklist.findMany({
        where,
        include: {
          driver: { select: { id: true, name: true, email: true } },
          vehicle: { select: { id: true, plate: true, type: true } },
          maintenanceTickets: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json(checklists);
    } catch (err) {
      console.error('[GET /checklists]', err);
      res.status(500).json({ error: 'Failed to fetch checklists' });
    }
  }
);

// ─── GET /api/checklists/:id — full detail ────────────────
router.get(
  '/:id',
  requireRole('ADMIN', 'STAFF'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const checklist = await prisma.checklist.findUnique({
        where: { id },
        include: {
          driver: { select: { id: true, name: true, email: true } },
          vehicle: true,
          maintenanceTickets: {
            include: {
              assignedTo: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });
      if (!checklist) {
        res.status(404).json({ error: 'Checklist not found' });
        return;
      }
      res.json(checklist);
    } catch (err) {
      console.error('[GET /checklists/:id]', err);
      res.status(500).json({ error: 'Failed to fetch checklist' });
    }
  }
);

export default router;