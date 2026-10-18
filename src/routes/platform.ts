import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma, isRecordNotFound } from '../lib/prisma';
import {
  requireAuth,
  requireRole,
  invalidateSessions,
  AuthRequest,
} from '../middleware/auth';
import { runAsSystem, runWithTenant } from '../lib/tenantContext';
import { sendStaffInviteEmail } from '../lib/email';
import { resetPasswordAndSendInvite } from '../lib/invites';

// ═══════════════════════════════════════════════════════════
// PLATFORM — manage tenants (companies). SUPER_ADMIN only.
// These routes work across tenants, so they run as "system".
// ═══════════════════════════════════════════════════════════

const router = Router();

router.use(requireAuth);
router.use(requireRole('SUPER_ADMIN'));

// ─── Validation ────────────────────────────────────────────
const slugSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and dashes only');

const brandingSchema = {
  tagline: z.string().optional().nullable(),
  contactEmail: z.string().email().optional().nullable().or(z.literal('')),
  contactPhone: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
};

/** "" → null so cleared form fields are stored as empty */
function blanksToNull<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, v === '' ? null : v])
  ) as T;
}

const createTenantSchema = z.object({
  name: z.string().min(2),
  ...brandingSchema,
  slug: slugSchema,
  trackingPrefix: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z0-9]+$/, 'Use uppercase letters and numbers only'),
  admin: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
    phone: z.string().optional().nullable(),
  }),
});

const updateTenantSchema = z.object({
  name: z.string().min(2).optional(),
  isActive: z.boolean().optional(),
  ...brandingSchema,
});

// ─── GET /api/platform/tenants — list all companies ───────
router.get('/tenants', async (_req: AuthRequest, res: Response) => {
  try {
    const tenants = await runAsSystem(() =>
      prisma.tenant.findMany({
        include: {
          _count: { select: { users: true, shipments: true, vehicles: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    );
    res.json(tenants);
  } catch (err) {
    console.error('[GET /platform/tenants]', err);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

// ─── POST /api/platform/tenants — create company + its first admin ─
router.post('/tenants', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const { admin, ...company } = blanksToNull(parsed.data);
    const { slug, trackingPrefix } = company;

    const clash = await prisma.tenant.findFirst({
      where: { OR: [{ slug }, { trackingPrefix }] },
    });
    if (clash) {
      res.status(409).json({
        error:
          clash.slug === slug
            ? 'Company code already in use'
            : 'Tracking prefix already in use',
      });
      return;
    }

    const hashedPassword = await bcrypt.hash(admin.password, 10);

    const { tenant, user } = await runAsSystem(() =>
      prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({ data: company });
        const user = await tx.user.create({
          data: {
            tenantId: tenant.id,
            name: admin.name,
            email: admin.email.toLowerCase().trim(),
            password: hashedPassword,
            phone: admin.phone || null,
            role: 'ADMIN',
          },
          select: { id: true, email: true, name: true, role: true },
        });
        return { tenant, user };
      })
    );

    // Inside the new tenant's context so the email carries its branding
    runWithTenant(tenant.id, () =>
      sendStaffInviteEmail(user.email, user.name, admin.password, user.role)
    ).catch((err) => console.error('[tenant admin invite email]', err));

    res.status(201).json({ tenant, admin: user });
  } catch (err) {
    console.error('[POST /platform/tenants]', err);
    res.status(500).json({ error: 'Failed to create company' });
  }
});

// ─── PATCH /api/platform/tenants/:id — rename / (de)activate ─
router.patch('/tenants/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const parsed = updateTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    if (parsed.data.isActive === false && id === req.user!.tenantId) {
      res.status(400).json({ error: 'Cannot deactivate your own company' });
      return;
    }

    const tenant = await prisma.tenant.update({
      where: { id },
      data: blanksToNull(parsed.data),
    });
    invalidateSessions();
    res.json(tenant);
  } catch (err) {
    if (isRecordNotFound(err)) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    console.error('[PATCH /platform/tenants/:id]', err);
    res.status(500).json({ error: 'Failed to update company' });
  }
});

// ─── POST /api/platform/tenants/:id/resend-invite ────────
// New temporary password + login email for the company's first admin.
router.post('/tenants/:id/resend-invite', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const admin = await runAsSystem(() =>
      prisma.user.findFirst({
        where: { tenantId: id, role: 'ADMIN' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
    );
    if (!admin) {
      res.status(404).json({ error: 'This company has no admin user' });
      return;
    }
    // Inside the company's context so the email carries its branding
    const result = await runWithTenant(id, () => resetPasswordAndSendInvite(admin.id));
    res.json(result);
  } catch (err) {
    console.error('[POST /platform/tenants/:id/resend-invite]', err);
    res.status(500).json({ error: 'Failed to resend invite' });
  }
});

export default router;
