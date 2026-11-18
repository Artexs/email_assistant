import { MAX_LATER_TAPS } from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";

export type DbOrTrx = Db | Transaction<DB>;

export const loopKindSchema = z.enum(["waiting", "promised", "delegated"]);
export type LoopKind = z.infer<typeof loopKindSchema>;

export const loopCloseReasonSchema = z.enum([
  "replied",
  "replied_subject",
  "done",
  "dropped",
  "untracked",
  "stale",
  "later_reply",
  "expired",
  "sent_off",
]);
export type LoopCloseReason = z.infer<typeof loopCloseReasonSchema>;

const loopStatusSchema = z.enum(["open", "closed"]);

// The most Later taps one loop takes (the `later_count` CHECK of the table).
export const MAX_LATER = MAX_LATER_TAPS;

export const SYSTEM = "system";

// Who started a command. It goes into the audit row of the command: a code, never text.
export type LoopVia = "web" | "telegram" | "cli";
const viaData = (via: LoopVia | undefined): { via?: LoopVia } => (via === undefined ? {} : { via });

export interface LoopRow {
  id: string;
  org_id: string;
  mailbox_id: string;
  kind: LoopKind;
  status: "open" | "closed";
  close_reason: LoopCloseReason | null;
  sent_email_id: string | null;
  last_sent_email_id: string | null;
  thread_key: string;
  message_id: string | null;
  references_ids: string[];
  subject: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  counterpart: string | null;
  delegate_id: string | null;
  text: string | null;
  language: "pl" | "en";
  due_at: Date;
  due_source: "stated" | "default";
  wait_from_at: Date;
  later_count: number;
  follow_ups_sent: number;
  last_follow_up_at: Date | null;
  surfaced_at: Date | null;
  auto_reply_at: Date | null;
  stale_notified_at: Date | null;
  closed_at: Date | null;
  closed_by_email_id: string | null;
  closed_by_user_id: string | null;
  texts_cleared_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// The column check of the table limits these values; the parse turns a drift into an error here and not in a caller.
export function toLoopRow<
  T extends { kind: string; status: string; close_reason: string | null; language: string; due_source: string },
>(row: T): LoopRow {
  return {
    ...row,
    kind: loopKindSchema.parse(row.kind),
    status: loopStatusSchema.parse(row.status),
    close_reason: row.close_reason === null ? null : loopCloseReasonSchema.parse(row.close_reason),
    language: z.enum(["pl", "en"]).parse(row.language),
    due_source: z.enum(["stated", "default"]).parse(row.due_source),
  } as unknown as LoopRow;
}

export interface NewLoop {
  mailboxId: string;
  kind: LoopKind;
  // The Sent mail that opens the loop. The unique key `(org_id, sent_email_id, kind)` makes a repeat an `exists`.
  sentEmailId: string | null;
  threadKey: string;
  messageId: string | null;
  referencesIds: readonly string[];
  subject: string | null;
  toAddresses: readonly string[];
  ccAddresses: readonly string[];
  counterpart: string | null;
  // Only for `delegated`.
  delegateId: string | null;
  text: string | null;
  language: "pl" | "en";
  dueAt: Date;
  dueSource: "stated" | "default";
  waitFromAt: Date;
  at: Date;
}

// A conflict on the unique key returns `exists` and writes nothing. Audit data: ids and codes only.
export async function insertLoop(
  trx: Transaction<DB>,
  ctx: TenantContext,
  row: NewLoop
): Promise<{ id: string } | { kind: "exists" }> {
  const inserted = await trx
    .insertInto("open_loops")
    .values({
      org_id: ctx.orgId,
      mailbox_id: row.mailboxId,
      kind: row.kind,
      sent_email_id: row.sentEmailId,
      thread_key: row.threadKey,
      message_id: row.messageId,
      references_ids: [...row.referencesIds],
      subject: row.subject,
      to_addresses: [...row.toAddresses],
      cc_addresses: [...row.ccAddresses],
      counterpart: row.counterpart,
      delegate_id: row.delegateId,
      text: row.text,
      language: row.language,
      due_at: row.dueAt,
      due_source: row.dueSource,
      wait_from_at: row.waitFromAt,
      created_at: row.at,
      updated_at: row.at,
    })
    // The partial unique index: the conflict target repeats its predicate.
    .onConflict((oc) =>
      oc.columns(["org_id", "sent_email_id", "kind"]).where("sent_email_id", "is not", null).doNothing()
    )
    .returning("id")
    .executeTakeFirst();
  if (inserted === undefined) return { kind: "exists" };
  await recordAudit(trx, ctx, {
    actor: SYSTEM,
    event: auditEvents.loopOpened,
    data: { loop_id: inserted.id, kind: row.kind },
    at: row.at,
  });
  return { id: inserted.id };
}

export async function getLoop(db: DbOrTrx, ctx: TenantContext, loopId: string): Promise<LoopRow | undefined> {
  const row = await db
    .selectFrom("open_loops")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", loopId)
    .executeTakeFirst();
  return row && toLoopRow(row);
}

// Lock order: the loop first, then its sends. A command locks the loop, then calls the writers below.
export async function lockLoop(trx: Transaction<DB>, ctx: TenantContext, loopId: string): Promise<LoopRow | undefined> {
  const row = await trx
    .selectFrom("open_loops")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", loopId)
    .forUpdate()
    .executeTakeFirst();
  return row && toLoopRow(row);
}

// The caller holds the lock. A closed loop is not changed: `already`.
export async function closeLoop(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { loopId: string; reason: LoopCloseReason; emailId?: string; userId?: string; via?: LoopVia; at: Date }
): Promise<"closed" | "already"> {
  const closed = await trx
    .updateTable("open_loops")
    .set({
      status: "closed",
      close_reason: input.reason,
      closed_at: input.at,
      closed_by_email_id: input.emailId ?? null,
      closed_by_user_id: input.userId ?? null,
      updated_at: input.at,
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", input.loopId)
    .where("status", "=", "open")
    .returning("kind")
    .executeTakeFirst();
  if (closed === undefined) return "already";
  await recordAudit(trx, ctx, {
    actor: input.userId ?? SYSTEM,
    event: auditEvents.loopClosed,
    data: { loop_id: input.loopId, kind: closed.kind, reason: input.reason, ...viaData(input.via) },
    at: input.at,
  });
  return "closed";
}

export type ReopenResult = "ok" | "already" | "not_allowed" | "not_found";

// The caller holds the lock. The loop keeps `due_at`, `later_count` and `follow_ups_sent`; the close fields go back to
// null. A loop whose texts are cleared (also every `sent_off` loop) cannot reopen: it has nothing left to show.
export async function reopenLoopRow(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { loopId: string; userId?: string; via?: LoopVia; waitFromAt?: Date; at: Date }
): Promise<ReopenResult> {
  const reopened = await trx
    .updateTable("open_loops")
    .set({
      status: "open",
      close_reason: null,
      closed_at: null,
      closed_by_email_id: null,
      closed_by_user_id: null,
      // A command starts the wait again from now: a reply that closed the loop must not close it a second time.
      ...(input.waitFromAt === undefined ? {} : { wait_from_at: input.waitFromAt }),
      updated_at: input.at,
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", input.loopId)
    .where("status", "=", "closed")
    .where("texts_cleared_at", "is", null)
    .returning("kind")
    .executeTakeFirst();
  if (reopened === undefined) {
    const current = await trx
      .selectFrom("open_loops")
      .select(["status", "texts_cleared_at"])
      .where("org_id", "=", ctx.orgId)
      .where("id", "=", input.loopId)
      .executeTakeFirst();
    if (current === undefined) return "not_found";
    return current.status === "open" ? "already" : "not_allowed";
  }
  await recordAudit(trx, ctx, {
    actor: input.userId ?? SYSTEM,
    event: auditEvents.loopReopened,
    data: { loop_id: input.loopId, kind: reopened.kind, ...viaData(input.via) },
    at: input.at,
  });
  return "ok";
}

// The caller holds the lock. A Later tap: the new due date and one more use of the three.
export async function setLoopLater(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { loopId: string; dueAt: Date; userId?: string; via?: LoopVia; at: Date }
): Promise<"ok" | "limit_reached" | "closed"> {
  const row = await trx
    .selectFrom("open_loops")
    .select(["status", "later_count", "kind"])
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", input.loopId)
    .executeTakeFirst();
  if (row === undefined || row.status !== "open") return "closed";
  if (row.later_count >= MAX_LATER) return "limit_reached";
  await trx
    .updateTable("open_loops")
    .set({ due_at: input.dueAt, later_count: row.later_count + 1, updated_at: input.at })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", input.loopId)
    .execute();
  await recordAudit(trx, ctx, {
    actor: input.userId ?? SYSTEM,
    event: auditEvents.loopLater,
    data: { loop_id: input.loopId, kind: row.kind, later_count: row.later_count + 1, ...viaData(input.via) },
    at: input.at,
  });
  return "ok";
}

// The caller holds the lock. A newer own mail in the thread restarts the wait: new message ids for In-Reply-To, the
// wait starts again, a new due date. To, Cc, subject, text and the opening `sent_email_id` stay (the quote is the opening
// mail). `false`: the loop is closed.
export async function restartLoop(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: {
    loopId: string;
    sentEmailId: string;
    messageId: string | null;
    referencesIds: readonly string[];
    waitFrom: Date;
    dueAt: Date;
  }
): Promise<boolean> {
  const restarted = await trx
    .updateTable("open_loops")
    .set({
      last_sent_email_id: input.sentEmailId,
      message_id: input.messageId,
      references_ids: [...input.referencesIds],
      wait_from_at: input.waitFrom,
      due_at: input.dueAt,
      updated_at: input.waitFrom,
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", input.loopId)
    .where("status", "=", "open")
    .returning("kind")
    .executeTakeFirst();
  if (restarted === undefined) return false;
  await recordAudit(trx, ctx, {
    actor: SYSTEM,
    event: auditEvents.loopRestarted,
    data: { loop_id: input.loopId, kind: restarted.kind },
    at: input.waitFrom,
  });
  return true;
}

// The caller holds the lock. The first automatic answer sets the time; a later one keeps it. `true`: this call set it.
export async function markAutoReply(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { loopId: string; at: Date }
): Promise<boolean> {
  const marked = await trx
    .updateTable("open_loops")
    .set({ auto_reply_at: input.at, updated_at: input.at })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", input.loopId)
    .where("status", "=", "open")
    .where("auto_reply_at", "is", null)
    .returning("id")
    .executeTakeFirst();
  return marked !== undefined;
}
