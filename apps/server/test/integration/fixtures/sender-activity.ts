import { randomUUID } from "node:crypto";

import type { Category } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../../src/platform/db";

import { insertTestEmail } from "./mail";

// One incoming mail of a sender spec and the rows that hang on it (all optional).
export interface SeededMail {
  // The `received_at` of the mail.
  at: Date;
  // Default: a fresh Message-ID.
  messageId?: string;
  inReplyTo?: string;
  // The newest triage result of the mail.
  category?: Category;
  suspicious?: boolean;
  answered?: boolean;
  flagged?: boolean;
  seen?: boolean;
  // The captured headers. `cleared` sets `texts_cleared_at`, as the retention does.
  headers?: { listId?: string; listUnsubscribe?: string; autoSubmitted?: string; cleared?: boolean };
  // Feedback rows in order; each is newer than the one before it.
  feedback?: { verdict: "right" | "wrong"; trueCategory?: Category; source?: "web" | "imap_move" | "undo" }[];
  // A test mail (synthetic Message-ID).
  test?: boolean;
}
// One Sent row of the user (or a system send).
export interface SeededSent {
  // The `sent_at` and `internal_date`.
  at: Date;
  to?: string[];
  cc?: string[];
  // Default: a fresh Message-ID.
  messageId?: string;
  // The Message-ID of the mail that this Sent mail answers.
  parent?: string;
  from?: string;
  autoSubmitted?: string;
  // A send of the assistant: the row has an action id and no text.
  system?: boolean;
}
export interface SenderActivitySpec {
  // The From address of the mails. Optional: a spec can hold Sent mail only.
  address?: string;
  mails?: SeededMail[];
  sent?: SeededSent[];
}
// The source rows that one sender leaves in a mailbox: incoming mail with its triage result, flags, captured headers and
// feedback, and Sent mail of the user. The unit of time is the caller's: every date comes from the spec. Returns the ids.
export async function seedSenderActivity(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  spec: SenderActivitySpec
): Promise<{ emailIds: string[]; sentIds: string[] }> {
  const emailIds: string[] = [];
  for (const mail of spec.mails ?? []) {
    const id = await insertTestEmail(trx, ctx, mailboxId, {
      status: mail.category === undefined ? "pending" : "triaged",
      received_at: mail.at,
      from_address: spec.address ?? null,
      message_id_header:
        mail.test === true ? `<${randomUUID()}@ea-seed.test>` : (mail.messageId ?? `<${randomUUID()}@x.test>`),
      in_reply_to: mail.inReplyTo ?? null,
    });
    emailIds.push(id);
    if (mail.category !== undefined) {
      await trx
        .insertInto("triage_results")
        .values({
          org_id: ctx.orgId,
          email_id: id,
          category: mail.category,
          confidence: 0.9,
          reason_code: "direct_request",
          suspicious_reasons: mail.suspicious === true ? ["lookalike_domain"] : [],
          created_at: mail.at,
        })
        .execute();
    }
    if (mail.answered !== undefined || mail.flagged !== undefined || mail.seen !== undefined) {
      await trx
        .insertInto("email_flags")
        .values({
          email_id: id,
          org_id: ctx.orgId,
          seen: mail.seen ?? true,
          answered: mail.answered ?? false,
          flagged: mail.flagged ?? false,
          checked_at: mail.at,
        })
        .execute();
    }
    if (mail.headers !== undefined) {
      await trx
        .insertInto("email_headers")
        .values({
          email_id: id,
          org_id: ctx.orgId,
          list_id: mail.headers.listId ?? null,
          list_unsubscribe: mail.headers.listUnsubscribe ?? null,
          auto_submitted: mail.headers.autoSubmitted ?? null,
          parts_known: true,
          captured_at: mail.at,
          texts_cleared_at: mail.headers.cleared === true ? mail.at : null,
        })
        .execute();
    }
    let step = 0;
    for (const item of mail.feedback ?? []) {
      step += 1;
      await trx
        .insertInto("triage_feedback")
        .values({
          org_id: ctx.orgId,
          email_id: id,
          verdict: item.verdict,
          true_category: item.trueCategory ?? null,
          source: item.source ?? "web",
          created_at: new Date(mail.at.getTime() + step * 1000),
        })
        .execute();
    }
  }

  const sentIds: string[] = [];
  for (const sent of spec.sent ?? []) {
    const row = await trx
      .insertInto("sent_emails")
      .values({
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        dedup_key: `mid:${randomUUID()}`,
        path: "Sent",
        uidvalidity: "7",
        uid: "1",
        message_id: sent.messageId ?? `<${randomUUID()}@x.test>`,
        parent_message_id: sent.parent ?? null,
        thread_key: `test:${randomUUID()}`,
        from_address: sent.from ?? null,
        to_addresses: sent.to ?? (spec.address === undefined ? [] : [spec.address]),
        cc_addresses: sent.cc ?? [],
        auto_submitted: sent.autoSubmitted ?? null,
        origin: sent.system === true ? "system" : "user",
        action_id: sent.system === true ? randomUUID() : null,
        content: "headers_only",
        sent_at: sent.at,
        internal_date: sent.at,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    sentIds.push(row.id);
  }
  return { emailIds, sentIds };
}
