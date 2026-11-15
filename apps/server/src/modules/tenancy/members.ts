import type { MembershipRole, UserLocale } from "@ea/core";
import type { Transaction } from "kysely";

import { endUserSessions, unlinkSsoAccount } from "../../platform/auth-sessions-end";
import type { DB, Db, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";

import {
  getMembership,
  getUserIdByEmail,
  insertMembership,
  insertSsoUserOnce,
  lockOrganization,
  lockSsoProvider,
} from "./repo";
import { hasMailDomain } from "./sso-provider";

const log = createLog("tenancy");

// The operator manages SSO members on the owner's request (F119 stage 10, D11): add one before the first sign-in (no
// just-in-time accounts, PD-041), end the sessions, unlink the IdP identity. No result, log line or audit row holds an e-mail address.

export interface AddMemberInput {
  email: string;
  displayName: string;
  role: Extract<MembershipRole, "assistant" | "owner">;
  locale: UserLocale;
  actor: string;
  now: Date;
}

export type AddMemberResult =
  | { kind: "added"; userId: string }
  | { kind: "email_taken" }
  | { kind: "off_domain" }
  | { kind: "not_found" };

// One transaction with the organization locked (it orders this write against `setSsoRequired` and the provider writes). The user
// has no password (no `auth_accounts` row) and a verified address. One address, one user, one organization (D16): any user
// with this address, in any organization, gives `email_taken`; the unique index backs it when two adds run in two organizations.
// An organization with "SSO required" takes only an address on the provider domain.
export async function addMember(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: AddMemberInput
): Promise<AddMemberResult> {
  const email = input.email.trim().toLowerCase();
  const run = async (trx: Transaction<DB>): Promise<AddMemberResult> => {
    const org = await lockOrganization(trx, ctx);
    if (!org) return { kind: "not_found" };
    if ((await getUserIdByEmail(trx, email)) !== undefined) return { kind: "email_taken" };
    if (org.sso_required) {
      const provider = await lockSsoProvider(trx, ctx);
      if (provider && !hasMailDomain(email, provider.domain)) return { kind: "off_domain" };
    }
    const user = await insertSsoUserOnce(trx, { email, displayName: input.displayName.trim(), locale: input.locale });
    if (!user) return { kind: "email_taken" };
    await insertMembership(trx, ctx, { userId: user.id, role: input.role });
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.orgMemberAdded,
      data: { user_id: user.id, role: input.role },
      at: input.now,
    });
    log.info("org_member_added", { org_id: ctx.orgId, user_id: user.id, role: input.role });
    return { kind: "added", userId: user.id };
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

export type EndMemberSessionsResult = { kind: "ended"; count: number } | { kind: "not_member" };

// The user must belong to this organization: a user of another organization is `not_member` and nothing changes.
export async function endMemberSessions(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { userId: string; onlySso: boolean; actor: string; now: Date }
): Promise<EndMemberSessionsResult> {
  const run = async (trx: Transaction<DB>): Promise<EndMemberSessionsResult> => {
    if (!(await getMembership(trx, ctx, input.userId))) return { kind: "not_member" };
    const count = await endUserSessions(trx, input.userId, input.onlySso);
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.webMemberSessionsEnded,
      data: { user_id: input.userId, count, only_sso: input.onlySso },
      at: input.now,
    });
    log.info("member_sessions_ended", { org_id: ctx.orgId, user_id: input.userId, count });
    return { kind: "ended", count };
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

export type UnlinkSsoResult = { kind: "unlinked"; sessionsEnded: number } | { kind: "none" } | { kind: "not_member" };

// Removes the link of the user to the provider of this organization and the user's SSO sessions. The next SSO sign-in links
// again by e-mail (stage 04). The organization lock first, then the provider lock: a callback in flight finishes first (D16).
export async function unlinkSso(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { userId: string; actor: string; now: Date }
): Promise<UnlinkSsoResult> {
  const run = async (trx: Transaction<DB>): Promise<UnlinkSsoResult> => {
    if (!(await lockOrganization(trx, ctx))) return { kind: "not_member" };
    if (!(await getMembership(trx, ctx, input.userId))) return { kind: "not_member" };
    const provider = await lockSsoProvider(trx, ctx);
    if (!provider) return { kind: "none" };
    const result = await unlinkSsoAccount(trx, input.userId, provider.providerId);
    if (!result.linkRemoved) return { kind: "none" };
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.ssoUnlinked,
      data: { user_id: input.userId, sessions_ended: result.sessionsEnded },
      at: input.now,
    });
    log.info("sso_unlinked", { org_id: ctx.orgId, user_id: input.userId, count: result.sessionsEnded });
    return { kind: "unlinked", sessionsEnded: result.sessionsEnded };
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
