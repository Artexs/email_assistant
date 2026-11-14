import { AsyncLocalStorage } from "node:async_hooks";

// The organization of the current call chain; null = no scope (RLS safety net, ADR 0011).
const storage = new AsyncLocalStorage<string | null>();

/** Runs fn with app.org_id = orgId on every connection it uses (RLS safety net, ADR 0011). */
export function withTenantScope<T>(orgId: string, fn: () => T): T {
  if (orgId === "") {
    throw new Error("withTenantScope needs an organization id");
  }
  return storage.run(orgId, fn);
}

/** Runs fn with no scope (app.org_id = ''): jobs and the operator routes. Also clears an outer scope (RLS safety net). */
export function withoutTenantScope<T>(fn: () => T): T {
  return storage.run(null, fn);
}

/** The scope of the current call chain, or null (RLS safety net, ADR 0011). */
export function currentTenantScope(): string | null {
  return storage.getStore() ?? null;
}
