import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = '7d';

// ─── Validation schemas ────────────────────────────────────
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  phone: z.string().optional().nullable(),
  role: z.enum(['CUSTOMER', 'STAFF', 'ADMIN']).optional(),
  staffRole: z.enum(['HEAD_OFFICE', 'DRIVER', 'OPERATIONS']).optional().nullable(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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

// ─── Shape a user for API responses (no password) ──────────
function publicUser(user: {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  staffRole: string | null;
  isActive: boolean;
  createdAt: Date;
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

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Only allow STAFF role to carry a staffRole value
    const normalizedStaffRole =
      role === 'STAFF' && staffRole ? staffRole : null;

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        phone: phone || null,
        role: role || 'CUSTOMER',
        staffRole: normalizedStaffRole,
      },
    });

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      staffRole: user.staffRole,
    });

    res.status(201).json({
      token,
      user: publicUser(user),
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

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
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

    res.json({
      token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error('[POST /auth/login]', err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// ═══════════════════════════════════════════════════════════
// AUTHENTICATED ROUTES
// ═══════════════════════════════════════════════════════════
router.use(requireAuth);

// ─── GET /api/auth/me — current user ──────────────────────
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