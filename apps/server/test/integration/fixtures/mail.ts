import { randomUUID } from "node:crypto";

import type { Category } from "@ea/core";
import type { Transaction } from "kysely";

import type { NewEmail } from "../../../src/modules/mail";
import type { DB, TenantContext } from "../../../src/platform/db";

export async function insertTestEmail(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  mailboxId: string,
  overrides?: Partial<NewEmail> & {
    status?: string;
    attempts?: number;
    next_attempt_at?: Date | null;
    locked_at?: Date | null;
    backfilled_at?: Date | null;
    created_at?: Date;
  }
): Promise<string> {
  const row = await trx
    .insertInto("emails")
    .values({
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      dedup_key: `test:${randomUUID()}`,
      thread_key: `test:${randomUUID()}`,
      content_hash: "h",
      uid: 1,
      received_at: new Date(),
      status: "pending",
      ...overrides,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}
// The `email_headers` row of a mail with the captured attachments. `count` defaults to the list length.
export async function insertAttachmentHeaders(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  emailId: string,
  attachments: { name: string | null; type: string; size: number; inline: boolean }[],
  count: number = attachments.length
): Promise<void> {
  await trx
    .insertInto("email_headers")
    .values({
      email_id: emailId,
      org_id: ctx.orgId,
      attachments: JSON.stringify(attachments),
      attachment_count: count,
      parts_known: true,
      captured_at: new Date(),
    })
    .execute();
}
// An `emails` row (status `triaged`) and a `triage_results` row with the given `created_at`; returns the e-mail id.
export async function insertTriaged(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: {
    category: Category;
    createdAt: Date;
    receivedAt?: Date;
    reason?: string | null;
    reasonCode?: string;
    confidence?: number;
    fields?: Record<string, unknown>;
    subject?: string | null;
    from?: string | null;
    messageId?: string | null;
    // The `suspicious_reasons` of the result row (default none) and the thread of the mail (default a new thread).
    suspiciousReasons?: readonly string[];
    threadKey?: string;
  }
): Promise<string> {
  const emailId = await insertTestEmail(trx, ctx, mailboxId, {
    ...(opts.threadKey === undefined ? {} : { thread_key: opts.threadKey }),
    status: "triaged",
    received_at: opts.receivedAt ?? opts.createdAt,
    subject: opts.subject ?? null,
    from_address: opts.from ?? null,
    message_id_header: opts.messageId ?? null,
  });
  await trx
    .insertInto("triage_results")
    .values({
      org_id: ctx.orgId,
      email_id: emailId,
      category: opts.category,
      confidence: opts.confidence ?? 0.9,
      reason_code: opts.reasonCode ?? "direct_request",
      reason: opts.reason ?? null,
      fields: JSON.stringify(opts.fields ?? {}),
      suspicious_reasons: [...(opts.suspiciousReasons ?? [])],
      created_at: opts.createdAt,
    })
    .execute();
  return emailId;
}
