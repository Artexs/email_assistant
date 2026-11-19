import type { Transaction } from "kysely";

import { endSsoLinksAndSessions } from "../../platform/auth-sessions-end";
import type { DB, Db, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";

import {
  clearSsoRequired,
  deleteSsoProvider,
  insertSsoProvider,
  isDomainTakenByOther,
  lockOrganization,
  deleteResetLinksOfPasswordlessMembers,
  lockSsoProvider,
  readSsoState,
  updateSsoProvider,
  type SsoStateRow,
} from "./repo";

const log = createLog("tenancy");

// The operator sets and removes a provider. The client secret lives in `oidcConfig` (the plugin JSON)
// and never reaches a log line, an audit row or a return value.

export type SsoState = SsoStateRow;

// Never the config. Null when the organization has no provider.
export async function getSsoState(db: Db | Transaction<DB>, ctx: TenantContext): Promise<SsoState | null> {
  return (await readSsoState(db, ctx)) ?? null;
}

export interface SetSsoProviderInput {
  issuer: string;
  domain: string;
  clientId: string;
  // The plugin JSON from `buildOidcConfig` (platform/auth-sso.ts). Tenancy stores the string and imports no Better Auth.
  oidcConfig: string;
  actor: string;
  now: Date;
}

export type SetSsoProviderResult =
  | { kind: "new" | "secret" | "unchanged" | "not_found" | "domain_taken" | "domain_invalid" }
  | { kind: "boundary"; linksRemoved: number; sessionsEnded: number };

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// The table CHECK also allows `1.2`. A domain with only digit labels is no mail domain.
function isValidMailDomain(domain: string): boolean {
  return DOMAIN_PATTERN.test(domain) && !domain.split(".").every((label) => /^[0-9]+$/.test(label));
}

// The form the provider row stores: trimmed, lower case, a valid mail domain. null for anything else. The operator CLI
// checks with it before it calls the provider, so a bad domain costs no discovery request.
export function normalizeMailDomain(raw: string): string | null {
  const domain = raw.trim().toLowerCase();
  return isValidMailDomain(domain) ? domain : null;
}

// The e-mail has the provider domain after the last `@`; a subdomain does not match (one domain per provider). Both
// sides are lower case.
export function hasMailDomain(email: string, domain: string): boolean {
  const at = email.lastIndexOf("@");
  return at > 0 && email.slice(at + 1) === domain;
}

function clientIdOf(oidcConfig: string): string | null {
  try {
    const parsed: unknown = JSON.parse(oidcConfig);
    const value =
      typeof parsed === "object" && parsed !== null ? (parsed as { clientId?: unknown }).clientId : undefined;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function issuerHost(issuer: string): string {
  try {
    return new URL(issuer).host;
  } catch {
    return "invalid";
  }
}

// Postgres unique violation on the domain index: another organization took the domain between our check and our write.
function isDomainConflict(error: unknown): boolean {
  const { code, constraint } = (error ?? {}) as { code?: unknown; constraint?: unknown };
  return code === "23505" && typeof constraint === "string" && constraint.includes("domain");
}

// One transaction: the organization lock (FOR NO KEY UPDATE: the audit row of a refused callback needs a key share on the
// organization, and a plain FOR UPDATE could wait for it while the callback waits for the provider row), then the
// provider row. A new issuer, domain or client id is a boundary: it drops the proof, the SSO requirement, the links and
// the SSO sessions of the linked users. A new secret keeps them. An identical set writes nothing.
export async function setSsoProvider(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: SetSsoProviderInput
): Promise<SetSsoProviderResult> {
  const domain = normalizeMailDomain(input.domain);
  if (domain === null) return { kind: "domain_invalid" };

  const run = async (trx: Transaction<DB>): Promise<SetSsoProviderResult> => {
    if (!(await lockOrganization(trx, ctx))) return { kind: "not_found" };
    if (await isDomainTakenByOther(trx, ctx, domain)) return { kind: "domain_taken" };
    const current = await lockSsoProvider(trx, ctx);

    const audit = async (
      change: "new" | "secret" | "boundary",
      providerId: string,
      counts: { linksRemoved: number; sessionsEnded: number }
    ): Promise<void> => {
      await recordAudit(trx, ctx, {
        actor: input.actor,
        event: auditEvents.ssoProviderSet,
        data: {
          provider_id: providerId,
          change,
          issuer_host: issuerHost(input.issuer),
          domain,
          links_removed: counts.linksRemoved,
          sessions_ended: counts.sessionsEnded,
        },
        at: input.now,
      });
      log.info("sso_provider_set", { org_id: ctx.orgId, code: change });
    };

    if (!current) {
      await insertSsoProvider(trx, ctx, { issuer: input.issuer, domain, oidcConfig: input.oidcConfig, now: input.now });
      // From now on the public reset request refuses these members (`isSsoOnlyMember`): a link made before must not work either.
      const resetLinks = await deleteResetLinksOfPasswordlessMembers(trx, ctx);
      if (resetLinks > 0) log.info("sso_reset_links_removed", { org_id: ctx.orgId, count: resetLinks });
      await audit("new", ctx.orgId, { linksRemoved: 0, sessionsEnded: 0 });
      return { kind: "new" };
    }

    const sameBoundary =
      current.issuer === input.issuer && current.domain === domain && clientIdOf(current.oidcConfig) === input.clientId;
    if (sameBoundary && current.oidcConfig === input.oidcConfig) return { kind: "unchanged" };
    const write = { issuer: input.issuer, domain, oidcConfig: input.oidcConfig, now: input.now };

    if (sameBoundary) {
      await updateSsoProvider(trx, ctx, { ...write, boundary: false });
      await audit("secret", current.providerId, { linksRemoved: 0, sessionsEnded: 0 });
      return { kind: "secret" };
    }

    await updateSsoProvider(trx, ctx, { ...write, boundary: true });
    await clearSsoRequired(trx, ctx);
    const counts = await endSsoLinksAndSessions(trx, current.providerId);
    await audit("boundary", current.providerId, counts);
    return { kind: "boundary", ...counts };
  };

  try {
    return await (db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run));
  } catch (error) {
    if (isDomainConflict(error)) return { kind: "domain_taken" };
    throw error;
  }
}

export type RemoveSsoProviderResult =
  | { kind: "removed"; linksRemoved: number; sessionsEnded: number }
  | { kind: "none" }
  | { kind: "confirm_mismatch" };

// The same lock order as `setSsoProvider`. The links, the SSO sessions of the linked users, the provider and the
// SSO requirement go; the audit row keeps counts only. The operator confirms by domain: the compare runs under the
// organization lock, so a `setSsoProvider` that changes the domain cannot slip in between the confirm and the removal.
export async function removeSsoProvider(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { actor: string; now: Date; confirmDomain: string }
): Promise<RemoveSsoProviderResult> {
  const run = async (trx: Transaction<DB>): Promise<RemoveSsoProviderResult> => {
    if (!(await lockOrganization(trx, ctx))) return { kind: "none" };
    const current = await lockSsoProvider(trx, ctx);
    if (!current) return { kind: "none" };
    if (current.domain !== input.confirmDomain.trim().toLowerCase()) return { kind: "confirm_mismatch" };
    const counts = await endSsoLinksAndSessions(trx, current.providerId);
    await deleteSsoProvider(trx, ctx);
    await clearSsoRequired(trx, ctx);
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.ssoProviderRemoved,
      data: {
        provider_id: current.providerId,
        issuer_host: issuerHost(current.issuer),
        domain: current.domain,
        links_removed: counts.linksRemoved,
        sessions_ended: counts.sessionsEnded,
      },
      at: input.now,
    });
    log.info("sso_provider_removed", { org_id: ctx.orgId });
    return { kind: "removed", ...counts };
  };

  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
