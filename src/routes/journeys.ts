import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireStaffRole, AuthRequest } from '../middleware/auth';
import { sendTransferEmail } from '../lib/email';

const router = Router();

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Validation ────────────────────────────────────────────
const startJourneySchema = z.object({
  vehicleId: z.string().min(1),
  checklistId: z.string().min(1),
  shipmentId: z.string().optional().nullable(),
  lat: z.number(),
  lng: z.number(),
  locationName: z.string().optional().nullable(),
});

const eventSchema = z.object({
  type: z.enum(['CHECKPOINT', 'STOP', 'INCIDENT', 'UPDATE', 'RESUMED', 'ENDED']),
  lat: z.number(),
  lng: z.number(),
  locationName: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  incidentReason: z.string().optional().nullable(),
  incidentSeverity: z.string().optional().nullable(),
  incidentDescription: z.string().optional().nullable(),
});

const transferSchema = z.object({
  newDriverId: z.string().min(1),
  newVehicleId: z.string().min(1),
  reason: z.enum([
    'BREAKDOWN',
    'ACCIDENT',
    'SECURITY_INCIDENT',
    'DRIVER_FATIGUE',
    'DRIVER_UNAVAILABLE',
    'ROUTE_BLOCKED',
    'OTHER',
  ]),
  reasonNote: z.string().optional().nullable(),
  cargoCondition: z.enum([
    'INTACT',
    'PARTIALLY_DAMAGED',
    'MISSING_ITEMS',
    'MAJOR_DAMAGE',
    'UNKNOWN',
  ]),
  cargoNotes: z.string().optional().nullable(),
  missingItems: z.string().optional().nullable(),
  damageNotes: z.string().optional().nullable(),
  photoUrls: z.array(z.string()).optional().default([]),
  lat: z.number(),
  lng: z.number(),
  locationName: z.string().optional().nullable(),
});

async function computeJourneyStats(journeyId: string) {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  });
  if (!journey) return null;

  const events = journey.events;
  const checkpoints = events.filter((e) => e.type === 'CHECKPOINT').length;
  const stops = events.filter((e) => e.type === 'STOP').length;
  const incidents = events.filter((e) => e.type === 'INCIDENT').length;
  const updates = events.filter((e) => e.type === 'UPDATE').length;

  let totalKm = 0;
  for (let i = 1; i < events.length; i++) {
    totalKm += distanceKm(
      events[i - 1].lat,
      events[i - 1].lng,
      events[i].lat,
      events[i].lng
    );
  }

  const startTime = journey.startedAt
    ? new Date(journey.startedAt).getTime()
    : new Date(events[0]?.createdAt ?? Date.now()).getTime();
  const endTime = journey.completedAt
    ? new Date(journey.completedAt).getTime()
    : Date.now();
  const durationHours = Math.max((endTime - startTime) / 3600_000, 0.001);
  const avgSpeed = totalKm / durationHours;

  return {
    totalKm: Number(totalKm.toFixed(2)),
    durationHours: Number(durationHours.toFixed(2)),
    avgSpeedKmh: Number(avgSpeed.toFixed(1)),
    checkpoints,
    stops,
    incidents,
    updates,
    eventCount: events.length,
  };
}

router.use(requireAuth);

// ═══════════════════════════════════════════════════════════
// TRANSFER
// ═══════════════════════════════════════════════════════════

