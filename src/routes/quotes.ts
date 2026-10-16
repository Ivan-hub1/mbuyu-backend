import { Router, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';
import { sendQuoteResponseEmail } from '../lib/email';

const router = Router();

const APP_URL = process.env.APP_URL || 'https://app.mbuyucfl.com';

// ─── Validation ────────────────────────────────────────────
const createQuoteSchema = z.object({
  fullName: z.string().min(2),
  companyName: z.string().optional().nullable(),
  email: z.string().email(),
  phone: z.string().min(5),
  preferredContact: z.string(),
  cargoType: z.string(),
  transportMode: z.string(),
  weightKg: z.string(),
  volumeCbm: z.string().optional().nullable(),
  pieces: z.string(),
  cargoDescription: z.string(),
  cargoValue: z.string().optional().nullable(),
  cargoValueCurrency: z.string().optional().nullable(),
  originCountry: z.string(),
  originCity: z.string(),
  destinationCountry: z.string(),
  destinationCity: z.string(),
  shippingDate: z.string(),
  incoterms: z.string(),
  specialRequirements: z.string().optional().nullable(),
  hasDocuments: z.boolean().optional().default(false),
});

const updateQuoteSchema = z.object({
  status: z
    .enum(['NEW', 'REVIEWING', 'QUOTED', 'ACCEPTED', 'REJECTED'])
    .optional(),
  quotedAmount: z.string().optional().nullable(),
  quotedCurrency: z.string().optional().nullable(),
  adminResponse: z.string().optional().nullable(),
  taxName: z.string().optional().nullable(),
  taxRate: z.string().optional().nullable(),
  taxAmount: z.string().optional().nullable(),
  sendEmailToCustomer: z.boolean().optional(),
});

// ═══════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════

// ─── POST /api/quotes — public quote request ─────────────
router.post('/', async (req, res) => {
  try {
    const parsed = createQuoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    const email = data.email.toLowerCase().trim();

    const quote = await prisma.quote.create({
      data: {
        ...data,
        email,
        status: 'NEW',
      },
    });

    res.status(201).json({
      reference: quote.reference,
      id: quote.id,
      message:
        'Your quote request has been received. We will respond within 24 hours.',
    });
  } catch (err) {
    console.error('[POST /quotes]', err);
    res.status(500).json({ error: 'Failed to submit quote' });
  }
});

// ═══════════════════════════════════════════════════════════
// AUTHENTICATED ROUTES
// ═══════════════════════════════════════════════════════════
router.use(requireAuth);

// ─── GET /api/quotes — admin list all ─────────────────────
router.get('/', requireRole('ADMIN'), async (_req: AuthRequest, res: Response) => {
  try {
    const quotes = await prisma.quote.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(quotes);
  } catch (err) {
    console.error('[GET /quotes]', err);
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

// ─── GET /api/quotes/my — customer's own quotes ───────────
router.get('/my', async (req: AuthRequest, res: Response) => {
  try {
    const quotes = await prisma.quote.findMany({
      where: { email: req.user!.email.toLowerCase() },
      orderBy: { createdAt: 'desc' },
    });
    res.json(quotes);
  } catch (err) {
    console.error('[GET /quotes/my]', err);
    res.status(500).json({ error: 'Failed to fetch your quotes' });
  }
});

// ─── GET /api/quotes/:id ──────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const quote = await prisma.quote.findUnique({ where: { id } });
    if (!quote) {
      res.status(404).json({ error: 'Quote not found' });
      return;
    }
    const user = req.user!;
    if (
      user.role !== 'ADMIN' &&
      quote.email.toLowerCase() !== user.email.toLowerCase()
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    res.json(quote);
  } catch (err) {
    console.error('[GET /quotes/:id]', err);
    res.status(500).json({ error: 'Failed to fetch quote' });
  }
});

// ─── PATCH /api/quotes/:id — admin responds ───────────────
router.patch(
  '/:id',
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;

      const parsed = updateQuoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }
      const data = parsed.data;
      const wantsEmail = data.sendEmailToCustomer === true;
      delete (data as any).sendEmailToCustomer;

      const existing = await prisma.quote.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: 'Quote not found' });
        return;
      }

      // If admin sets status to QUOTED or provides an amount and no invite exists, create one
      let inviteToken = existing.inviteToken;
      let inviteTokenSentAt = existing.inviteTokenSentAt;
      const willBeQuoted =
        data.status === 'QUOTED' || !!data.quotedAmount || !!data.adminResponse;

      if (willBeQuoted && !inviteToken) {
        inviteToken = crypto.randomBytes(24).toString('hex');
        inviteTokenSentAt = new Date();
      }

      const updated = await prisma.quote.update({
        where: { id },
        data: {
          ...(data.status !== undefined && { status: data.status }),
          ...(data.quotedAmount !== undefined && {
            quotedAmount: data.quotedAmount,
          }),
          ...(data.quotedCurrency !== undefined && {
            quotedCurrency: data.quotedCurrency,
          }),
          ...(data.adminResponse !== undefined && {
            adminResponse: data.adminResponse,
          }),
          ...(data.taxName !== undefined && { taxName: data.taxName }),
          ...(data.taxRate !== undefined && { taxRate: data.taxRate }),
          ...(data.taxAmount !== undefined && { taxAmount: data.taxAmount }),
          ...(data.status === 'QUOTED' && { respondedAt: new Date() }),
          ...(inviteToken && !existing.inviteToken && {
            inviteToken,
            inviteTokenSentAt,
          }),
        },
      });

      // Auto-send email when admin marks as QUOTED or asks to send
      const shouldEmail =
        wantsEmail ||
        (data.status === 'QUOTED' && updated.inviteToken && !existing.inviteToken);

      if (shouldEmail && updated.inviteToken) {
        sendQuoteResponseEmail({
          to: updated.email,
          fullName: updated.fullName,
          reference: updated.reference,
          quotedAmount: updated.quotedAmount,
          quotedCurrency: updated.quotedCurrency,
          taxName: updated.taxName,
          taxAmount: updated.taxAmount,
          adminResponse: updated.adminResponse,
          inviteToken: updated.inviteToken,
        }).catch((e) =>
          console.error('[quotes] quote-response email failed', e)
        );
      }

      res.json(updated);
    } catch (err) {
      console.error('[PATCH /quotes/:id]', err);
      res.status(500).json({ error: 'Failed to update quote' });
    }
  }
);

export default router;