import { AsyncLocalStorage } from 'async_hooks';

// ═══════════════════════════════════════════════════════════
// TENANT CONTEXT
// Holds "which company is this request for" for the lifetime of
// a request. The Prisma client (lib/prisma.ts) reads it to scope
// every query, so routes never filter by tenantId by hand.
// ═══════════════════════════════════════════════════════════

type TenantContext = { tenantId: string } | { system: true };

const storage = new AsyncLocalStorage<TenantContext>();

type Result<T> = T extends PromiseLike<infer U> ? Promise<U> : T;

// Prisma queries are lazy: they only execute when `.then` is called. Call it
// while still inside the context, otherwise the query runs without a tenant.
function runIn<T>(ctx: TenantContext, fn: () => T): Result<T> {
  return storage.run(ctx, () => {
    const result: any = fn();
    if (result && typeof result.then === 'function') {
      return new Promise((resolve, reject) => result.then(resolve, reject));
    }
    return result;
  });
}

/** Run `fn` with all Prisma queries scoped to `tenantId`. */
export function runWithTenant<T>(tenantId: string, fn: () => T): Result<T> {
  return runIn({ tenantId }, fn);
}

/**
 * Run `fn` with tenant scoping switched OFF. Only for code that must look
 * across companies: login, public tracking, invite links, platform admin.
 */
export function runAsSystem<T>(fn: () => T): Result<T> {
  return runIn({ system: true }, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/** The current request's tenant id. Throws if there is none. */
export function currentTenantId(): string {
  const ctx = storage.getStore();
  if (!ctx || !('tenantId' in ctx)) {
    throw new Error('[tenant] No tenant in the current context');
  }
  return ctx.tenantId;
}
