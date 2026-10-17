import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { runAsSystem, runWithTenant } from '../lib/tenantContext';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = '7d';

// ─── Validation ────────────────────────────────────────────
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  phone: z.string().optional().nullable(),
  role: z.enum(['CUSTOMER', 'STAFF', 'ADMIN']).optional(),
  staffRole: z
    .enum(['HEAD_OFFICE', 'DRIVER', 'OPERATIONS'])
    .optional()
    .nullable(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Company code (tenant slug). Only needed when the same email + password
  // exists in more than one company.
  company: z.string().optional().nullable(),
});

const completeRegistrationSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(6),
  name: z.string().min(2),
  phone: z.string().min(5),
  companyName: z.string().optional().nullable(),
  tinNumber: z.string().optional().nullable(),
  ninNumber: z.string().optional().nullable(),
  passportNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  documentUrl: z.string().optional().nullable(),
});

// ─── Token helper ──────────────────────────────────────────
function signToken(user: {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  staffRole: string | null;
}) {
  return jwt.sign(
    {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
      staffRole: user.staffRole ?? null,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function publicTenant(tenant: { id: string; slug: string; name: string }) {
  return { id: tenant.id, slug: tenant.slug, name: tenant.name };
}

function publicUser(user: {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  staffRole: string | null;
  isActive: boolean;
  createdAt: Date;
  companyName?: string | null;
  tinNumber?: string | null;
  ninNumber?: string | null;
  passportNumber?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  registrationCompleted?: boolean;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    staffRole: user.staffRole,
    isActive: user.isActive,
    createdAt: user.createdAt,
    companyName: user.companyName ?? null,
    tinNumber: user.tinNumber ?? null,
    ninNumber: user.ninNumber ?? null,
    passportNumber: user.passportNumber ?? null,
    address: user.address ?? null,
    city: user.city ?? null,
    country: user.country ?? null,
    registrationCompleted: user.registrationCompleted ?? true,
  };
}

// ═══════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════

// ─── POST /api/auth/register ──────────────────────────────
// Self-service sign-up is for customers only. Staff and admins are created
// by their company admin (POST /api/admin/users).
router.post('/register', resolveTenant, async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password, name, phone, role } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();

    if (role && role !== 'CUSTOMER') {
      res.status(403).json({
        error: 'Staff and admin accounts are created by your company admin',
      });
      return;
    }

    const existing = await prisma.user.findFirst({
      where: { email: normalizedEmail },
    });
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        name,
        phone: phone || null,
        role: 'CUSTOMER',
        registrationCompleted: true,
      },
      include: { tenant: true },
    });

    res.status(201).json({
      token: signToken(user),
      user: publicUser(user),
      tenant: publicTenant(user.tenant),
    });
  } catch (err) {
    console.error('[POST /auth/register]', err);
    res.status(500).json({ error: 'Failed to register' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password, company } = parsed.data;
    const companySlug = company?.toLowerCase().trim() || null;

    // Login is where the tenant is decided, so look across all companies.
    const candidates = await runAsSystem(() =>
      prisma.user.findMany({
        where: {
          email: email.toLowerCase().trim(),
          ...(companySlug && { tenant: { slug: companySlug } }),
        },
        include: { tenant: true },
      })
    );

    const matches = [];
    for (const candidate of candidates) {
      if (await bcrypt.compare(password, candidate.password)) {
        matches.push(candidate);
      }
    }

    if (matches.length === 0) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    if (matches.length > 1) {
      res.status(409).json({
        error: 'This account exists in more than one company. Please enter your company code.',
        code: 'COMPANY_REQUIRED',
        companies: matches.map((m) => publicTenant(m.tenant)),
      });
      return;
    }

    const user = matches[0];
    if (!user.tenant.isActive) {
      res.status(403).json({ error: 'Company account is disabled' });
      return;
    }
    if (!user.isActive) {
      res.status(403).json({ error: 'Account is disabled' });
      return;
    }

    res.json({
      token: signToken(user),
      user: publicUser(user),
      tenant: publicTenant(user.tenant),
    });
  } catch (err) {
    console.error('[POST /auth/login]', err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// ─── GET /api/auth/invite/:token — fetch quote for signup ──
router.get('/invite/:token', async (req, res) => {
  try {
    const token = String(req.params.token);
    // Invite tokens are globally unique; the quote tells us the company.
    const quote = await runAsSystem(() =>
      prisma.quote.findUnique({
        where: { inviteToken: token },
        include: { tenant: true },
      })
    );

    if (!quote) {
      res.status(404).json({ error: 'Invalid or expired invite link' });
      return;
    }
    if (quote.inviteUsedAt) {
      res
        .status(410)
        .json({ error: 'This invite has already been used. Please log in instead.' });
      return;
    }

    res.json({
      reference: quote.reference,
      fullName: quote.fullName,
      email: quote.email,
      phone: quote.phone,
      companyName: quote.companyName,
      quotedAmount: quote.quotedAmount,
      quotedCurrency: quote.quotedCurrency,
      adminResponse: quote.adminResponse,
      tenant: publicTenant(quote.tenant),
    });
  } catch (err) {
    console.error('[GET /auth/invite/:token]', err);
    res.status(500).json({ error: 'Failed to load invite' });
  }
});

// ─── POST /api/auth/complete-registration ─────────────────
router.post('/complete-registration', async (req, res) => {
  try {
    const parsed = completeRegistrationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const d = parsed.data;

    // Require NIN or Passport
    if (!d.ninNumber?.trim() && !d.passportNumber?.trim()) {
      res.status(400).json({
        error: 'Please provide either a NIN number or a Passport number',
      });
      return;
    }

    const quote = await runAsSystem(() =>
      prisma.quote.findUnique({
        where: { inviteToken: d.token },
      })
    );
    if (!quote) {
      res.status(404).json({ error: 'Invalid invite token' });
      return;
    }
    if (quote.inviteUsedAt) {
      res.status(410).json({ error: 'Invite already used' });
      return;
    }

    // The new customer account belongs to the company that sent the quote.
    await runWithTenant(quote.tenantId, async () => {
      const email = quote.email.toLowerCase();
      const existing = await prisma.user.findFirst({ where: { email } });
      if (existing) {
        res
          .status(409)
          .json({ error: 'An account with this email already exists. Please log in.' });
        return;
      }

      const hashedPassword = await bcrypt.hash(d.password, 10);

      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          name: d.name,
          phone: d.phone,
          role: 'CUSTOMER',
          companyName: d.companyName || quote.companyName || null,
          tinNumber: d.tinNumber || null,
          ninNumber: d.ninNumber || null,
          passportNumber: d.passportNumber || null,
          address: d.address || null,
          city: d.city || null,
          country: d.country || null,
          documentUrl: d.documentUrl || null,
          registrationCompleted: true,
        },
        include: { tenant: true },
      });

      // Link quote to account
      await prisma.quote.update({
        where: { id: quote.id },
        data: {
          customerId: user.id,
          inviteUsedAt: new Date(),
        },
      });

      res.status(201).json({
        token: signToken(user),
        user: publicUser(user),
        tenant: publicTenant(user.tenant),
      });
    });
  } catch (err) {
    console.error('[POST /auth/complete-registration]', err);
    res.status(500).json({ error: 'Failed to complete registration' });
  }
});

// ═══════════════════════════════════════════════════════════
// AUTHENTICATED
// ═══════════════════════════════════════════════════════════
router.use(requireAuth);

router.get('/me', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { tenant: true },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ ...publicUser(user), tenant: publicTenant(user.tenant) });
  } catch (err) {
    console.error('[GET /auth/me]', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;