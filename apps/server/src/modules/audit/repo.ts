import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

// Ids, codes and numbers only, never mail text (modules §3.6): no nested objects.
export type AuditData = Record<string, string | number | boolean | null>;

export const auditEvents = {
  emailTriaged: "email.triaged",
  emailSkipped: "email.skipped",
  actionPlanned: "action.planned",
  llmCall: "llm.call",
  emailRequeued: "email.requeued",
  chatLinked: "chat.linked",
  chatUnlinked: "chat.unlinked",
  mailboxPaused: "mailbox.paused",
  mailboxResumed: "mailbox.resumed",
  mailboxPasswordChanged: "mailbox.password_changed",
} as const;

export interface AuditEvent {
  emailId?: string;
  actionId?: string;
  actor: "system" | string;
  event: string;
  reasonCode?: string;
  data?: AuditData;
  // Sets created_at; without it the DB default now().
  at?: Date;
}

// A status change and its audit row go in one transaction: the caller passes `trx`.
export async function recordAudit(db: DbOrTrx, ctx: TenantContext, event: AuditEvent): Promise<void> {
  await db
    .insertInto("audit_log")
    .values({
      org_id: ctx.orgId,
      email_id: event.emailId ?? null,
      action_id: event.actionId ?? null,
      actor: event.actor,
      event: event.event,
      reason_code: event.reasonCode ?? null,
      data: JSON.stringify(event.data ?? {}),
      ...(event.at ? { created_at: event.at } : {}),
    })
    .execute();
}

// One `llm.call` row per LLM call attempt; the mailbox id is in `data`, so no join to `emails`.
export async function countLlmCallsSince(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date
): Promise<number> {
  const row = await db
    .selectFrom("audit_log")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", auditEvents.llmCall)
    .where(sql<string>`data->>'mailbox_id'`, "=", mailboxId)
    .where("created_at", ">=", since)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

// Rows of one event in the window `after < created_at <= until`.
export async function countEventsBetween(
  db: DbOrTrx,
  ctx: TenantContext,
  event: string,
  range: { after: Date; until: Date }
): Promise<number> {
  const row = await db
    .selectFrom("audit_log")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", event)
    .where("created_at", ">", range.after)
    .where("created_at", "<=", range.until)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
