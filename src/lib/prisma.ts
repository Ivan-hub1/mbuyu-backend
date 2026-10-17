import { PrismaClient } from '@prisma/client';
import { getTenantContext } from './tenantContext';

// Models that carry a tenantId column. Everything except Tenant itself.
const TENANT_MODELS = new Set<string>([
  'User',
  'Quote',
  'Shipment',
  'ShipmentEvent',
  'ShipmentDocument',
  'Vehicle',
  'Checklist',
  'MaintenanceTicket',
  'Journey',
  'JourneyEvent',
  'ShipmentTransfer',
]);

// Operations whose `where` gets `tenantId` added.
const WHERE_OPERATIONS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

type Data = Record<string, any>;

/**
 * Stamp tenantId on a create payload, including nested creates such as
 * `shipment.create({ data: { events: { create: {...} } } })`.
 * Nested writes must use scalar ids (createdById: ...), not `connect`.
 */
function withTenant(data: Data, tenantId: string): Data {
  const out: Data = { ...data, tenantId };
  for (const [key, value] of Object.entries(out)) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) {
      continue;
    }
    const nested: Data = { ...value };
    if (nested.create) {
      nested.create = Array.isArray(nested.create)
        ? nested.create.map((c: Data) => withTenant(c, tenantId))
        : withTenant(nested.create, tenantId);
    }
    if (nested.createMany?.data) {
      nested.createMany = {
        ...nested.createMany,
        data: nested.createMany.data.map((c: Data) => withTenant(c, tenantId)),
      };
    }
    out[key] = nested;
  }
  return out;
}

function createPrismaClient() {
  const base = new PrismaClient({
    log: ['error', 'warn'],
  });

  return base.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);

          const ctx = getTenantContext();
          // Fail closed: a query with no tenant context is a bug, not "all tenants".
          if (!ctx) {
            throw new Error(
              `[tenant] ${model}.${operation} called outside a tenant context`
            );
          }
          if ('system' in ctx) return query(args);

          const { tenantId } = ctx;
          const a: any = { ...(args ?? {}) };

          if (WHERE_OPERATIONS.has(operation)) {
            a.where = { ...a.where, tenantId };
          }
          if (operation === 'create') {
            a.data = withTenant(a.data, tenantId);
          }
          if (operation === 'createMany' || operation === 'createManyAndReturn') {
            const rows: Data[] = Array.isArray(a.data) ? a.data : [a.data];
            a.data = rows.map((d) => withTenant(d, tenantId));
          }
          if (operation === 'upsert') {
            a.create = withTenant(a.create, tenantId);
          }

          return query(a);
        },
      },
    },
  });
}

export type AppPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: AppPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/** True when an update/delete matched no row (missing, or another tenant's). */
export function isRecordNotFound(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2025';
}
