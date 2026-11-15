import { randomUUID } from "node:crypto";

import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../src/platform/db";

import { insertDelegate, insertDelegation, insertDraftAndSend } from "./fixtures";

// The due date of an open delegation: yesterday 17:00 Warsaw, for the clock of 2026-11-10 07:30.
export const DELEGATION_DUE_AT = new Date("2026-11-09T16:00:00Z");

// An open delegation (the original delegation mail, its draft and send, the delegation row).
export async function openDelegation(
  trx: Transaction<DB>,
  s: { ctx: TenantContext; mailboxId: string; userId: string },
  opts: {
    status?: string;
    active?: boolean;
    dueDate?: string;
    remindersSent?: number;
    lastReminderAt?: Date | null;
    dueAt?: Date | null;
    referencesHeader?: string | null;
  } = {}
) {
  const delegateId = await insertDelegate(trx, s.ctx, { name: "Anna", active: opts.active ?? true });
  const delegate = await trx
    .selectFrom("delegates")
    .select("email")
    .where("id", "=", delegateId)
    .executeTakeFirstOrThrow();
  const pair = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
    delegateId,
    delegateName: "Anna",
    to: delegate.email,
    task: "Prepare the offer",
    dueDate: opts.dueDate ?? "2026-11-09",
    language: "pl",
    sendStatus: "applied",
    approved: { userId: s.userId, at: new Date("2026-11-05T09:00:00Z") },
    messageId: "<orig@x.test>",
    referencesHeader: opts.referencesHeader === undefined ? "<root@x.test>" : opts.referencesHeader,
    createdAt: new Date("2026-11-05T08:00:00Z"),
  });
  const sentMessageId = `<sent-${randomUUID()}@x.test>`;
  const id = await insertDelegation(trx, s.ctx, {
    mailboxId: s.mailboxId,
    emailId: pair.emailId,
    delegateId,
    draftActionId: pair.draftId,
    sendActionId: pair.sendId,
    status: opts.status ?? "sent",
    dueAt: opts.dueAt === undefined ? DELEGATION_DUE_AT : opts.dueAt,
    sentMessageId,
    remindersSent: opts.remindersSent,
    lastReminderAt: opts.lastReminderAt,
  });
  return { id, delegateId, delegateEmail: delegate.email, sentMessageId, ...pair };
}
