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
import { currentTenantId } from '../lib/tenantContext';
import { sendStaffInviteEmail } from '../lib/email';
import { resetPasswordAndSendInvite } from '../lib/invites';

const router = Router();

// All admin routes require authentication + ADMIN role
router.use(requireAuth);
router.use(requireRole('ADMIN'));

async function isSuperAdminUser(id: string) {
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  return target?.role === 'SUPER_ADMIN';
}

// ─── Validation ────────────────────────────────────────────
const createUserSchema = z.object({
  name: z.string().min(2, 'Name too short'),
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  phone: z.string().optional(),
  role: z.enum(['STAFF', 'ADMIN', 'CUSTOMER']),
  staffRole: z
    .enum(['HEAD_OFFICE', 'DRIVER', 'OPERATIONS'])
    .optional()
    .nullable(),
});

// ─── POST /api/admin/users — create a new user ────────────
router.post('/users', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { name, email, password, phone, role, staffRole } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();

    // Only STAFF role can carry a staffRole
    const normalizedStaffRole =
      role === 'STAFF' && staffRole ? staffRole : null;

    // Check if email exists
    const existing = await prisma.user.findFirst({
      where: { email: normalizedEmail },
    });
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        password: hashedPassword,
        phone: phone || null,
        role,
        staffRole: normalizedStaffRole,
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        staffRole: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Send staff invite email (non-blocking — includes temp password)
    sendStaffInviteEmail(user.email, user.name, password, user.role).catch(
      (err) => console.error('[staff invite email]', err)
    );

    res.status(201).json({ user });
  } catch (err) {
    console.error('[POST /admin/users]', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// ─── GET /api/admin/users — list all users ────────────────
router.get('/users', async (_req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        staffRole: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (err) {
    console.error('[GET /admin/users]', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ─── PATCH /api/admin/users/:id — update a user ───────────
router.patch('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { role, isActive, name, phone, staffRole } = req.body;

    // Company admins can never grant platform-level access.
    if (role !== undefined && !['CUSTOMER', 'STAFF', 'ADMIN'].includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }
    if (!req.user!.isSuperAdmin && (await isSuperAdminUser(id))) {
      res.status(403).json({ error: 'The platform owner account can only be changed by itself' });
      return;
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(role !== undefined && { role }),
        ...(isActive !== undefined && { isActive }),
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
        ...(staffRole !== undefined && {
          staffRole: role === 'STAFF' || staffRole !== null ? staffRole : null,
        }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        staffRole: true,
        isActive: true,
        createdAt: true,
      },
    });

    invalidateSessions();
    res.json({ user });
  } catch (err) {
    if (isRecordNotFound(err)) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    console.error('[PATCH /admin/users/:id]', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// ─── DELETE /api/admin/users/:id — delete a user ──────────
router.delete('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    if (req.user?.userId === id) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }
    if (await isSuperAdminUser(id)) {
      res.status(403).json({ error: 'The platform owner account cannot be deleted' });
      return;
    }

    await prisma.user.delete({ where: { id } });
    invalidateSessions();
    res.json({ ok: true });
  } catch (err) {
    if (isRecordNotFound(err)) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    console.error('[DELETE /admin/users/:id]', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ─── POST /api/admin/users/:id/resend-invite ──────────────
// Sets a new temporary password and emails the login details again.
router.post('/users/:id/resend-invite', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!req.user!.isSuperAdmin && (await isSuperAdminUser(id))) {
      res.status(403).json({ error: 'The platform owner account can only be changed by itself' });
      return;
    }
    const result = await resetPasswordAndSendInvite(id);
    if (!result) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error('[POST /admin/users/:id/resend-invite]', err);
    res.status(500).json({ error: 'Failed to resend invite' });
  }
});

// ─── Company settings (this admin's own tenant) ───────────
const companySchema = z.object({
  name: z.string().min(2).optional(),
  tagline: z.string().optional().nullable(),
  contactEmail: z.string().email().optional().nullable().or(z.literal('')),
  contactPhone: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
});

// GET /api/admin/company
router.get('/company', async (_req: AuthRequest, res: Response) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: currentTenantId() },
    });
    res.json(tenant);
  } catch (err) {
    console.error('[GET /admin/company]', err);
    res.status(500).json({ error: 'Failed to fetch company' });
  }
});

// PATCH /api/admin/company — name & contact details used on emails/PDFs
router.patch('/company', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = companySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const data = Object.fromEntries(
      Object.entries(parsed.data).map(([k, v]) => [k, v === '' ? null : v])
    );
    const tenant = await prisma.tenant.update({
      where: { id: currentTenantId() },
      data,
    });
    res.json(tenant);
  } catch (err) {
    console.error('[PATCH /admin/company]', err);
    res.status(500).json({ error: 'Failed to update company' });
  }
});

export default router;