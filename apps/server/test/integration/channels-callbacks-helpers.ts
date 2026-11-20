import { randomUUID } from "node:crypto";

import { type Transaction } from "kysely";

import { noDelegationHooks, type DelegationHooks, type SendScope } from "../../src/modules/actions";
import { insertOutbox, type CallbackDeps, type LinkedChat } from "../../src/modules/channels";
import { type DB } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, insertTriaged } from "./fixtures";

export const T = new Date("2026-11-06T10:00:00Z");
export const NOT_FOUND = "This mail is not in your account.";

export async function feedbackRows(trx: Transaction<DB>, emailId: string) {
  return trx.selectFrom("triage_feedback").selectAll().where("email_id", "=", emailId).execute();
}

export async function setup(trx: Transaction<DB>) {
  const address = `box-${randomUUID()}@x.test`;
  const a = await createOrgWithMailbox(trx, { address });
  const b = await createOrgWithMailbox(trx);
  const ctxA = { orgId: a.orgId };
  const info = await insertTriaged(trx, ctxA, a.mailboxId, {
    category: "info",
    createdAt: T,
    subject: "MARKER-SUBJECT",
  });
  const unsure = await insertTriaged(trx, ctxA, a.mailboxId, { category: "unsure", createdAt: T });
  const other = await insertTriaged(trx, { orgId: b.orgId }, b.mailboxId, { category: "info", createdAt: T });
  const link: LinkedChat = { orgId: a.orgId, userId: a.userId, role: "owner", chatId: 1, linkedAt: T, locale: "en" };
  const deps: CallbackDeps = {
    db: trx,
    now: () => T,
    actionsScope: { kind: "all" },
    hooks: noDelegationHooks,
    uidplus: async () => true,
    sendScope: { kind: "all" },
  };
  return { a, ctxA, info, unsure, other, link, deps };
}

export const ORIGINAL = "📤 Send? Delegation to Delegate\n\nDraft:\nHello";

export async function approvalSetup(trx: Transaction<DB>, opts?: { sendScope?: (address: string) => SendScope }) {
  const address = `box-${randomUUID()}@x.test`;
  const a = await createOrgWithMailbox(trx, { address });
  const b = await createOrgWithMailbox(trx);
  const ctx = { orgId: a.orgId };
  const o1 = a.userId;
  const o2 = await addMember(trx, a.orgId, "owner");
  const assistant = await addMember(trx, a.orgId, "assistant");
  const link = (userId: string, role: LinkedChat["role"]): LinkedChat => ({
    orgId: a.orgId,
    userId,
    role,
    chatId: 1,
    linkedAt: T,
    locale: "en",
  });
  const cancelled: string[] = [];
  const hooks: DelegationHooks = {
    ...noDelegationHooks,
    onCancelled: async (_trx, _ctx, input) => {
      cancelled.push(input.reason);
      return true;
    },
  };
  const deps: CallbackDeps = {
    db: trx,
    now: () => T,
    actionsScope: { kind: "off" },
    hooks,
    uidplus: async () => true,
    sendScope: opts?.sendScope?.(address) ?? { kind: "all" },
  };
  return {
    a,
    b,
    ctx,
    o1,
    o2,
    assistant,
    address,
    cancelled,
    deps,
    owner1: link(o1, "owner"),
    owner2: link(o2, "owner"),
    assistantLink: link(assistant, "assistant"),
  };
}

export async function queueFor(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  userId: string,
  kind: "approval" | "approval_set" | "send_result" | "delegation_answered",
  key: string,
  emailId: string,
  text = ORIGINAL
): Promise<void> {
  await insertOutbox(trx, ctx, {
    userId,
    kind,
    dedupKey: `${kind}:${key}`,
    emailId,
    view: {},
    locale: "en",
    createdAt: T,
    nextAttemptAt: T,
  });
  // The card text as the sender stores it after the send.
  await trx
    .updateTable("outbox")
    .set({ text })
    .where("dedup_key", "=", `${kind}:${key}`)
    .where("user_id", "=", userId)
    .execute();
}

export async function sendRow(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}
