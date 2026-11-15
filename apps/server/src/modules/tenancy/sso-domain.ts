import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";

import { lockOrganization, lockSsoProvider, readSsoState, setDomainProof } from "./repo";
import { ssoDomainRecord } from "./sso-domain-token";
import { normalizeMailDomain } from "./sso-provider";

const log = createLog("tenancy");

// The domain proof (ticket F119, PD-041): the plugin signs nobody in until the row says `domain_verified`. The operator proves the
// domain with a DNS TXT record, or attests it for a test organization without DNS control.

const DNS_TIMEOUT_MS = 10_000;

export interface VerifySsoDomainResult {
  kind: "verified" | "already" | "none" | "not_found_in_dns";
}
export interface AttestSsoDomainResult {
  kind: "attested" | "already" | "none" | "confirm_mismatch";
}

export interface VerifySsoDomainInput {
  // `node:dns/promises` `resolveTxt` in the CLI entry, a fake in tests. Each record is its chunks.
  resolveTxt: (name: string) => Promise<string[][]>;
  key: Buffer;
  actor: string;
  now: Date;
  // The wait for the resolver; a timeout counts as "not found".
  timeoutMs?: number;
}

// A DNS error of any kind (`ENOTFOUND`, `ENODATA`, a timeout) is "not found": the operator fixes the record and retries.
async function readTxt(
  resolveTxt: VerifySsoDomainInput["resolveTxt"],
  name: string,
  timeoutMs: number
): Promise<string[][] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolveTxt(name),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("dns_timeout")), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// The provider row of an organization with a valid mail domain, or null: a row made by SQL with a domain of digit labels
// (`1.2`, which the stage 02 CHECK accepts) gets no proof.
async function readProviderForProof(db: Db | Transaction<DB>, ctx: TenantContext) {
  const state = await readSsoState(db, ctx);
  return state && normalizeMailDomain(state.domain) === state.domain ? state : null;
}

// The DNS read runs before the transaction. A record matches when its chunks joined and trimmed equal `ea-sso=<token>`
// exactly. Then the organization lock, and a re-read: the domain may have changed meanwhile (then the token is stale).
export async function verifySsoDomain(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: VerifySsoDomainInput
): Promise<VerifySsoDomainResult> {
  const before = await readProviderForProof(db, ctx);
  if (!before) return { kind: "none" };
  if (before.proof !== null) return { kind: "already" };

  const record = ssoDomainRecord(input.key, ctx.orgId, before.domain);
  const records = await readTxt(input.resolveTxt, record.name, input.timeoutMs ?? DNS_TIMEOUT_MS);
  if (!records?.some((chunks) => chunks.join("").trim() === record.value)) return { kind: "not_found_in_dns" };

  const run = async (trx: Transaction<DB>): Promise<VerifySsoDomainResult> => {
    if (!(await lockOrganization(trx, ctx))) return { kind: "none" };
    const current = await lockSsoProvider(trx, ctx);
    if (!current || normalizeMailDomain(current.domain) !== current.domain || current.domain !== before.domain) {
      return { kind: "none" };
    }
    if (current.domainProof !== null) return { kind: "already" };
    await setDomainProof(trx, ctx, "dns", input.now);
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.ssoDomainVerified,
      data: { provider_id: current.providerId, domain: current.domain },
      at: input.now,
    });
    log.info("sso_domain_verified", { org_id: ctx.orgId, code: "dns" });
    return { kind: "verified" };
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

// The operator vouches for the domain (a test organization that has no DNS control). The confirmed domain is compared under
// the organization lock, so a `setSsoProvider` that changes the domain cannot slip in between.
export async function attestSsoDomain(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { confirmDomain: string; actor: string; now: Date }
): Promise<AttestSsoDomainResult> {
  const run = async (trx: Transaction<DB>): Promise<AttestSsoDomainResult> => {
    if (!(await lockOrganization(trx, ctx))) return { kind: "none" };
    const current = await lockSsoProvider(trx, ctx);
    if (!current || normalizeMailDomain(current.domain) !== current.domain) return { kind: "none" };
    if (current.domain !== input.confirmDomain.trim().toLowerCase()) return { kind: "confirm_mismatch" };
    if (current.domainProof !== null) return { kind: "already" };
    await setDomainProof(trx, ctx, "attested", input.now);
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.ssoDomainAttested,
      data: { provider_id: current.providerId, domain: current.domain },
      at: input.now,
    });
    log.info("sso_domain_attested", { org_id: ctx.orgId, code: "attested" });
    return { kind: "attested" };
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