router.post(
  '/:id/transfer',
  requireStaffRole('OPERATIONS', 'HEAD_OFFICE'),
  async (req: AuthRequest, res: Response) => {
    try {
      const oldJourneyId = req.params.id as string;

      const parsed = transferSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }
      const data = parsed.data;

      const oldJourney = await prisma.journey.findUnique({
        where: { id: oldJourneyId },
        include: { shipment: true },
      });
      if (!oldJourney) {
        res.status(404).json({ error: 'Journey not found' });
        return;
      }
      if (oldJourney.status !== 'IN_TRANSIT') {
        res.status(400).json({
          error: `Cannot transfer — journey status is ${oldJourney.status}`,
        });
        return;
      }
      if (!oldJourney.shipmentId) {
        res.status(400).json({
          error: 'This journey is not linked to a shipment',
        });
        return;
      }

      const newDriver = await prisma.user.findUnique({
        where: { id: data.newDriverId },
      });
      if (!newDriver) {
        res.status(404).json({ error: 'New driver not found' });
        return;
      }
      if (newDriver.role !== 'STAFF' || newDriver.staffRole !== 'DRIVER') {
        res.status(400).json({ error: 'Selected user is not a driver' });
        return;
      }
      if (newDriver.id === oldJourney.driverId) {
        res.status(400).json({
          error: 'New driver must be different from the current driver',
        });
        return;
      }

      const newVehicle = await prisma.vehicle.findUnique({
        where: { id: data.newVehicleId },
      });
      if (!newVehicle) {
        res.status(404).json({ error: 'New vehicle not found' });
        return;
      }
      if (newVehicle.status === 'OUT_OF_SERVICE') {
        res.status(400).json({ error: 'Selected vehicle is out of service' });
        return;
      }
      if (newVehicle.id === oldJourney.vehicleId) {
        res.status(400).json({
          error: 'New vehicle must be different from the current vehicle',
        });
        return;
      }

      const coords =
        data.locationName ||
        `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`;

      await prisma.journey.update({
        where: { id: oldJourneyId },
        data: {
          status: 'TRANSFERRED',
          completedAt: new Date(),
          isPaused: false,
        },
      });

      await prisma.journeyEvent.create({
        data: {
          journeyId: oldJourneyId,
          type: 'TRANSFERRED',
          lat: data.lat,
          lng: data.lng,
          locationName: data.locationName || null,
          note: `Journey transferred to ${newDriver.name} (${newVehicle.plate}). Reason: ${data.reason}${
            data.reasonNote ? ' — ' + data.reasonNote : ''
          }`,
          createdById: req.user!.userId,
        },
      });

      await prisma.vehicle.update({
        where: { id: oldJourney.vehicleId },
        data: { status: 'AVAILABLE' },
      });

      const newJourney = await prisma.journey.create({
        data: {
          driverId: newDriver.id,
          vehicleId: newVehicle.id,
          shipmentId: oldJourney.shipmentId,
          status: 'NOT_STARTED',
          transferredFromId: oldJourneyId,
          events: {
            create: {
              type: 'UPDATE',
              lat: data.lat,
              lng: data.lng,
              locationName: data.locationName || null,
              note: `Shipment handed over from ${oldJourney.driverId} to ${newDriver.name}. Reason: ${data.reason}`,
              createdById: req.user!.userId,
            },
          },
        },
      });

      const transfer = await prisma.shipmentTransfer.create({
        data: {
          shipmentId: oldJourney.shipmentId,
          oldJourneyId,
          newJourneyId: newJourney.id,
          initiatedById: req.user!.userId,
          oldDriverId: oldJourney.driverId,
          newDriverId: newDriver.id,
          newVehicleId: newVehicle.id,
          reason: data.reason,
          reasonNote: data.reasonNote || null,
          cargoCondition: data.cargoCondition,
          cargoNotes: data.cargoNotes || null,
          missingItems: data.missingItems || null,
          damageNotes: data.damageNotes || null,
          photoUrls: data.photoUrls.length
            ? JSON.stringify(data.photoUrls)
            : null,
          lat: data.lat,
          lng: data.lng,
          locationName: data.locationName || null,
        },
      });

      await prisma.shipmentEvent.create({
        data: {
          shipmentId: oldJourney.shipmentId,
          status: 'IN_TRANSIT',
          location: coords,
          note: `⚠️ Shipment transferred to a new vehicle at ${coords}. Reason: ${data.reason.replace(
            /_/g,
            ' '
          )}. Cargo condition: ${data.cargoCondition.replace(
            /_/g,
            ' '
          )}. The journey will resume shortly.`,
          createdById: req.user!.userId,
        },
      });

      sendTransferEmail({
        to: newDriver.email,
        driverName: newDriver.name,
        trackingNumber: oldJourney.shipment!.trackingNumber,
        vehiclePlate: newVehicle.plate,
        locationName: coords,
      }).catch((e) => console.error('[transfer email]', e));

      res.status(201).json({
        transfer,
        oldJourneyId,
        newJourneyId: newJourney.id,
        message:
          'Transfer complete. New driver must complete a fresh checklist before starting.',
      });
    } catch (err: any) {
      console.error('[POST /journeys/:id/transfer]', err);
      res.status(500).json({
        error: 'Failed to transfer journey',
        debug: err?.message || String(err),
        code: err?.code || null,
        meta: err?.meta || null,
      });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// START JOURNEY
// ═══════════════════════════════════════════════════════════

router.post(
  '/',
  requireStaffRole('DRIVER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = startJourneySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }
      const data = parsed.data;

      const checklist = await prisma.checklist.findUnique({
        where: { id: data.checklistId },
      });
      if (!checklist) {
        res.status(404).json({ error: 'Checklist not found' });
        return;
      }
      if (checklist.driverId !== req.user!.userId) {
        res.status(403).json({ error: 'This checklist belongs to another driver' });
        return;
      }
      if (checklist.status !== 'APPROVED' && checklist.status !== 'CLEARED') {
        res.status(400).json({ error: `Cannot start — checklist is ${checklist.status}` });
        return;
      }
      if (checklist.vehicleId !== data.vehicleId) {
        res.status(400).json({ error: 'Checklist does not match the selected vehicle' });
        return;
      }

      if (data.shipmentId) {
        const shipment = await prisma.shipment.findUnique({
          where: { id: data.shipmentId },
          select: { id: true, assignedToId: true },
        });
        if (!shipment) {
          res.status(404).json({ error: 'Shipment not found' });
          return;
        }
        if (shipment.assignedToId !== req.user!.userId) {
          res.status(403).json({ error: 'This shipment is not assigned to you' });
          return;
        }
      }

      const coords = data.locationName || `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`;

      const journey = await prisma.journey.create({
        data: {
          driverId: req.user!.userId,
          vehicleId: data.vehicleId,
          checklistId: data.checklistId,
          shipmentId: data.shipmentId || null,
          status: 'IN_TRANSIT',
          isPaused: false,
          startedAt: new Date(),
          events: {
            create: {
              type: 'STARTED',
              lat: data.lat,
              lng: data.lng,
              locationName: data.locationName || null,
              note: 'Journey has started',
              createdById: req.user!.userId,
            },
          },
        },
        include: { events: true },
      });

      await prisma.vehicle.update({
        where: { id: data.vehicleId },
        data: { status: 'ON_TRIP' },
      });

      if (data.shipmentId) {
        await prisma.shipmentEvent.create({
          data: {
            shipmentId: data.shipmentId,
            status: 'PICKED_UP',
            location: coords,
            note: 'Journey has started',
            createdById: req.user!.userId,
          },
        });
        await prisma.shipment.update({
          where: { id: data.shipmentId },
          data: { status: 'PICKED_UP' },
        });
      }

      res.status(201).json(journey);
    } catch (err: any) {
      console.error('[POST /journeys]', err);
      res.status(500).json({
        error: 'Failed to start journey',
        debug: err?.message || String(err),
        code: err?.code || null,
        meta: err?.meta || null,
      });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════

router.post(
  '/:id/events',
  requireStaffRole('DRIVER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;

      const parsed = eventSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }
      const data = parsed.data;

      const journey = await prisma.journey.findUnique({
        where: { id },
        include: { events: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      if (!journey) {
        res.status(404).json({ error: 'Journey not found' });
        return;
      }
      if (journey.driverId !== req.user!.userId) {
        res.status(403).json({ error: 'This journey belongs to another driver' });
        return;
      }
      if (journey.status !== 'IN_TRANSIT') {
        res.status(400).json({ error: 'Journey is not in transit' });
        return;
      }

      if (
        journey.isPaused &&
        data.type !== 'UPDATE' &&
        data.type !== 'RESUMED' &&
        data.type !== 'ENDED'
      ) {
        res.status(400).json({
          error:
            'Journey is paused due to a reported incident. Post an update or resume the journey before continuing.',
        });
        return;
      }

      const lastEvent = journey.events[0];
      const distanceFromLast = lastEvent
        ? distanceKm(lastEvent.lat, lastEvent.lng, data.lat, data.lng)
        : 0;

      const roundedKm = Math.round(distanceFromLast);
      const place =
        data.locationName || `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`;

      let finalNote = data.note || null;

      if (data.type === 'CHECKPOINT') {
        finalNote =
          finalNote ||
          `Reached checkpoint at ${place}, ${roundedKm} km since last stop`;
      } else if (data.type === 'STOP') {
        finalNote = `Stopped for a break at ${place}`;
      } else if (data.type === 'INCIDENT') {
        const reason = data.incidentReason || 'Unknown';
        const severity = data.incidentSeverity || 'moderate';
        const description = data.incidentDescription || '';
        finalNote = `⚠️ Incident reported at ${place} — ${reason} (${severity})${description ? ': ' + description : ''}`;
      } else if (data.type === 'UPDATE') {
        finalNote = finalNote || `Update posted at ${place}`;
      } else if (data.type === 'RESUMED') {
        finalNote = `Journey resumed from ${place}`;
      } else if (data.type === 'ENDED') {
        finalNote = finalNote || `Journey ended at ${place}`;
      }

      const event = await prisma.journeyEvent.create({
        data: {
          journeyId: id,
          type: data.type,
          lat: data.lat,
          lng: data.lng,
          locationName: data.locationName || null,
          note: finalNote,
          createdById: req.user!.userId,
        },
      });

      let newIsPaused = journey.isPaused;
      if (data.type === 'INCIDENT') newIsPaused = true;
      else if (data.type === 'RESUMED') newIsPaused = false;
      else if (data.type === 'ENDED') newIsPaused = false;

      if (newIsPaused !== journey.isPaused) {
        await prisma.journey.update({
          where: { id },
          data: { isPaused: newIsPaused },
        });
      }

      if (journey.shipmentId && data.type !== 'ENDED') {
        let shipmentStatus: any = 'IN_TRANSIT';
        if (data.type === 'INCIDENT') shipmentStatus = 'EXCEPTION';

        await prisma.shipmentEvent.create({
          data: {
            shipmentId: journey.shipmentId,
            status: shipmentStatus,
            location: place,
            note: finalNote || `${data.type} at ${place}`,
            createdById: req.user!.userId,
          },
        });

        if (data.type === 'INCIDENT') {
          await prisma.shipment.update({
            where: { id: journey.shipmentId },
            data: { status: 'EXCEPTION' },
          });
        } else if (data.type === 'RESUMED') {
          await prisma.shipment.update({
            where: { id: journey.shipmentId },
            data: { status: 'IN_TRANSIT' },
          });
        }
      }

      if (data.type === 'ENDED') {
        await prisma.journey.update({
          where: { id },
          data: { status: 'COMPLETED', completedAt: new Date(), isPaused: false },
        });
        await prisma.vehicle.update({
          where: { id: journey.vehicleId },
          data: { status: 'AVAILABLE' },
        });
        if (journey.shipmentId) {
          await prisma.shipmentEvent.create({
            data: {
              shipmentId: journey.shipmentId,
              status: 'DELIVERED',
              location: place,
              note: 'Cargo delivered',
              createdById: req.user!.userId,
            },
          });
          await prisma.shipment.update({
            where: { id: journey.shipmentId },
            data: { status: 'DELIVERED' },
          });
        }
      }

      const stats = await computeJourneyStats(id);

      res.status(201).json({
        event,
        distanceFromLastKm: Number(distanceFromLast.toFixed(2)),
        stats,
        isPaused: newIsPaused,
      });
    } catch (err: any) {
      console.error('[POST /journeys/:id/events]', err);
      res.status(500).json({
        error: 'Failed to record event',
        debug: err?.message || String(err),
        code: err?.code || null,
        meta: err?.meta || null,
      });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// LIVE FEED
// ═══════════════════════════════════════════════════════════

router.get(
  '/live',
  requireStaffRole('OPERATIONS', 'HEAD_OFFICE'),
  async (_req: AuthRequest, res: Response) => {
    try {
      const journeys = await prisma.journey.findMany({
        where: { status: 'IN_TRANSIT' },
        include: {
          driver: { select: { id: true, name: true, email: true, phone: true } },
          vehicle: { select: { id: true, plate: true, type: true } },
          shipment: {
            select: {
              id: true,
              trackingNumber: true,
              customerName: true,
              destinationCity: true,
              destinationCountry: true,
              originCity: true,
              originCountry: true,
            },
          },
          events: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { startedAt: 'desc' },
      });

      const enriched = await Promise.all(
        journeys.map(async (j) => {
          const stats = await computeJourneyStats(j.id);
          const lastEvent = j.events[0] || null;
          return {
            id: j.id,
            status: j.status,
            isPaused: j.isPaused,
            startedAt: j.startedAt,
            driver: j.driver,
            vehicle: j.vehicle,
            shipment: j.shipment,
            lastEvent: lastEvent
              ? {
                  type: lastEvent.type,
                  lat: lastEvent.lat,
                  lng: lastEvent.lng,
                  locationName: lastEvent.locationName,
                  note: lastEvent.note,
                  createdAt: lastEvent.createdAt,
                }
              : null,
            stats,
          };
        })
      );

      res.json(enriched);
    } catch (err: any) {
      console.error('[GET /journeys/live]', err);
      res.status(500).json({
        error: 'Failed to fetch live journeys',
        debug: err?.message || String(err),
        code: err?.code || null,
        meta: err?.meta || null,
      });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// OTHER
// ═══════════════════════════════════════════════════════════

router.get('/:id/stats', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const journey = await prisma.journey.findUnique({
      where: { id },
      select: { id: true, driverId: true, shipment: { select: { customerEmail: true } } },
    });
    if (!journey) {
      res.status(404).json({ error: 'Journey not found' });
      return;
    }
    const user = req.user!;
    const allowed =
      journey.driverId === user.userId ||
      user.role === 'ADMIN' ||
      user.staffRole === 'OPERATIONS' ||
      user.staffRole === 'HEAD_OFFICE' ||
      (journey.shipment && journey.shipment.customerEmail === user.email);
    if (!allowed) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const stats = await computeJourneyStats(id);
    res.json(stats);
  } catch (err: any) {
    console.error('[GET /journeys/:id/stats]', err);
    res.status(500).json({
      error: 'Failed to compute stats',
      debug: err?.message || String(err),
      code: err?.code || null,
      meta: err?.meta || null,
    });
  }
});

router.get(
  '/mine',
  requireStaffRole('DRIVER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const journeys = await prisma.journey.findMany({
        where: { driverId: req.user!.userId },
        include: {
          vehicle: { select: { id: true, plate: true, type: true } },
          events: { orderBy: { createdAt: 'desc' }, take: 1 },
          shipment: {
            select: { id: true, trackingNumber: true, destinationCity: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json(journeys);
    } catch (err: any) {
      console.error('[GET /journeys/mine]', err);
      res.status(500).json({
        error: 'Failed to fetch your journeys',
        debug: err?.message || String(err),
        code: err?.code || null,
        meta: err?.meta || null,
      });
    }
  }
);

router.get(
  '/active',
  requireStaffRole('OPERATIONS', 'HEAD_OFFICE'),
  async (_req: AuthRequest, res: Response) => {
    try {
      const journeys = await prisma.journey.findMany({
        where: { status: 'IN_TRANSIT' },
        include: {
          driver: { select: { id: true, name: true, email: true, phone: true } },
          vehicle: { select: { id: true, plate: true, type: true } },
          shipment: { select: { id: true, trackingNumber: true } },
          events: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { startedAt: 'desc' },
      });
      res.json(journeys);
    } catch (err: any) {
      console.error('[GET /journeys/active]', err);
      res.status(500).json({
        error: 'Failed to fetch active journeys',
        debug: err?.message || String(err),
        code: err?.code || null,
        meta: err?.meta || null,
      });
    }
  }
);

router.get(
  '/',
  requireStaffRole('OPERATIONS', 'HEAD_OFFICE'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { status, driverId } = req.query;
      const where: any = {};
      if (status) where.status = status;
      if (driverId) where.driverId = driverId;

      const journeys = await prisma.journey.findMany({
        where,
        include: {
          driver: { select: { id: true, name: true, email: true } },
          vehicle: { select: { id: true, plate: true, type: true } },
          shipment: { select: { id: true, trackingNumber: true } },
          _count: { select: { events: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json(journeys);
    } catch (err: any) {
      console.error('[GET /journeys]', err);
      res.status(500).json({
        error: 'Failed to fetch journeys',
        debug: err?.message || String(err),
        code: err?.code || null,
        meta: err?.meta || null,
      });
    }
  }
);

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const journey = await prisma.journey.findUnique({
      where: { id },
      include: {
        driver: { select: { id: true, name: true, email: true, phone: true } },
        vehicle: { select: { id: true, plate: true, type: true } },
        checklist: { include: { maintenanceTickets: true } },
        shipment: {
          select: { id: true, trackingNumber: true, customerEmail: true },
        },
        events: {
          orderBy: { createdAt: 'asc' },
          include: {
            createdBy: { select: { id: true, name: true, role: true } },
          },
        },
      },
    });

    if (!journey) {
      res.status(404).json({ error: 'Journey not found' });
      return;
    }

    const user = req.user!;
    const isOwnJourney = journey.driverId === user.userId;
    const isStaff =
      user.role === 'ADMIN' ||
      user.staffRole === 'OPERATIONS' ||
      user.staffRole === 'HEAD_OFFICE';
    const isCustomerOfShipment =
      journey.shipment && journey.shipment.customerEmail === user.email;

    if (!isOwnJourney && !isStaff && !isCustomerOfShipment) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json(journey);
  } catch (err: any) {
    console.error('[GET /journeys/:id]', err);
    res.status(500).json({
      error: 'Failed to fetch journey',
      debug: err?.message || String(err),
      code: err?.code || null,
      meta: err?.meta || null,
    });
  }
});

router.get('/:id/timeline', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const journey = await prisma.journey.findUnique({
      where: { id },
      select: {
        id: true,
        driverId: true,
        status: true,
        isPaused: true,
        startedAt: true,
        completedAt: true,
        vehicle: { select: { plate: true, type: true } },
        driver: { select: { name: true } },
        shipment: { select: { customerEmail: true, trackingNumber: true } },
      },
    });

    if (!journey) {
      res.status(404).json({ error: 'Journey not found' });
      return;
    }

    const user = req.user!;
    const isOwnJourney = journey.driverId === user.userId;
    const isStaff =
      user.role === 'ADMIN' ||
      user.staffRole === 'OPERATIONS' ||
      user.staffRole === 'HEAD_OFFICE';
    const isCustomerOfShipment =
      journey.shipment && journey.shipment.customerEmail === user.email;

    if (!isOwnJourney && !isStaff && !isCustomerOfShipment) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const events = await prisma.journeyEvent.findMany({
      where: { journeyId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        lat: true,
        lng: true,
        locationName: true,
        note: true,
        createdAt: true,
      },
    });

    res.json({
      journey: {
        id: journey.id,
        status: journey.status,
        isPaused: journey.isPaused,
        startedAt: journey.startedAt,
        completedAt: journey.completedAt,
        vehicle: journey.vehicle,
        driverName: journey.driver.name,
        shipmentTrackingNumber: journey.shipment?.trackingNumber || null,
      },
      events,
    });
  } catch (err: any) {
    console.error('[GET /journeys/:id/timeline]', err);
    res.status(500).json({
      error: 'Failed to fetch timeline',
      debug: err?.message || String(err),
      code: err?.code || null,
      meta: err?.meta || null,
    });
  }
});

export default router;