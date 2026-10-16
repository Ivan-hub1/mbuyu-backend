import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireStaffRole, AuthRequest } from '../middleware/auth';

const router = Router();

// Roles allowed to view/manage transfers
router.use(requireAuth);
router.use(requireStaffRole('OPERATIONS', 'HEAD_OFFICE'));

// ─── GET /api/transfers — list all transfers ──────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { shipmentId, limit } = req.query;

    const where: any = {};
    if (shipmentId) where.shipmentId = String(shipmentId);

    const transfers = await prisma.shipmentTransfer.findMany({
      where,
      take: limit ? Number(limit) : 100,
      include: {
        shipment: {
          select: { id: true, trackingNumber: true, customerName: true },
        },
        oldJourney: {
          select: {
            id: true,
            vehicle: { select: { plate: true, type: true } },
          },
        },
        newJourney: {
          select: {
            id: true,
            status: true,
            vehicle: { select: { plate: true, type: true } },
          },
        },
        oldDriver: { select: { id: true, name: true, email: true, phone: true } },
        newDriver: { select: { id: true, name: true, email: true, phone: true } },
        initiatedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(transfers);
  } catch (err) {
    console.error('[GET /transfers]', err);
    res.status(500).json({ error: 'Failed to fetch transfers' });
  }
});

// ─── GET /api/transfers/shipment/:shipmentId ──────────────
router.get('/shipment/:shipmentId', async (req: AuthRequest, res: Response) => {
  try {
    const shipmentId = req.params.shipmentId as string;
    const transfers = await prisma.shipmentTransfer.findMany({
      where: { shipmentId },
      include: {
        oldDriver: { select: { id: true, name: true, email: true } },
        newDriver: { select: { id: true, name: true, email: true } },
        oldJourney: { include: { vehicle: { select: { plate: true } } } },
        newJourney: { include: { vehicle: { select: { plate: true } } } },
        initiatedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(transfers);
  } catch (err) {
    console.error('[GET /transfers/shipment/:shipmentId]', err);
    res.status(500).json({ error: 'Failed to fetch shipment transfers' });
  }
});

// ─── GET /api/transfers/:id ───────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const transfer = await prisma.shipmentTransfer.findUnique({
      where: { id },
      include: {
        shipment: true,
        oldJourney: {
          include: { vehicle: true, driver: { select: { name: true } } },
        },
        newJourney: {
          include: { vehicle: true, driver: { select: { name: true } } },
        },
        oldDriver: true,
        newDriver: true,
        initiatedBy: true,
      },
    });
    if (!transfer) {
      res.status(404).json({ error: 'Transfer not found' });
      return;
    }
    res.json(transfer);
  } catch (err) {
    console.error('[GET /transfers/:id]', err);
    res.status(500).json({ error: 'Failed to fetch transfer' });
  }
});

export default router;