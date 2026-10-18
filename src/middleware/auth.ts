import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { runAsSystem, runWithTenant } from '../lib/tenantContext';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    tenantId: string;
    email: string;
    role: string;
    staffRole?: string | null;
    // Platform owner. Their `role` is ADMIN inside requests, so they also
    // have full admin rights in their own company.
    isSuperAdmin: boolean;
  };
}

// ─── Live session check ────────────────────────────────────
// A token stays valid for 7 days, so on each request we re-read the user's
// current role and whether they (and their company) are still active.
// Cached briefly so this isn't a DB query on every call.
const SESSION_CACHE_MS = 30_000;

interface Session {
  tenantId: string;
  email: string;
  role: string;
  staffRole: string | null;
  active: boolean;
}

const sessionCache = new Map<string, { at: number; session: Session | null }>();

async function loadSession(userId: string): Promise<Session | null> {
  const hit = sessionCache.get(userId);
  if (hit && Date.now() - hit.at < SESSION_CACHE_MS) return hit.session;

  const user = await runAsSystem(() =>
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        tenantId: true,
        email: true,
        role: true,
        staffRole: true,
        isActive: true,
        tenant: { select: { isActive: true } },
      },
    })
  );
  const session = user
    ? {
        tenantId: user.tenantId,
        email: user.email,
        role: user.role,
        staffRole: user.staffRole,
        active: user.isActive && user.tenant.isActive,
      }
    : null;
  sessionCache.set(userId, { at: Date.now(), session });
  return session;
}

/** Call after changing a user's role/status or a company's status. */
export function invalidateSessions() {
  sessionCache.clear();
}

// Verify JWT token
export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  let payload: { userId: string; tenantId?: string };
  try {
    payload = jwt.verify(header.slice(7), JWT_SECRET) as typeof payload;
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Tokens issued before multi-tenancy carry no tenant — force a fresh login.
  if (!payload.tenantId) {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }

  const session = await loadSession(payload.userId);
  if (!session || session.tenantId !== payload.tenantId) {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
  if (!session.active) {
    return res.status(401).json({ error: 'Your account or company has been disabled' });
  }

  const isSuperAdmin = session.role === 'SUPER_ADMIN';
  req.user = {
    userId: payload.userId,
    tenantId: session.tenantId,
    email: session.email,
    role: isSuperAdmin ? 'ADMIN' : session.role,
    staffRole: session.staffRole,
    isSuperAdmin,
  };

  // Everything downstream (and every Prisma query it makes) is scoped to this tenant.
  runWithTenant(session.tenantId, next);
}

// Require a specific top-level role (or roles)
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const allowed =
      roles.includes(req.user.role) ||
      (roles.includes('SUPER_ADMIN') && req.user.isSuperAdmin);
    if (!allowed) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Require a specific staff sub-role (DRIVER, OPERATIONS, HEAD_OFFICE).
// ADMIN bypasses the check.
export function requireStaffRole(...staffRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (req.user.role !== 'STAFF' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Staff access required' });
    }
    if (req.user.role === 'ADMIN') return next();
    if (!req.user.staffRole || !staffRoles.includes(req.user.staffRole)) {
      return res
        .status(403)
        .json({ error: 'Insufficient staff permissions' });
    }
    next();
  };
}