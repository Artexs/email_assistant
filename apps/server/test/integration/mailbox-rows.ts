import { randomUUID } from "node:crypto";

import { sql, type Transaction } from "kysely";

import { recordAudit } from "../../src/modules/audit";
import { insertOutbox } from "../../src/modules/channels";
import { getMailboxSettings, insertDefaultSettings, insertSenderRule } from "../../src/modules/config";
import { insertCredentials } from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";

import { insertDelegate, insertDelegation, insertDraftAndSend, insertTriagedWithActions } from "./fixtures";

export interface MailboxIds {
  mailboxId: string;
  emailIds: string[];
  actionIds: string[];
}

// One row (at least) in every table that belongs to the mailbox; `delete_mailbox` must remove all of them.
export async function fillMailbox(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  userId: string
): Promise<MailboxIds> {
  const now = new Date("2026-11-10T10:00:00Z");
  const emailIds: string[] = [];
  const actionIds: string[] = [];

  const triaged = await insertTriagedWithActions(trx, ctx, mailboxId, {
    category: "info",
    createdAt: now,
    actions: [{ type: "move", status: "applied" }],
  });
  emailIds.push(triaged.emailId);
  actionIds.push(...triaged.actionIds);
  await trx
    .insertInto("triage_feedback")
    .values({ org_id: ctx.orgId, email_id: triaged.emailId, verdict: "wrong", true_category: "urgent", source: "web" })
    .execute();

  const pair = await insertDraftAndSend(trx, ctx, mailboxId, { createdAt: now });
  emailIds.push(pair.emailId);
  actionIds.push(pair.draftId, pair.sendId);
  const delegateId = await insertDelegate(trx, ctx);
  await insertDelegation(trx, ctx, {
    mailboxId,
    emailId: pair.emailId,
    delegateId,
    draftActionId: pair.draftId,
    sendActionId: pair.sendId,
  });

  await insertSenderRule(trx, ctx, { mailboxId, pattern: `rule-${randomUUID()}@x.test`, kind: "vip" });

  await recordAudit(trx, ctx, { emailId: triaged.emailId, actor: "system", event: "email.triaged" });
  await recordAudit(trx, ctx, { actionId: triaged.actionIds[0], actor: "system", event: "action.applied" });
  await recordAudit(trx, ctx, { actor: userId, event: "mailbox.paused", data: { mailbox_id: mailboxId } });

  const message = { text: "Notice", buttons: [] };
  await insertOutbox(trx, ctx, {
    userId,
    kind: "urgent",
    dedupKey: `urgent:${triaged.emailId}`,
    emailId: triaged.emailId,
    message,
    view: {},
    locale: "en",
    createdAt: now,
    nextAttemptAt: now,
  });
  await insertOutbox(trx, ctx, {
    userId,
    kind: "auth_error",
    dedupKey: `auth_error:${mailboxId}`,
    mailboxId,
    message,
    view: {},
    locale: "en",
    createdAt: now,
    nextAttemptAt: now,
  });

  // `createOrgWithMailbox` makes the INBOX folder only; the settings may exist already (a mailbox made by hand).
  if (!(await getMailboxSettings(trx, ctx, mailboxId))) {
    await insertDefaultSettings(trx, ctx, mailboxId);
  }
  await insertCredentials(trx, ctx, { mailboxId, encryptedSecret: "secret", secretKind: "password", keyVersion: 1 });

  return { mailboxId, emailIds, actionIds };
}

// Counts per table for one mailbox; the email and action ids come from the snapshot taken before a delete.
export async function countMailboxRows(
  trx: Transaction<DB>,
  orgId: string,
  ids: MailboxIds,
  // Audit rows of these events are not counted: stage 5 writes `mailbox.removed` with data.mailbox_id after the delete.
  opts?: { exceptEvents?: readonly string[] }
): Promise<Record<string, number>> {
  const { mailboxId, emailIds, actionIds } = ids;
  const except = opts?.exceptEvents ?? [];

  const byMailbox = async (table: "mailboxes" | "mailbox_credentials" | "mailbox_settings" | "mailbox_folders") => {
    const column = table === "mailboxes" ? "id" : "mailbox_id";
    const row = await trx
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("org_id", "=", orgId)
      .where(column as "org_id", "=", mailboxId)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  };
  const byEmails = async (table: "triage_results" | "triage_feedback") => {
    const row = await trx
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("org_id", "=", orgId)
      .where("email_id", "in", emailIds)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  };
  const audit = async (key: "email_id" | "action_id" | "mailbox") => {
    let query = trx
      .selectFrom("audit_log")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("org_id", "=", orgId);
    if (key === "email_id") query = query.where("email_id", "in", emailIds);
    else if (key === "action_id") query = query.where("action_id", "in", actionIds);
    else query = query.where(sql<string>`data->>'mailbox_id'`, "=", mailboxId);
    if (except.length > 0) query = query.where("event", "not in", except);
    return Number((await query.executeTakeFirstOrThrow()).n);
  };
  const outbox = async (key: "mailbox_id" | "email_id") => {
    const query = trx
      .selectFrom("outbox")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("org_id", "=", orgId);
    const row = await (
      key === "mailbox_id" ? query.where("mailbox_id", "=", mailboxId) : query.where("email_id", "in", emailIds)
    ).executeTakeFirstOrThrow();
    return Number(row.n);
  };
  const single = async (table: "emails" | "delegations" | "sender_rules") => {
    const row = await trx
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("org_id", "=", orgId)
      .where("mailbox_id", "=", mailboxId)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  };
  const actions = await trx
    .selectFrom("actions")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("org_id", "=", orgId)
    .where("id", "in", actionIds)
    .executeTakeFirstOrThrow();

  return {
    mailboxes: await byMailbox("mailboxes"),
    mailbox_credentials: await byMailbox("mailbox_credentials"),
    mailbox_settings: await byMailbox("mailbox_settings"),
    mailbox_folders: await byMailbox("mailbox_folders"),
    emails: await single("emails"),
    triage_results: await byEmails("triage_results"),
    triage_feedback: await byEmails("triage_feedback"),
    actions: Number(actions.n),
    delegations: await single("delegations"),
    sender_rules: await single("sender_rules"),
    audit_log_by_email: await audit("email_id"),
    audit_log_by_action: await audit("action_id"),
    audit_log_by_mailbox: await audit("mailbox"),
    outbox_by_mailbox: await outbox("mailbox_id"),
    outbox_by_email: await outbox("email_id"),
  };
}
