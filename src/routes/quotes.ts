import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';
import {
  sendQuoteReceivedEmail,
  sendNewQuoteAdminEmail,
  sendQuoteResponseEmail,
} from '../lib/email';

const router = Router();

// ─── Validation schema ────────────────────────────────────
const quoteSchema = z.object({
  fullName: z.string().min(2),
  companyName: z.string().optional().nullable(),
  email: z.string().email(),
  phone: z.string().min(7),
  preferredContact: z.string().min(1),

  cargoType: z.string().min(1),
  transportMode: z.string().min(1),
  weightKg: z.string().min(1),
  volumeCbm: z.string().optional().nullable(),
  pieces: z.string().min(1),
  cargoDescription: z.string().min(5),
  cargoValue: z.string().optional().nullable(),
  cargoValueCurrency: z.string().optional().nullable(),

  originCountry: z.string().min(1),
  originCity: z.string().min(2),
  destinationCountry: z.string().min(1),
  destinationCity: z.string().min(2),
  shippingDate: z.string().min(1),
  incoterms: z.string().min(1),

  specialRequirements: z.string().optional().nullable(),
  hasDocuments: z.boolean().optional(),
});

const acceptQuoteSchema = z.object({
  assignedToId: z.string().optional().nullable(),
  weightKg: z.string().optional(),
  volumeCbm: z.string().optional().nullable(),
  pieces: z.string().optional(),
});

// ─── POST /api/quotes — create ────────────────────────────
router.post('/', async (req, res) => {
  try {
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    const reference = `Q-${new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const quote = await prisma.quote.create({
      data: {
        reference,
        fullName: data.fullName,
        companyName: data.companyName || null,
        email: data.email,
        phone: data.phone,
        preferredContact: data.preferredContact,
        cargoType: data.cargoType,
        transportMode: data.transportMode,
        weightKg: data.weightKg,
        volumeCbm: data.volumeCbm || null,
        pieces: data.pieces,
        cargoDescription: data.cargoDescription,
        cargoValue: data.cargoValue || null,
        cargoValueCurrency: data.cargoValueCurrency || null,
        originCountry: data.originCountry,
        originCity: data.originCity,
        destinationCountry: data.destinationCountry,
        destinationCity: data.destinationCity,
        shippingDate: data.shippingDate,
        incoterms: data.incoterms,
        specialRequirements: data.specialRequirements || null,
        hasDocuments: data.hasDocuments ?? false,
      },
    });

    sendQuoteReceivedEmail(
      quote.email,
      quote.fullName,
      quote.reference,
      quote.originCountry,
      quote.destinationCountry
    ).catch((err) => console.error('[quote received email]', err));

    sendNewQuoteAdminEmail(
      quote.reference,
      quote.fullName,
      quote.email,
      quote.cargoType,
      quote.originCountry,
      quote.destinationCountry
    ).catch((err) => console.error('[new quote admin email]', err));

    res.status(201).json(quote);
  } catch (err) {
    console.error('[POST /quotes]', err);
    res.status(500).json({ error: 'Failed to create quote' });
  }
});

// ─── GET /api/quotes — list all ───────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const quotes = await prisma.quote.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    res.json(quotes);
  } catch (err) {
    console.error('[GET /quotes]', err);
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

// ─── GET /api/quotes/:reference — public lookup ───────────
router.get('/:reference', async (req, res) => {
  try {
    const quote = await prisma.quote.findUnique({
      where: { reference: req.params.reference as string },
    });
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
  } catch (err) {
    console.error('[GET /quotes/:ref]', err);
    res.status(500).json({ error: 'Failed to fetch quote' });
  }
});

// ─── PATCH /api/quotes/:id — admin responds ───────────────
router.patch('/:id', async (req, res) => {
  try {
    const { status, quotedAmount, quotedCurrency, adminResponse } = req.body;

    const quote = await prisma.quote.update({
      where: { id: req.params.id as string },
      data: {
        ...(status && { status }),
        ...(quotedAmount !== undefined && { quotedAmount }),
        ...(quotedCurrency !== undefined && { quotedCurrency }),
        ...(adminResponse !== undefined && { adminResponse }),
        ...(status === 'QUOTED' && { respondedAt: new Date() }),
      },
    });

    if (
      quote.status === 'QUOTED' &&
      quote.quotedAmount &&
      quote.adminResponse
    ) {
      sendQuoteResponseEmail(
        quote.email,
        quote.fullName,
        quote.reference,
        quote.quotedAmount,
        quote.quotedCurrency || 'USD',
        quote.adminResponse
      ).catch((err) => console.error('[quote response email]', err));
    }

    res.json(quote);
  } catch (err) {
    console.error('[PATCH /quotes/:id]', err);
    res.status(500).json({ error: 'Failed to update quote' });
  }
});

// ─── POST /api/quotes/:id/accept — accept + create shipment
router.post(
  '/:id/accept',
  requireAuth,
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const quoteId = req.params.id as string;

      const parsed = acceptQuoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const { assignedToId, weightKg, volumeCbm, pieces } = parsed.data;

      const quote = await prisma.quote.findUnique({
        where: { id: quoteId },
      });
      if (!quote) {
        res.status(404).json({ error: 'Quote not found' });
        return;
      }

      if (quote.shipmentId) {
        res.status(400).json({ error: 'This quote already has a shipment' });
        return;
      }

      if (assignedToId) {
        const staffUser = await prisma.user.findUnique({
          where: { id: assignedToId },
        });
        if (
          !staffUser ||
          (staffUser.role !== 'STAFF' && staffUser.role !== 'ADMIN')
        ) {
          res.status(400).json({ error: 'User is not a staff member' });
          return;
        }
      }

      // Generate tracking number
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
      const trackingNumber = `${prefix}${String(nextNumber).padStart(5, '0')}`;

      const shipment = await prisma.shipment.create({
        data: {
          trackingNumber,
          reference: quote.reference,
          customerName: quote.fullName,
          customerEmail: quote.email,
          customerPhone: quote.phone,
          assignedToId: assignedToId || null,
          description: quote.cargoDescription,
          cargoType: quote.cargoType,
          weightKg: weightKg || quote.weightKg,
          volumeCbm: volumeCbm || quote.volumeCbm || null,
          pieces: pieces || quote.pieces,
          originCountry: quote.originCountry,
          originCity: quote.originCity,
          destinationCountry: quote.destinationCountry,
          destinationCity: quote.destinationCity,
          status: 'PENDING',
          events: {
            create: {
              status: 'PENDING',
              location: quote.originCity,
              note: `Shipment created from quote ${quote.reference}`,
              createdById: req.user!.userId,
            },
          },
        },
      });

      await prisma.quote.update({
        where: { id: quoteId },
        data: {
          shipmentId: shipment.id,
          status: 'ACCEPTED',
          respondedAt: new Date(),
        },
      });

      res.status(201).json({
        shipment,
        trackingNumber,
        message: 'Shipment created successfully',
      });
    } catch (err) {
      console.error('[POST /quotes/:id/accept]', err);
      res.status(500).json({ error: 'Failed to create shipment from quote' });
    }
  }
);

export default router;