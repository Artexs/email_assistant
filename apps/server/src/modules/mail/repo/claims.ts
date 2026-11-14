import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../../platform/db";
import { NO_TEST_SENDERS, type TestMailRule } from "../seed";

import { mailKindFilter } from "./emails";
import type { DbOrTrx } from "./shared";

export interface ClaimedEmail {
  id: string;
  mailbox_id: string;
  locked_at: Date;
  attempts: number;
  next_attempt_at: Date | null;
  backfilled_at: Date | null;
  created_at: Date;
  received_at: Date;
  from_address: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  body_text: string | null;
  thread_key: string;
  message_id_header: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  source_folder: string;
}
// Mail that waits for triage in all mailboxes of the org.
export async function countWaiting(db: DbOrTrx, ctx: TenantContext, opts: { receivedSince: Date }): Promise<number> {
  const row = await db
    .selectFrom("emails")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("status", "in", ["pending", "processing"])
    .where("received_at", ">=", opts.receivedSince)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
// Claims due pending rows and stale processing rows. `locked_at` = `opts.now` (a JS value, not SQL now()):
// it is the token for releaseEmail and finishEmail, so it must survive the round trip exactly.
// Taking back a stale processing row counts an attempt (the earlier run may have died on this mail), so `attempts` in
// the result is the new value.
export async function claimEmails(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; limit: number; staleBefore: Date; syntheticOnly: false | { testMail: TestMailRule } }
): Promise<ClaimedEmail[]> {
  const rows = await db
    .with("picked", (qb) => {
      let query = qb
        .selectFrom("emails")
        .select("id")
        .where("org_id", "=", ctx.orgId)
        .where("mailbox_id", "=", mailboxId)
        .where((eb) =>
          eb.or([
            eb.and([
              eb("status", "=", "pending"),
              eb.or([eb("next_attempt_at", "is", null), eb("next_attempt_at", "<=", opts.now)]),
            ]),
            eb.and([eb("status", "=", "processing"), eb("locked_at", "<", opts.staleBefore)]),
          ])
        );
      if (opts.syntheticOnly !== false) query = query.where(mailKindFilter("synthetic", opts.syntheticOnly.testMail));
      return query.orderBy("received_at").orderBy("id").limit(opts.limit).forUpdate().skipLocked();
    })
    .updateTable("emails as e")
    .set((eb) => ({
      status: "processing",
      locked_at: opts.now,
      attempts: eb
        .case()
        .when("e.status", "=", "processing")
        .then(eb("e.attempts", "+", 1))
        .else(eb.ref("e.attempts"))
        .end(),
    }))
    .from("picked")
    .whereRef("e.id", "=", "picked.id")
    .where("e.org_id", "=", ctx.orgId)
    .returning([
      "e.id",
      "e.mailbox_id",
      "e.locked_at",
      "e.attempts",
      "e.next_attempt_at",
      "e.backfilled_at",
      "e.created_at",
      "e.received_at",
      "e.from_address",
      "e.to_addresses",
      "e.cc_addresses",
      "e.subject",
      "e.body_text",
      "e.thread_key",
      "e.message_id_header",
      "e.in_reply_to",
      "e.references_header",
      "e.source_folder",
    ])
    .execute();
  // RETURNING has no order.
  return rows
    .map((row) => ({ ...row, locked_at: row.locked_at ?? opts.now }))
    .sort((x, y) => x.received_at.getTime() - y.received_at.getTime() || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}
// Conditional update: it changes the row only while the claim with `lockedAt` still holds it.
export async function releaseEmail(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  lockedAt: Date,
  opts: { nextAttemptAt: Date | null; countAttempt: boolean }
): Promise<boolean> {
  const result = await db
    .updateTable("emails")
    .set((eb) => ({
      status: "pending",
      locked_at: null,
      next_attempt_at: opts.nextAttemptAt,
      attempts: opts.countAttempt ? eb("attempts", "+", 1) : eb.ref("attempts"),
    }))
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .where("status", "=", "processing")
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}
// Conditional update with the same guard as releaseEmail.
export async function finishEmail(
  trx: Transaction<DB>,
  ctx: TenantContext,
  emailId: string,
  lockedAt: Date,
  next: { status: "triaged" } | { status: "skipped"; skipReason: "too_old" | "suspended_backlog" | "body_expired" }
): Promise<boolean> {
  const result = await trx
    .updateTable("emails")
    .set({
      status: next.status,
      skip_reason: next.status === "skipped" ? next.skipReason : null,
      locked_at: null,
      next_attempt_at: null,
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .where("status", "=", "processing")
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}
// Backfill keeps today's SQL: it re-queues every mail without a synthetic Message-ID, also from a test sender (NO_TEST_SENDERS; sync.md rule 15).
// Gives stored real INBOX mail of the window that the worker skipped as `too_old` a new triage run. No audit: the caller writes it.
export async function requeueTooOld(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date; now: Date }
): Promise<string[]> {
  const rows = await trx
    .updateTable("emails")
    .set({ status: "pending", skip_reason: null, next_attempt_at: null, backfilled_at: opts.now })
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("folder", "=", "INBOX")
    .where("status", "=", "skipped")
    .where("skip_reason", "=", "too_old")
    .where("received_at", ">=", opts.since)
    .where("body_text", "is not", null)
    .where(mailKindFilter("real", NO_TEST_SENDERS))
    .returning("id")
    .execute();
  return rows.map((row) => row.id);
}
