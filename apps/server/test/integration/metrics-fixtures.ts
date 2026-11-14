// One seeded week with known answers for the metric readers and the week service (tests run in `withRollback`).
import { randomUUID } from "node:crypto";

import type { Category } from "@ea/core";
import type { Transaction } from "kysely";

import { auditEvents, recordAudit, recordLlmCall } from "../../src/modules/audit";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertAction, insertDelegate, insertDelegation, insertTriaged } from "./fixtures";

export const WEEK = "2026-11-16"; // Monday, Europe/Warsaw; range 2026-11-15T23:00Z – 2026-11-22T23:00Z
export const WEEK_NOW = new Date("2026-11-30T12:00:00Z");

export interface SeededWeek {
  orgA: { ctx: TenantContext; mailboxId: string; ownerId: string; ids: Record<string, string> };
  orgB: { ctx: TenantContext; mailboxId: string };
}

const MINUTE_MS = 60_000;
const at = (iso: string): Date => new Date(iso);

interface MailSpec {
  received: string;
  category: Category;
  vip?: boolean;
  messageId?: string;
  from?: string;
}

// A triaged mail whose latest result is one minute after its arrival; the sender is unique per mail.
async function insertMail(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  spec: MailSpec
): Promise<string> {
  const receivedAt = at(spec.received);
  const emailId = await insertTriaged(trx, ctx, mailboxId, {
    category: spec.category,
    receivedAt,
    createdAt: new Date(receivedAt.getTime() + MINUTE_MS),
    from: spec.from ?? `sender-${randomUUID()}@x.test`,
    messageId: spec.messageId ?? `<${randomUUID()}@mail.x.test>`,
  });
  if (spec.vip === true) {
    await trx
      .updateTable("triage_results")
      .set({ vip: true })
      .where("org_id", "=", ctx.orgId)
      .where("email_id", "=", emailId)
      .execute();
  }
  return emailId;
}

async function insertFeedback(
  trx: Transaction<DB>,
  ctx: TenantContext,
  emailId: string,
  row: { source: string; verdict: "right" | "wrong"; trueCategory: Category; createdAt: Date }
): Promise<void> {
  await trx
    .insertInto("triage_feedback")
    .values({
      org_id: ctx.orgId,
      email_id: emailId,
      source: row.source,
      verdict: row.verdict,
      true_category: row.trueCategory,
      created_at: row.createdAt,
    })
    .execute();
}

async function insertUrgentNotice(
  trx: Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  emailId: string,
  sentAt: string
): Promise<void> {
  const sent = at(sentAt);
  await trx
    .insertInto("outbox")
    .values({
      org_id: ctx.orgId,
      user_id: userId,
      kind: "urgent",
      dedup_key: `urgent:${emailId}`,
      email_id: emailId,
      text: "Urgent mail",
      buttons: "[]",
      status: "sent",
      created_at: sent,
      next_attempt_at: sent,
      sent_at: sent,
    })
    .execute();
}

async function insertMove(
  trx: Transaction<DB>,
  ctx: TenantContext,
  emailId: string,
  folder: string,
  appliedAt: string
): Promise<string> {
  return insertAction(trx, ctx, emailId, {
    type: "move",
    status: "applied",
    payload: { folder },
    appliedAt: at(appliedAt),
    createdAt: at(appliedAt),
  });
}

// A `create_draft` row and the `send` row that depends on it.
async function insertSend(
  trx: Transaction<DB>,
  ctx: TenantContext,
  emailId: string,
  opts: { kind: "clarification" | "delegation"; status: "applied" | "rejected"; at: string; approvedBy: string }
): Promise<{ draftId: string; sendId: string }> {
  const when = at(opts.at);
  const draftId = await insertAction(trx, ctx, emailId, {
    type: "create_draft",
    status: "applied",
    payload: { kind: opts.kind },
    createdAt: when,
  });
  const applied = opts.status === "applied";
  const sendId = await insertAction(trx, ctx, emailId, {
    type: "send",
    status: opts.status,
    payload: { kind: opts.kind },
    dependsOnActionId: draftId,
    createdAt: when,
    appliedAt: applied ? when : null,
    approvedAt: applied ? when : null,
    approvedBy: applied ? opts.approvedBy : null,
    approvedVia: applied ? "telegram" : null,
  });
  return { draftId, sendId };
}

