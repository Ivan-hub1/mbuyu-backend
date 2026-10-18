import { Router, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import {
  sendQuoteResponseEmail,
  sendQuoteRejectedEmail,
  sendQuoteAcceptedEmail,
  trySendEmail,
} from '../lib/email';
import { generateQuotePdf } from '../lib/quotePdf';
import { currentBrand } from '../lib/brand';

const router = Router();

const APP_URL = process.env.APP_URL || 'https://app.mbuyucfl.com';

// ─── Helpers ───────────────────────────────────────────────
/** "" → null, undefined → undefined (so PATCH can distinguish "not provided" from "clear it") */
function blankToNull<T extends string | null | undefined>(v: T): T | null {
  if (v === undefined) return undefined as unknown as T;
  if (v === null) return null;
  const t = v.trim();
  return t === '' ? null : (t as T);
}

/** MB-XXXXXXXXXXXX — 12 hex chars. Adjust prefix/length to taste. */
function generateTrackingNumber(): string {
  return `MB-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

/** Accepts string | number | null | undefined and normalizes to trimmed string | null | undefined. */
function numOrStrToBlankString(
  v: string | number | null | undefined
): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

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

// ACCEPTED is intentionally absent — it may only be set via POST /:id/accept
const PATCHABLE_STATUSES = ['NEW', 'REVIEWING', 'QUOTED', 'REJECTED'] as const;

const updateQuoteSchema = z.object({
  status: z.enum(PATCHABLE_STATUSES).optional(),
  quotedAmount: z.union([z.string(), z.number()]).optional().nullable(),
  quotedCurrency: z.string().optional().nullable(),
  adminResponse: z.string().optional().nullable(),
  taxName: z.string().optional().nullable(),
  taxRate: z.union([z.string(), z.number()]).optional().nullable(),
  taxEnabled: z.boolean().optional(),
  sendEmailToCustomer: z.boolean().optional(),
});

const acceptQuoteSchema = z.object({
  assignedToId: z.string().nullable().optional(),
  weightKg: z.union([z.string(), z.number()]).optional(),
  volumeCbm: z.union([z.string(), z.number()]).nullable().optional(),
  pieces: z.union([z.string(), z.number()]).optional(),
  sendEmailToCustomer: z.boolean().optional().default(true),
});

// ═══════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════

// ─── POST /api/quotes — public quote request ─────────────
// The receiving company comes from X-Tenant / `tenant` (see resolveTenant).
router.post('/', resolveTenant, async (req, res) => {
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
      data: { ...data, email, status: 'NEW' },
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
// AUTHENTICATED ROUTES — everything below requires auth
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

// ─── GET /api/quotes/by-reference/:reference ──────────────
// Look up by human reference (e.g. "QT-2026-0042").
// MUST be registered ABOVE `/:id`, otherwise Express matches
// `/by-reference` as the `:id` segment and this route is unreachable.
router.get(
  '/by-reference/:reference',
  async (req: AuthRequest, res: Response) => {
    try {
      const reference = req.params.reference as string;
      const quote = await prisma.quote.findFirst({ where: { reference } });
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
      console.error('[GET /quotes/by-reference/:reference]', err);
      res.status(500).json({ error: 'Failed to fetch quote' });
    }
  }
);

// ─── POST /api/quotes/:id/accept — create shipment from quote ─
router.post(
  '/:id/accept',
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;

      const parsed = acceptQuoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }
      const body = parsed.data;

      const quote = await prisma.quote.findUnique({ where: { id } });
      if (!quote) {
        res.status(404).json({ error: 'Quote not found' });
        return;
      }

      if (quote.shipmentId) {
        res
          .status(409)
          .json({ error: 'Shipment already created for this quote' });
        return;
      }
      if (quote.status === 'REJECTED') {
        res.status(409).json({ error: 'This quote was rejected and cannot be accepted' });
        return;
      }

      if (body.assignedToId) {
        const staff = await prisma.user.findUnique({
          where: { id: body.assignedToId },
          select: { id: true, role: true },
        });
        if (!staff || !['STAFF', 'ADMIN', 'SUPER_ADMIN'].includes(staff.role)) {
          res.status(400).json({ error: 'Invalid assignee' });
          return;
        }
      }

      const weightKg = String(body.weightKg ?? quote.weightKg ?? '0');
      const pieces = String(body.pieces ?? quote.pieces ?? '1');
      const volumeCbm =
        body.volumeCbm !== undefined &&
        body.volumeCbm !== null &&
        body.volumeCbm !== ''
          ? String(body.volumeCbm)
          : quote.volumeCbm ?? null;

      const shipment = await prisma.$transaction(async (tx) => {
        const created = await tx.shipment.create({
          data: {
            trackingNumber: generateTrackingNumber(),
            customerName: quote.fullName,
            customerEmail: quote.email,
            customerPhone: quote.phone,
            reference: quote.reference,
            assignedToId: body.assignedToId ?? null,
            description: quote.cargoDescription,
            cargoType: quote.cargoType,
            weightKg,
            volumeCbm,
            pieces,
            originCountry: quote.originCountry,
            originCity: quote.originCity,
            destinationCountry: quote.destinationCountry,
            destinationCity: quote.destinationCity,
            status: 'PENDING',
          },
        });

        await tx.quote.update({
          where: { id: quote.id },
          data: {
            shipmentId: created.id,
            status: 'ACCEPTED',
            respondedAt: quote.respondedAt ?? new Date(),
          },
        });

        return created;
      });

      const email = body.sendEmailToCustomer
        ? await trySendEmail(() =>
            sendQuoteAcceptedEmail({
              to: quote.email,
              fullName: quote.fullName,
              reference: quote.reference,
              trackingNumber: shipment.trackingNumber,
              quotedAmount: quote.quotedAmount,
              quotedCurrency: quote.quotedCurrency,
              taxName: quote.taxName,
              taxAmount: quote.taxAmount,
              inviteToken: quote.inviteUsedAt ? null : quote.inviteToken,
            })
          )
        : { emailSent: false, emailError: null };

      res.status(201).json({
        trackingNumber: shipment.trackingNumber,
        shipmentId: shipment.id,
        quoteId: quote.id,
        _emailSent: email.emailSent,
        _emailError: email.emailError,
      });
    } catch (err) {
      console.error('[POST /quotes/:id/accept]', err);
      res.status(500).json({ error: 'Failed to create shipment from quote' });
    }
  }
);

// ─── POST /api/quotes/:id/resend-email ────────────────────
// Re-sends whichever email matches the quote's current status:
// ACCEPTED → shipment booked (tracking number), REJECTED → rejection,
// otherwise → "your quote is ready".
router.post(
  '/:id/resend-email',
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const quote = await prisma.quote.findUnique({
        where: { id },
        include: { shipment: { select: { trackingNumber: true } } },
      });
      if (!quote) {
        res.status(404).json({ error: 'Quote not found' });
        return;
      }

      let email;
      if (quote.status === 'ACCEPTED' && quote.shipment) {
        const trackingNumber = quote.shipment.trackingNumber;
        email = await trySendEmail(() =>
          sendQuoteAcceptedEmail({
            to: quote.email,
            fullName: quote.fullName,
            reference: quote.reference,
            trackingNumber,
            quotedAmount: quote.quotedAmount,
            quotedCurrency: quote.quotedCurrency,
            taxName: quote.taxName,
            taxAmount: quote.taxAmount,
            inviteToken: quote.inviteUsedAt ? null : quote.inviteToken,
          })
        );
      } else if (quote.status === 'REJECTED') {
        email = await trySendEmail(() =>
          sendQuoteRejectedEmail({
            to: quote.email,
            fullName: quote.fullName,
            reference: quote.reference,
            adminResponse: quote.adminResponse,
          })
        );
      } else if (quote.inviteToken) {
        const inviteToken = quote.inviteToken;
        email = await trySendEmail(() =>
          sendQuoteResponseEmail({
            to: quote.email,
            fullName: quote.fullName,
            reference: quote.reference,
            quotedAmount: quote.quotedAmount,
            quotedCurrency: quote.quotedCurrency,
            taxName: quote.taxName,
            taxAmount: quote.taxAmount,
            adminResponse: quote.adminResponse,
            inviteToken,
          })
        );
      } else {
        res.status(400).json({
          error: 'Nothing to send yet — add a quoted amount or response and save first',
        });
        return;
      }

      res.json({ to: quote.email, _emailSent: email.emailSent, _emailError: email.emailError });
    } catch (err) {
      console.error('[POST /quotes/:id/resend-email]', err);
      res.status(500).json({ error: 'Failed to resend email' });
    }
  }
);

// ─── GET /api/quotes/:id/pdf — branded quotation PDF ──────
router.get('/:id/pdf', async (req: AuthRequest, res: Response) => {
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

    const doc = generateQuotePdf(quote, await currentBrand());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Quote-${quote.reference}.pdf"`
    );
    doc.pipe(res);
  } catch (err) {
    console.error('[GET /quotes/:id/pdf]', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
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

      const existing = await prisma.quote.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: 'Quote not found' });
        return;
      }
      // (data.status can never be ACCEPTED — that only happens via /accept)
      if (existing.status === 'ACCEPTED' && data.status !== undefined) {
        res.status(409).json({
          error: 'This quote is already accepted and has a shipment — its status can no longer change',
        });
        return;
      }
      const nextStatus = data.status ?? existing.status;

      // ── Normalize ──────────────────────────────────────
      const quotedAmount = numOrStrToBlankString(data.quotedAmount);
      const quotedCurrency = blankToNull(data.quotedCurrency);
      const adminResponse = blankToNull(data.adminResponse);
      const taxName = blankToNull(data.taxName);
      const taxRateStr = numOrStrToBlankString(data.taxRate);
      const taxEnabled =
        data.taxEnabled ??
        (taxRateStr !== undefined ? taxRateStr !== null : undefined);

      // ── Server-side tax computation (never trust client) ──
      let taxAmount: string | null | undefined = undefined;
      if (taxEnabled !== undefined) {
        const baseNum =
          parseFloat(
            (quotedAmount ?? existing.quotedAmount ?? '0') as string
          ) || 0;
        const rateNum =
          parseFloat((taxRateStr ?? existing.taxRate ?? '0') as string) || 0;
        if (taxEnabled && rateNum > 0) {
          taxAmount = ((baseNum * rateNum) / 100).toFixed(2);
        } else {
          taxAmount = null;
        }
      }

      // ── Invite token ───────────────────────────────────
      const willBeQuoted =
        nextStatus !== 'REJECTED' &&
        (nextStatus === 'QUOTED' || !!quotedAmount || !!adminResponse);

      let inviteToken = existing.inviteToken;
      let inviteTokenSentAt = existing.inviteTokenSentAt;

      if (willBeQuoted && !inviteToken) {
        inviteToken = crypto.randomBytes(24).toString('hex');
        inviteTokenSentAt = new Date();
      }

      const updated = await prisma.quote.update({
        where: { id },
        data: {
          ...(data.status !== undefined && { status: data.status }),
          ...(quotedAmount !== undefined && { quotedAmount }),
          ...(quotedCurrency !== undefined && { quotedCurrency }),
          ...(adminResponse !== undefined && { adminResponse }),
          ...(taxName !== undefined && { taxName }),
          ...(taxRateStr !== undefined && { taxRate: taxRateStr }),
          ...(taxAmount !== undefined && { taxAmount }),
          ...(taxEnabled !== undefined && { taxEnabled }),
          ...((data.status === 'QUOTED' || data.status === 'REJECTED') && {
            respondedAt: new Date(),
          }),
          ...(inviteToken && !existing.inviteToken && {
            inviteToken,
            inviteTokenSentAt,
          }),
        },
      });

      // ── Email ──────────────────────────────────────────
      // The admin's "email customer" choice wins; if they didn't say, email
      // automatically when the quote moves into QUOTED or REJECTED.
      const statusChanged = updated.status !== existing.status;
      const shouldEmail =
        data.sendEmailToCustomer ??
        (statusChanged &&
          (updated.status === 'QUOTED' || updated.status === 'REJECTED'));

      let email = { emailSent: false, emailError: null as string | null };

      if (shouldEmail && updated.status === 'REJECTED') {
        email = await trySendEmail(() =>
          sendQuoteRejectedEmail({
            to: updated.email,
            fullName: updated.fullName,
            reference: updated.reference,
            adminResponse: updated.adminResponse,
          })
        );
      } else if (shouldEmail && updated.inviteToken) {
        const inviteToken = updated.inviteToken;
        email = await trySendEmail(() =>
          sendQuoteResponseEmail({
            to: updated.email,
            fullName: updated.fullName,
            reference: updated.reference,
            quotedAmount: updated.quotedAmount,
            quotedCurrency: updated.quotedCurrency,
            taxName: updated.taxName,
            taxAmount: updated.taxAmount,
            adminResponse: updated.adminResponse,
            inviteToken,
          })
        );
      }

      res.json({ ...updated, _emailSent: email.emailSent, _emailError: email.emailError });
    } catch (err) {
      console.error('[PATCH /quotes/:id]', err);
      res.status(500).json({ error: 'Failed to update quote' });
    }
  }
);

export default router;