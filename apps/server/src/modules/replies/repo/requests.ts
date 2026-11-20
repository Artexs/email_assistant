import { MINUTE_MS, replyRequestStatuses, type ReplyTrigger } from "@ea/core";
import { sql, type Selectable, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

export type ReplyRequestRow = Selectable<DB["reply_requests"]>;
export type { ReplyTrigger };
// The column is text with a CHECK of the four triggers: an unknown value is a bug, not a request to draft.
export function triggerOf(row: Pick<ReplyRequestRow, "trigger">): ReplyTrigger {
  if (row.trigger === "auto" || row.trigger === "tap" || row.trigger === "redraft" || row.trigger === "sample") {
    return row.trigger;
  }
  throw new Error("unknown reply request trigger");
}
export type ReplyRequestEnd = "done" | "no_draft" | "failed" | "cancelled" | "superseded";

// A `drafting` row whose claim is older than this is taken back (the worker that held it died). The claim is `locked_at`.
export const REPLY_CLAIM_STALE_MS = 5 * MINUTE_MS;

export interface NewReplyRequest {
  mailboxId: string;
  emailId: string;
  threadKey: string;
  folder: string;
  trigger: ReplyTrigger;
  // The user's own text (cleared by retention). Only a tap or a redraft has one.
  instruction?: string | null;
  // Null for an automatic request.
  requestedBy?: string | null;
  previousSendId?: string | null;
  nextAttemptAt?: Date;
  // The time of the request by the clock of the caller (the timeout of a user request counts from it). Absent: the clock of the database.
  createdAt?: Date;
}

// Inserts one request. A mail gets at most one `auto` request (the unique key of the table): a repeat gives null and changes
// nothing. A tap, a redraft and a sample always insert. Returns the new id.
export async function createReplyRequest(
  db: DbOrTrx,
  ctx: TenantContext,
  input: NewReplyRequest
): Promise<string | null> {
  const row = await db
    .insertInto("reply_requests")
    .values({
      org_id: ctx.orgId,
      mailbox_id: input.mailboxId,
      email_id: input.emailId,
      thread_key: input.threadKey,
      folder: input.folder,
      trigger: input.trigger,
      instruction: input.instruction ?? null,
      requested_by: input.requestedBy ?? null,
      previous_send_id: input.previousSendId ?? null,
      ...(input.nextAttemptAt === undefined ? {} : { next_attempt_at: input.nextAttemptAt }),
      ...(input.createdAt === undefined ? {} : { created_at: input.createdAt, updated_at: input.createdAt }),
    })
    .onConflict((oc) => oc.columns(["org_id", "email_id"]).where("trigger", "=", "auto").doNothing())
    .returning("id")
    .executeTakeFirst();
  return row?.id ?? null;
}

// Claims due `pending` rows of one mailbox and `drafting` rows whose claim is stale. `locked_at` = `opts.now` (a JS value
// that survives the round trip): it is the token of `releaseReplyRequest` and `finishReplyRequest`. Taking back a stale
// `drafting` row counts an attempt (the earlier run may have died on it), so `attempts` in the result is the new value.
// The picked rows are locked with `FOR UPDATE SKIP LOCKED`: two parallel claims never take the same row.
export async function claimReplyRequests(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { mailboxId: string; now: Date; limit: number }
): Promise<ReplyRequestRow[]> {
  const staleBefore = new Date(opts.now.getTime() - REPLY_CLAIM_STALE_MS);
  const rows = await db
    .with("picked", (qb) =>
      qb
        .selectFrom("reply_requests")
        .select("id")
        .where("org_id", "=", ctx.orgId)
        .where("mailbox_id", "=", opts.mailboxId)
        .where((eb) =>
          eb.or([
            eb.and([eb("status", "=", "pending"), eb("next_attempt_at", "<=", opts.now)]),
            eb.and([eb("status", "=", "drafting"), eb("locked_at", "<", staleBefore)]),
          ])
        )
        .orderBy("created_at")
        .orderBy("id")
        .limit(opts.limit)
        .forUpdate()
        .skipLocked()
    )
    .updateTable("reply_requests as r")
    .set((eb) => ({
      status: "drafting",
      locked_at: opts.now,
      updated_at: opts.now,
      attempts: eb
        .case()
        .when("r.status", "=", "drafting")
        .then(eb("r.attempts", "+", 1))
        .else(eb.ref("r.attempts"))
        .end(),
    }))
    .from("picked")
    .whereRef("r.id", "=", "picked.id")
    .where("r.org_id", "=", ctx.orgId)
    .returningAll("r")
    .execute();
  // RETURNING has no order.
  return rows.sort((x, y) => x.created_at.getTime() - y.created_at.getTime() || (x.id < y.id ? -1 : 1));
}

// Ends a claimed request. A conditional update: it changes the row only while the claim with `lockedAt` still holds it.
// `reasonCode` is a code, never text (the table CHECK). Returns false when the claim was lost.
export async function finishReplyRequest(
  db: DbOrTrx,
  ctx: TenantContext,
  requestId: string,
  lockedAt: Date,
  next: {
    status: ReplyRequestEnd;
    reasonCode?: string | null;
    sendActionId?: string | null;
    // The text of a `sample` request (the user's own preview; retention clears it).
    sampleBody?: string | null;
    now: Date;
  }
): Promise<boolean> {
  const result = await db
    .updateTable("reply_requests")
    .set({
      status: next.status,
      reason_code: next.reasonCode ?? null,
      ...(next.sendActionId === undefined ? {} : { send_action_id: next.sendActionId }),
      ...(next.sampleBody === undefined ? {} : { sample_body: next.sampleBody }),
      locked_at: null,
      updated_at: next.now,
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", requestId)
    .where("status", "=", "drafting")
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// Gives a claimed request back to the queue with the time of the next try. Same guard as `finishReplyRequest`.
export async function releaseReplyRequest(
  db: DbOrTrx,
  ctx: TenantContext,
  requestId: string,
  lockedAt: Date,
  opts: { nextAttemptAt: Date; countAttempt: boolean; now: Date }
): Promise<boolean> {
  const result = await db
    .updateTable("reply_requests")
    .set((eb) => ({
      status: "pending",
      locked_at: null,
      next_attempt_at: opts.nextAttemptAt,
      updated_at: opts.now,
      attempts: opts.countAttempt ? eb("attempts", "+", 1) : eb.ref("attempts"),
    }))
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", requestId)
    .where("status", "=", "drafting")
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// Every request of one mail, newest first.
export async function listReplyRequestsOfEmail(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<ReplyRequestRow[]> {
  return db
    .selectFrom("reply_requests")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
}

// How many redrafts the mail has had (the limit of a redraft counts them).
export async function countRedrafts(db: DbOrTrx, ctx: TenantContext, emailId: string): Promise<number> {
  const row = await db
    .selectFrom("reply_requests")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .where("trigger", "=", "redraft")
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

// Locks one claimed request until the end of the transaction, only while the claim with `lockedAt` still holds it. False: the
// claim was lost (a stale take-back or a finish), so the caller writes nothing.
export async function lockReplyRequest(
  trx: Transaction<DB>,
  ctx: TenantContext,
  requestId: string,
  lockedAt: Date
): Promise<boolean> {
  const row = await trx
    .selectFrom("reply_requests")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", requestId)
    .where("status", "=", "drafting")
    .where("locked_at", "=", lockedAt)
    .forUpdate()
    .executeTakeFirst();
  return row !== undefined;
}

// Ends the `pending` requests of a user wait (a tap, a redraft or a sample: every trigger but `auto`) of one mailbox that were
// made at or before `createdBefore`: `failed` / `timeout`. A `pending` row is held by no run, so this needs no claim. A request
// that a run holds (`drafting`) ends by that run, or by the next claim after the stale take-back. Returns the ids.
export async function failStaleUserRequests(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { createdBefore: Date; now: Date }
): Promise<string[]> {
  const rows = await db
    .updateTable("reply_requests")
    .set({ status: "failed", reason_code: "timeout", locked_at: null, updated_at: opts.now })
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("status", "=", "pending")
    .where("trigger", "<>", "auto")
    .where("created_at", "<=", opts.createdBefore)
    .returning("id")
    .execute();
  return rows.map((row) => row.id);
}

// The id of a request of this mail that still waits or runs (`pending`, `drafting`): a second tap or a second line must not make a
// second model call. `previousSendId`: only a request that replaces this send (a redraft).
export async function findOpenRequest(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { emailId: string; trigger: "tap" | "redraft"; previousSendId?: string }
): Promise<string | undefined> {
  let query = db
    .selectFrom("reply_requests")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", opts.emailId)
    .where("trigger", "=", opts.trigger)
    .where("status", "in", ["pending", "drafting"]);
  if (opts.previousSendId !== undefined) query = query.where("previous_send_id", "=", opts.previousSendId);
  const row = await query.orderBy("created_at", "desc").orderBy("id", "desc").limit(1).executeTakeFirst();
  return row?.id;
}

export interface EndedRequest {
  id: string;
  emailId: string;
  requestedBy: string;
  trigger: "tap" | "redraft";
  status: ReplyRequestEnd;
  reasonCode: string | null;
  sendActionId: string | null;
  endedAt: Date;
}

// The tap and redraft requests that ended at or after `since` and that were asked for through `via` (the audit row `reply.requested` of the
// service holds it; the request has no channel column). Oldest end first. `maxLifeMs`: the longest time between the creation of a request and
// its end (the request timeout of the drafter): an older request is not an end of this window. The chat channel answers each one once with the result.
export async function listEndedRequestsVia(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { via: string; since: Date; limit: number; maxLifeMs: number }
): Promise<EndedRequest[]> {
  const rows = await db
    .selectFrom("reply_requests as r")
    .select([
      "r.id",
      "r.email_id",
      "r.requested_by",
      "r.trigger",
      "r.status",
      "r.reason_code",
      "r.send_action_id",
      "r.updated_at",
    ])
    .where("r.org_id", "=", ctx.orgId)
    .where("r.trigger", "in", ["tap", "redraft"])
    .where("r.status", "in", ["done", "no_draft", "failed", "cancelled", "superseded"])
    .where("r.requested_by", "is not", null)
    .where("r.updated_at", ">=", opts.since)
    // A request of a user ends within `maxLifeMs` of its creation (the request timeout). A row whose `updated_at` is newer than that
    // but whose creation is far older was touched by something else (retention, an operator): it did not end now.
    .where("r.created_at", ">=", new Date(opts.since.getTime() - opts.maxLifeMs))
    .where(
      sql<boolean>`exists (
        select 1 from audit_log a
        where a.org_id = r.org_id and a.event = 'reply.requested'
          and a.data->>'reply_request_id' = r.id::text and a.data->>'via' = ${opts.via})`
    )
    .orderBy("r.updated_at")
    .orderBy("r.id")
    .limit(opts.limit)
    .execute();
  return rows.flatMap((row) =>
    row.requested_by === null || (row.trigger !== "tap" && row.trigger !== "redraft")
      ? []
      : [
          {
            id: row.id,
            emailId: row.email_id,
            requestedBy: row.requested_by,
            trigger: row.trigger,
            status: row.status as EndedRequest["status"],
            reasonCode: row.reason_code,
            sendActionId: row.send_action_id,
            endedAt: row.updated_at,
          },
        ]
  );
}

// What the panel needs to poll one request of a user (a tap or a redraft): the row, never the instruction. Another organization's id,
// an unknown id and a request that is no user request (`auto`, `sample`) give undefined.
export interface UserRequestView {
  emailId: string;
  mailboxId: string;
  threadKey: string;
  status: (typeof replyRequestStatuses)[number];
  reasonCode: string | null;
  sendActionId: string | null;
}

export async function getUserRequest(
  db: DbOrTrx,
  ctx: TenantContext,
  requestId: string
): Promise<UserRequestView | undefined> {
  const row = await db
    .selectFrom("reply_requests")
    .select(["email_id", "mailbox_id", "thread_key", "status", "reason_code", "send_action_id"])
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", requestId)
    .where("trigger", "in", ["tap", "redraft"])
    .executeTakeFirst();
  if (row === undefined) return undefined;
  const status = replyRequestStatuses.find((name) => name === row.status);
  if (status === undefined) throw new Error("unknown reply request status");
  return {
    emailId: row.email_id,
    mailboxId: row.mailbox_id,
    threadKey: row.thread_key,
    status,
    reasonCode: row.reason_code,
    sendActionId: row.send_action_id,
  };
}

// The facts of a reply version for the panel: the line of the request that made this send (null: none, or retention cleared it)
// and the redrafts left for the mail. The line is read for the owner's own page only; no write route returns it.
export async function replyVersionFacts(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { sendId: string; emailId: string }
): Promise<{ instruction: string | null; redrafts: number }> {
  const made = await db
    .selectFrom("reply_requests")
    .select("instruction")
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", opts.emailId)
    .where("send_action_id", "=", opts.sendId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return { instruction: made?.instruction ?? null, redrafts: await countRedrafts(db, ctx, opts.emailId) };
}
