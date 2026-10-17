import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { runWithTenant } from '../lib/tenantContext';

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'mbuyu';

// For PUBLIC routes (no login yet) that still belong to one company,
// e.g. the website quote form or customer self-registration.
// The company code comes from the X-Tenant header, `tenant` in the body or
// query string, or falls back to DEFAULT_TENANT_SLUG so the existing
// Mbuyu website keeps working unchanged.
export async function resolveTenant(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const raw =
    req.header('x-tenant') ||
    (typeof req.body?.tenant === 'string' && req.body.tenant) ||
    (typeof req.query.tenant === 'string' && req.query.tenant) ||
    DEFAULT_TENANT_SLUG;
  const slug = String(raw).toLowerCase().trim();

  // Tenant itself is not tenant-scoped, so this lookup needs no context.
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant || !tenant.isActive) {
    return res.status(404).json({ error: 'Company not found' });
  }

  runWithTenant(tenant.id, next);
}
