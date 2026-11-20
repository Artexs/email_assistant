import { DAY_MS, SENT_MAX_AGE_DAYS, type SentSkipReason } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { sentTestMailFilter, type TestMailRule } from "../mail";

import type { DbOrTrx } from "./repo";

// The state of the analysis of the user's own Sent mail (`sent_analyses`). Codes and counters only: no text, no address.

// The skip reasons of the code filters, plus the three of this job.
export type AnalysisSkipReason = SentSkipReason | "thread_restart" | "delegation_thread" | "llm_cap";

// One user row of `sent_emails` that waits for its analysis, with the facts the rules need.
export interface SentCandidate {
  id: string;
  threadKey: string;
  messageId: string | null;
  referencesIds: string[];
  fromAddress: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
  bodyText: string | null;
  content: "stored" | "headers_only" | "gone";
  sentAt: Date;
  listId: string | null;
  autoSubmitted: string | null;
  hasCalendar: boolean;
  actionId: string | null;
  // The tries of an analysis row that waits; 0 when the row has none.
  attempts: number;
}

// What `listSentCandidates` reads: user rows whose text is not `pending`, oldest first. A row with no analysis row must be
// at most 14 days old (an older one is no work and gets no row); a `pending` analysis row is due when its time has come.
// `testOnly`: only test mail (the synthetic scope of the LLM: a real mail never goes to the model there).
export async function listSentCandidates(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; limit: number; testOnly: TestMailRule | null }
): Promise<SentCandidate[]> {
  const youngest = new Date(opts.now.getTime() - SENT_MAX_AGE_DAYS * DAY_MS);
  let query = db
    .selectFrom("sent_emails as s")
    .leftJoin("sent_analyses as a", (join) =>
      join.onRef("a.sent_email_id", "=", "s.id").onRef("a.org_id", "=", "s.org_id")
    )
    .select([
      "s.id",
      "s.thread_key",
      "s.message_id",
      "s.references_ids",
      "s.from_address",
      "s.to_addresses",
      "s.cc_addresses",
      "s.subject",
      "s.body_text",
      "s.content",
      "s.sent_at",
      "s.list_id",
      "s.auto_submitted",
      "s.has_calendar",
      "s.action_id",
      "a.attempts as attempts",
    ])
    .where("s.org_id", "=", ctx.orgId)
    .where("s.mailbox_id", "=", mailboxId)
    .where("s.origin", "=", "user")
    // A `pending` text waits: the list and auto-reply markers come with the text.
    .where("s.content", "<>", "pending")
    .where((eb) =>
      eb.or([
        eb.and([eb("a.sent_email_id", "is", null), eb("s.sent_at", ">=", youngest)]),
        eb.and([
          eb("a.status", "=", "pending"),
          eb.or([eb("a.next_attempt_at", "is", null), eb("a.next_attempt_at", "<=", opts.now)]),
        ]),
      ])
    );
  if (opts.testOnly !== null) query = query.where(sentTestMailFilter(opts.testOnly));
  const rows = await query.orderBy("s.sent_at").orderBy("s.id").limit(opts.limit).execute();
  return rows.map((row) => ({
    id: row.id,
    threadKey: row.thread_key,
    messageId: row.message_id,
    referencesIds: row.references_ids,
    fromAddress: row.from_address,
    to: row.to_addresses,
    cc: row.cc_addresses,
    subject: row.subject,
    bodyText: row.body_text,
    content: row.content === "headers_only" || row.content === "gone" ? row.content : "stored",
    sentAt: row.sent_at,
    listId: row.list_id,
    autoSubmitted: row.auto_submitted,
    hasCalendar: row.has_calendar === true,
    actionId: row.action_id,
    attempts: row.attempts ?? 0,
  }));
}

export type AnalysisWrite =
  | { status: "skipped"; skipReason: AnalysisSkipReason }
  // The tries so far, the reason (`llm_cap` or none) and the time of the next try.
  | { status: "pending"; skipReason: "llm_cap" | null; attempts: number; nextAttemptAt: Date }
  | { status: "failed"; attempts: number }
  | { status: "done"; expectsReply: boolean; hasPromise: boolean; promptVersion: string };

// One row per Sent mail. An insert, or an update of a `pending` row only: a row that is `done`, `skipped` or `failed`
// stays as it is, so a second run of the same write changes nothing. Returns true when this call wrote the row. The
// foreign key to `sent_emails` fails when the Sent row has gone. A finished row (`done`, `skipped`) keeps the tries
// that came before it.
export async function writeAnalysis(
  trx: DbOrTrx,
  ctx: TenantContext,
  input: { mailboxId: string; sentEmailId: string; write: AnalysisWrite; at: Date }
): Promise<boolean> {
  const { write, at } = input;
  const fields = {
    status: write.status,
    skip_reason: write.status === "skipped" || write.status === "pending" ? write.skipReason : null,
    expects_reply: write.status === "done" ? write.expectsReply : null,
    has_promise: write.status === "done" ? write.hasPromise : null,
    prompt_version: write.status === "done" ? write.promptVersion : null,
    next_attempt_at: write.status === "pending" ? write.nextAttemptAt : null,
  };
  const attempts = write.status === "pending" || write.status === "failed" ? write.attempts : undefined;
  const written = await trx
    .insertInto("sent_analyses")
    .values({
      org_id: ctx.orgId,
      mailbox_id: input.mailboxId,
      sent_email_id: input.sentEmailId,
      ...fields,
      attempts: attempts ?? 0,
      created_at: at,
      updated_at: at,
    })
    .onConflict((oc) =>
      oc
        .column("sent_email_id")
        .doUpdateSet({ ...fields, ...(attempts === undefined ? {} : { attempts }), updated_at: at })
        .where("sent_analyses.org_id", "=", ctx.orgId)
        .where("sent_analyses.status", "=", "pending")
    )
    .returning("sent_email_id")
    .executeTakeFirst();
  return written !== undefined;
}