async function insertActionFeedback(
  trx: Transaction<DB>,
  ctx: TenantContext,
  actionId: string,
  row: { kind: "reject_reason" | "mistake"; reason: "wrong_person" | null; createdAt: Date }
): Promise<void> {
  await trx
    .insertInto("action_feedback")
    .values({
      org_id: ctx.orgId,
      action_id: actionId,
      kind: row.kind,
      reason: row.reason,
      via: "telegram",
      created_at: row.createdAt,
      updated_at: row.createdAt,
    })
    .execute();
}

/** Seeds the scenario of F100 stage 10 (13 mails of organization A, 3 of B) inside `trx`. */
export async function seedWeek(trx: Transaction<DB>): Promise<SeededWeek> {
  const a = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId: a.orgId };
  await trx.updateTable("organizations").set({ timezone: "Europe/Warsaw" }).where("id", "=", a.orgId).execute();
  await trx
    .updateTable("mailbox_settings")
    .set({ mode: "assist" })
    .where("org_id", "=", a.orgId)
    .where("mailbox_id", "=", a.mailboxId)
    .execute();
  const mailboxId = a.mailboxId;
  const ids: Record<string, string> = {};
  const mail = async (name: string, spec: MailSpec): Promise<string> => {
    ids[name] = await insertMail(trx, ctx, mailboxId, spec);
    return ids[name];
  };

  const e1 = await mail("e1", { received: "2026-11-17T09:00:00Z", category: "info" });
  await insertFeedback(trx, ctx, e1, {
    source: "telegram",
    verdict: "wrong",
    trueCategory: "urgent",
    createdAt: at("2026-11-17T12:00:00Z"),
  });
  await insertMove(trx, ctx, e1, "ai_info", "2026-11-17T09:01:00Z");

  const e2 = await mail("e2", { received: "2026-11-17T10:00:00Z", category: "urgent" });
  await insertUrgentNotice(trx, ctx, a.userId, e2, "2026-11-17T10:03:00Z");

  const e3 = await mail("e3", { received: "2026-11-18T10:00:00Z", category: "needs_reply" });
  await insertFeedback(trx, ctx, e3, {
    source: "review",
    verdict: "right",
    trueCategory: "needs_reply",
    createdAt: at("2026-11-18T10:30:00Z"),
  });
  const s1 = await insertSend(trx, ctx, e3, {
    kind: "clarification",
    status: "rejected",
    at: "2026-11-18T13:00:00Z",
    approvedBy: a.userId,
  });
  ids.s1 = s1.sendId;
  await recordAudit(trx, ctx, {
    emailId: e3,
    actionId: s1.sendId,
    actor: a.userId,
    event: auditEvents.actionRejected,
    at: at("2026-11-18T13:00:00Z"),
  });
  await insertActionFeedback(trx, ctx, s1.sendId, {
    kind: "reject_reason",
    reason: "wrong_person",
    createdAt: at("2026-11-18T13:01:00Z"),
  });

  const e4 = await mail("e4", { received: "2026-11-18T11:00:00Z", category: "notification" });
  await insertMove(trx, ctx, e4, "ai_notifications", "2026-11-18T11:01:00Z");

  const e5 = await mail("e5", { received: "2026-11-18T12:00:00Z", category: "spam", vip: true });
  await insertMove(trx, ctx, e5, "ai_spam", "2026-11-18T12:01:00Z");

  const e6 = await mail("e6", { received: "2026-11-19T22:30:00Z", category: "urgent" });
  await insertUrgentNotice(trx, ctx, a.userId, e6, "2026-11-20T06:00:00Z");

  const e7 = await mail("e7", { received: "2026-11-20T09:00:00Z", category: "delegation" });
  const s3 = await insertSend(trx, ctx, e7, {
    kind: "delegation",
    status: "applied",
    at: "2026-11-20T09:10:00Z",
    approvedBy: a.userId,
  });
  ids.s3 = s3.sendId;
  const delegateId = await insertDelegate(trx, ctx);
  ids.d1 = await insertDelegation(trx, ctx, {
    mailboxId,
    emailId: e7,
    delegateId,
    draftActionId: s3.draftId,
    sendActionId: s3.sendId,
    status: "sent",
    sentAt: at("2026-11-20T09:10:00Z"),
    dueAt: at("2026-11-23T09:00:00Z"),
  });
  await insertActionFeedback(trx, ctx, s3.sendId, {
    kind: "mistake",
    reason: null,
    createdAt: at("2026-11-20T10:00:00Z"),
  });

  const e8 = await mail("e8", {
    received: "2026-11-17T08:00:00Z",
    category: "urgent",
    messageId: "<synthetic-e8@ea-seed.test>",
  });
  await insertUrgentNotice(trx, ctx, a.userId, e8, "2026-11-17T08:01:00Z");

  const e9 = await mail("e9", { received: "2026-11-10T09:00:00Z", category: "info" });
  await insertMove(trx, ctx, e9, "ai_info", "2026-11-10T09:01:00Z");

  await mail("e10", { received: "2026-11-17T12:00:00Z", category: "urgent" });

  const e11 = await mail("e11", { received: "2026-11-12T09:00:00Z", category: "delegation" });
  const pair11 = await insertSend(trx, ctx, e11, {
    kind: "delegation",
    status: "applied",
    at: "2026-11-13T09:00:00Z",
    approvedBy: a.userId,
  });
  ids.d2 = await insertDelegation(trx, ctx, {
    mailboxId,
    emailId: e11,
    delegateId,
    draftActionId: pair11.draftId,
    sendActionId: pair11.sendId,
    status: "answered",
    sentAt: at("2026-11-13T09:00:00Z"),
    dueAt: at("2026-11-18T09:00:00Z"),
    answeredAt: at("2026-11-18T15:00:00Z"),
  });

  const e12 = await mail("e12", { received: "2026-11-12T10:00:00Z", category: "delegation" });
  const pair12 = await insertSend(trx, ctx, e12, {
    kind: "delegation",
    status: "applied",
    at: "2026-11-13T09:00:00Z",
    approvedBy: a.userId,
  });
  ids.d3 = await insertDelegation(trx, ctx, {
    mailboxId,
    emailId: e12,
    delegateId,
    draftActionId: pair12.draftId,
    sendActionId: pair12.sendId,
    status: "overdue",
    sentAt: at("2026-11-13T09:00:00Z"),
    dueAt: at("2026-11-19T09:00:00Z"),
  });
  await recordAudit(trx, ctx, {
    emailId: e12,
    actor: "system",
    event: auditEvents.delegationOverdue,
    data: { delegation_id: ids.d3 },
    at: at("2026-11-20T06:30:00Z"),
  });

  const e13 = await mail("e13", { received: "2026-11-19T10:00:00Z", category: "info" });
  const s2 = await insertSend(trx, ctx, e13, {
    kind: "clarification",
    status: "rejected",
    at: "2026-11-19T13:00:00Z",
    approvedBy: a.userId,
  });
  ids.s2 = s2.sendId;
  await recordAudit(trx, ctx, {
    emailId: e13,
    actionId: s2.sendId,
    actor: a.userId,
    event: auditEvents.actionRejected,
    at: at("2026-11-19T13:00:00Z"),
  });

  const llm = (when: string) =>
    recordLlmCall(trx, ctx, {
      mailboxId,
      role: "classifier",
      promptVersion: "test",
      model: "gpt-6-luna",
      outcome: "ok",
      tokensIn: 1036,
      tokensOut: 80,
      latencyMs: 100,
      at: at(when),
    });
  for (let i = 0; i < 10; i += 1) await llm("2026-11-17T10:00:00Z");
  await llm("2026-11-10T10:00:00Z");

  const b = await createOrgWithMailbox(trx);
  const ctxB: TenantContext = { orgId: b.orgId };
  const b1 = await insertMail(trx, ctxB, b.mailboxId, { received: "2026-11-17T10:00:00Z", category: "urgent" });
  await insertUrgentNotice(trx, ctxB, b.userId, b1, "2026-11-17T10:02:00Z");
  const b2 = await insertMail(trx, ctxB, b.mailboxId, { received: "2026-11-17T11:00:00Z", category: "urgent" });
  await insertUrgentNotice(trx, ctxB, b.userId, b2, "2026-11-17T11:02:00Z");
  const b3 = await insertMail(trx, ctxB, b.mailboxId, { received: "2026-11-17T12:00:00Z", category: "info" });
  await insertMove(trx, ctxB, b3, "ai_info", "2026-11-17T12:01:00Z");
  await recordLlmCall(trx, ctxB, {
    mailboxId: b.mailboxId,
    role: "classifier",
    promptVersion: "test",
    model: "gpt-6-luna",
    outcome: "ok",
    tokensIn: 1036,
    tokensOut: 80,
    latencyMs: 100,
    at: at("2026-11-17T10:00:00Z"),
  });

  return { orgA: { ctx, mailboxId, ownerId: a.userId, ids }, orgB: { ctx: ctxB, mailboxId: b.mailboxId } };
}
