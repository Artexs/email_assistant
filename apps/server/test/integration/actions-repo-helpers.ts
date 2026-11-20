import { MINUTE_MS } from "@ea/core";
import { type Transaction } from "kysely";

import { type ClaimFilter, type MailboxClaimFilter, type SendClaimFilter } from "../../src/modules/actions";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";

export interface Tenant {
  ctx: TenantContext;
  mailboxId: string;
}

export async function createTwoTenants(trx: Transaction<DB>): Promise<{ a: Tenant; b: Tenant }> {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  return {
    a: { ctx: { orgId: a.orgId }, mailboxId: a.mailboxId },
    b: { ctx: { orgId: b.orgId }, mailboxId: b.mailboxId },
  };
}

export async function actionRows(trx: Transaction<DB>, orgId: string) {
  return trx
    .selectFrom("actions")
    .select(["id", "org_id", "email_id", "type", "status", "payload", "idempotency_key"])
    .where("org_id", "=", orgId)
    .execute();
}

export const NOW = new Date("2026-11-07T12:00:00.000Z");
export const STALE_BEFORE = new Date(NOW.getTime() - 10 * MINUTE_MS);
export const ALL: MailboxClaimFilter = { kind: "all" };
export const SEND_ALL: SendClaimFilter = { kind: "all" };

export function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

export function filterOf(mailbox: MailboxClaimFilter, send: SendClaimFilter): ClaimFilter {
  return { mailbox, send };
}

export function claimOpts(mailbox: MailboxClaimFilter = ALL, limit = 50, send: SendClaimFilter = SEND_ALL) {
  return { now: NOW, limit, staleBefore: STALE_BEFORE, filter: filterOf(mailbox, send) };
}

export function countOpts(mailbox: MailboxClaimFilter = ALL, send: SendClaimFilter = SEND_ALL) {
  return { now: NOW, staleBefore: STALE_BEFORE, filter: filterOf(mailbox, send) };
}

export async function actionState(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export const ready = (type: "move" | "flag" | "mark_read" | "save_summary") => ({ type, status: "ready" });

export async function setupOrgs(trx: Transaction<DB>) {
  const first = await createOrgWithMailbox(trx);
  const second = await createOrgWithMailbox(trx);
  return {
    a: { ctx: { orgId: first.orgId }, mailboxId: first.mailboxId },
    b: { ctx: { orgId: second.orgId }, mailboxId: second.mailboxId },
    userId: first.userId,
  };
}

export const approvedNow = (userId: string) => ({ userId, at: ago(MINUTE_MS) });

export const idsOf = (rows: { id: string }[]) => rows.map((row) => row.id).sort();
