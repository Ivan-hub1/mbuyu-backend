import type { Tenant } from '@prisma/client';
import { prisma } from './prisma';
import { getTenantContext } from './tenantContext';

// ═══════════════════════════════════════════════════════════
// BRAND — the company name/contact details shown on emails
// and quote PDFs, taken from the current request's tenant.
// ═══════════════════════════════════════════════════════════

export interface Brand {
  name: string;
  tagline: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  // The bundled assets/mbuyu-logo.png belongs to the original company only
  useBundledLogo: boolean;
}

const ORIGINAL_TENANT_ID = 'tenant_mbuyu';

const FALLBACK: Brand = {
  name: 'Mbuyu CFL',
  tagline: 'Freight & Logistics',
  email: 'info@mbuyucfl.com',
  phone: '+256 755 028392',
  website: 'www.mbuyucfl.com',
  address: 'Kampala, Uganda',
  useBundledLogo: true,
};

export function brandFromTenant(t: Tenant): Brand {
  return {
    name: t.name,
    tagline: t.tagline || '',
    email: t.contactEmail || '',
    phone: t.contactPhone || '',
    website: t.website || '',
    address: t.address || '',
    useBundledLogo: t.id === ORIGINAL_TENANT_ID,
  };
}

/** Brand of the tenant in the current context (falls back to Mbuyu). */
export async function currentBrand(): Promise<Brand> {
  const ctx = getTenantContext();
  if (!ctx || !('tenantId' in ctx)) return FALLBACK;
  const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
  return tenant ? brandFromTenant(tenant) : FALLBACK;
}
