import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── Validation schemas ────────────────────────────────────
const createVehicleSchema = z.object({
  plate: z.string().min(2),
  type: z.enum(['Truck', 'Trailer', 'Van', 'Pickup', 'Other']),
  capacity: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updateVehicleSchema = z.object({
  plate: z.string().min(2).optional(),
  type: z.enum(['Truck', 'Trailer', 'Van', 'Pickup', 'Other']).optional(),
  capacity: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.enum(['AVAILABLE', 'ON_TRIP', 'MAINTENANCE', 'OUT_OF_SERVICE']).optional(),
});

// ═══════════════════════════════════════════════════════════
// ALL ROUTES REQUIRE AUTH
// ═══════════════════════════════════════════════════════════
router.use(requireAuth);

// ─── GET /api/vehicles — list all ─────────────────────────
router.get('/', requireRole('ADMIN', 'STAFF'), async (_req: AuthRequest, res: Response) => {
  try {
    const vehicles = await prisma.vehicle.findMany({
      include: {
        _count: { select: { checklists: true, journeys: true } },
      },
      orderBy: { plate: 'asc' },
    });
    res.json(vehicles);
  } catch (err) {
    console.error('[GET /vehicles]', err);
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
});

// ─── GET /api/vehicles/available — for driver checklist page ─
router.get('/available', requireRole('ADMIN', 'STAFF'), async (_req: AuthRequest, res: Response) => {
  try {
    const vehicles = await prisma.vehicle.findMany({
      where: { status: { in: ['AVAILABLE', 'ON_TRIP'] } },
      orderBy: { plate: 'asc' },
    });
    res.json(vehicles);
  } catch (err) {
    console.error('[GET /vehicles/available]', err);
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
});

// ─── GET /api/vehicles/:id — single vehicle ───────────────
router.get('/:id', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: {
        checklists: { orderBy: { createdAt: 'desc' }, take: 10 },
        journeys: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found' });
      return;
    }
    res.json(vehicle);
  } catch (err) {
    console.error('[GET /vehicles/:id]', err);
    res.status(500).json({ error: 'Failed to fetch vehicle' });
  }
});

// ─── POST /api/vehicles — admin creates ───────────────────
router.post('/', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createVehicleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const data = parsed.data;

    const existing = await prisma.vehicle.findUnique({ where: { plate: data.plate } });
    if (existing) {
      res.status(409).json({ error: 'A vehicle with this plate already exists' });
      return;
    }

    const vehicle = await prisma.vehicle.create({
      data: {
        plate: data.plate,
        type: data.type,
        capacity: data.capacity || null,
        notes: data.notes || null,
        status: 'AVAILABLE',
      },
    });

    res.status(201).json(vehicle);
  } catch (err) {
    console.error('[POST /vehicles]', err);
    res.status(500).json({ error: 'Failed to create vehicle' });
  }
});

// ─── PATCH /api/vehicles/:id — admin updates ──────────────
router.patch('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const parsed = updateVehicleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const data = parsed.data;

    const vehicle = await prisma.vehicle.update({
      where: { id },
      data: {
        ...(data.plate !== undefined && { plate: data.plate }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.capacity !== undefined && { capacity: data.capacity || null }),
        ...(data.notes !== undefined && { notes: data.notes || null }),
        ...(data.status !== undefined && { status: data.status }),
      },
    });

    res.json(vehicle);
  } catch (err) {
    console.error('[PATCH /vehicles/:id]', err);
    res.status(500).json({ error: 'Failed to update vehicle' });
  }
});

// ─── DELETE /api/vehicles/:id — admin deletes ─────────────
router.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.vehicle.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /vehicles/:id]', err);
    res.status(500).json({ error: 'Failed to delete vehicle' });
  }
});

export default router;