import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
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

// ─── POST /api/quotes — create a new quote request ────────
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

    // ─── Send emails (non-blocking) ───────────────────────
    // 1. Confirmation to customer
    sendQuoteReceivedEmail(
      quote.email,
      quote.fullName,
      quote.reference,
      quote.originCountry,
      quote.destinationCountry
    ).catch((err) => console.error('[quote received email]', err));

    // 2. Notification to admin
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

// ─── GET /api/quotes — list all quotes ────────────────────
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
      where: { reference: req.params.reference },
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
      where: { id: req.params.id },
      data: {
        ...(status && { status }),
        ...(quotedAmount !== undefined && { quotedAmount }),
        ...(quotedCurrency !== undefined && { quotedCurrency }),
        ...(adminResponse !== undefined && { adminResponse }),
        ...(status === 'QUOTED' && { respondedAt: new Date() }),
      },
    });

    // ─── Send quote response email (non-blocking) ─────────
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

export default router;