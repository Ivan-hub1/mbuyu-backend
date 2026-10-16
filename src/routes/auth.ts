import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';

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
  email: string;
  role: string;
  staffRole: string | null;
}) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      staffRole: user.staffRole ?? null,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
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
router.post('/register', async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password, name, phone, role, staffRole } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const normalizedStaffRole =
      role === 'STAFF' && staffRole ? staffRole : null;

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        name,
        phone: phone || null,
        role: role || 'CUSTOMER',
        staffRole: normalizedStaffRole,
        registrationCompleted: true,
      },
    });

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      staffRole: user.staffRole,
    });

    res.status(201).json({ token, user: publicUser(user) });
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

    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    if (!user.isActive) {
      res.status(403).json({ error: 'Account is disabled' });
      return;
    }

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      staffRole: user.staffRole,
    });

    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('[POST /auth/login]', err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// ─── GET /api/auth/invite/:token — fetch quote for signup ──
router.get('/invite/:token', async (req, res) => {
  try {
    const token = String(req.params.token);
    const quote = await prisma.quote.findUnique({
      where: { inviteToken: token },
    });

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

    const quote = await prisma.quote.findUnique({
      where: { inviteToken: d.token },
    });
    if (!quote) {
      res.status(404).json({ error: 'Invalid invite token' });
      return;
    }
    if (quote.inviteUsedAt) {
      res.status(410).json({ error: 'Invite already used' });
      return;
    }

    const email = quote.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
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
    });

    // Link quote to account
    await prisma.quote.update({
      where: { id: quote.id },
      data: {
        customerId: user.id,
        inviteUsedAt: new Date(),
      },
    });

    const jwtToken = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      staffRole: user.staffRole,
    });

    res.status(201).json({ token: jwtToken, user: publicUser(user) });
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
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(publicUser(user));
  } catch (err) {
    console.error('[GET /auth/me]', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;