import { randomUUID } from "node:crypto";

import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { type Transaction } from "kysely";

import { detectNotices } from "../../src/modules/channels";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { markSynced, type MailboxStatus } from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  addMember,
  createOrgWithMailbox,
  insertDelegate,
  insertDraftAndSend,
  linkChat,
  randomChatId,
  renderedOf,
} from "./fixtures";

export const T = new Date("2026-11-06T10:00:00Z");

export function at(offsetMs: number): Date {
  return new Date(T.getTime() + offsetMs);
}

export interface Org {
  ctx: TenantContext;
  orgId: string;
  ownerId: string;
  assistantId: string;
  mailboxId: string;
}

// Owner and assistant linked at T - 1 h; the mailbox is active and synced at T - 5 min.

export async function org(trx: Transaction<DB>): Promise<Org> {
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  const assistantId = await addMember(trx, created.orgId);
  await linkChat(trx, ctx, created.userId, randomChatId(), at(-HOUR_MS));
  await linkChat(trx, ctx, assistantId, randomChatId(), at(-HOUR_MS));
  await markSynced(trx, ctx, created.mailboxId, at(-5 * MINUTE_MS));
  await trx
    .updateTable("mailboxes")
    .set({ status_changed_at: at(-HOUR_MS) })
    .where("id", "=", created.mailboxId)
    .execute();
  return { ctx, orgId: created.orgId, ownerId: created.userId, assistantId, mailboxId: created.mailboxId };
}

export async function run(trx: Transaction<DB>, startedAt = at(-HOUR_MS)): Promise<void> {
  await detectNotices({ db: trx, now: () => T, startedAt, testMail: NO_TEST_SENDERS });
}

export async function setStatus(trx: Transaction<DB>, o: Org, status: MailboxStatus, changedAt?: Date): Promise<void> {
  await trx
    .updateTable("mailboxes")
    .set({ status, ...(changedAt === undefined ? {} : { status_changed_at: changedAt }) })
    .where("id", "=", o.mailboxId)
    .execute();
}

export async function rows(trx: Transaction<DB>, orgId: string, kind?: string) {
  let query = trx
    .selectFrom("outbox")
    .select([
      "id",
      "user_id",
      "kind",
      "dedup_key",
      "text",
      "buttons",
      "view",
      "locale",
      "status",
      "error_code",
      "email_id",
      "mailbox_id",
      "channel",
      "detail",
    ])
    .where("org_id", "=", orgId)
    .orderBy("created_at")
    .orderBy("id");
  if (kind !== undefined) query = query.where("kind", "=", kind);
  // `text` and `buttons` are the registry render of the view (the row stores them after the send).
  return (await query.execute()).map((row) => ({ ...row, ...renderedOf(row) }));
}

export const APPLIED = { folder: "Drafts", uid: 7 };
export const SENDER = "boss@client.test";
export const BODY = "Please prepare the offer for the client.";

export interface SendOrg extends Org {
  secondOwnerId: string;
}

// Two linked owners and one linked assistant.
export async function sendOrg(trx: Transaction<DB>): Promise<SendOrg> {
  const o = await org(trx);
  const secondOwnerId = await addMember(trx, o.orgId, "owner");
  await linkChat(trx, o.ctx, secondOwnerId, randomChatId(), at(-HOUR_MS));
  return { ...o, secondOwnerId };
}

export type Pair = NonNullable<Parameters<typeof insertDraftAndSend>[3]>;

export async function waiting(trx: Transaction<DB>, o: Org, opts: Pair = {}) {
  const to = opts.to ?? `anna-${randomUUID()}@x.test`;
  const delegateId =
    opts.kind === "clarification"
      ? undefined
      : (opts.delegateId ?? (await insertDelegate(trx, o.ctx, { name: "Anna Nowak", email: to })));
  const pair = await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
    createdAt: at(-30 * MINUTE_MS),
    draftProviderResult: APPLIED,
    subject: "Quarterly offer",
    from: SENDER,
    bodyText: BODY,
    delegateName: "Anna Nowak",
    task: "Prepare the offer",
    to,
    delegateId,
    ...opts,
  });
  return { ...pair, to, delegateId };
}

export async function sendState(trx: Transaction<DB>, sendId: string) {
  return trx
    .selectFrom("actions")
    .select(["notified_at", "result_notified_at"])
    .where("id", "=", sendId)
    .executeTakeFirstOrThrow();
}

export function buttonData(row: { buttons: unknown }): string[] {
  return (row.buttons as { data: string }[][]).flat().map((button) => button.data);
}

export async function finishSend(
  trx: Transaction<DB>,
  sendId: string,
  patch: {
    status: string;
    reason?: string;
    providerResult?: Record<string, unknown>;
    attempts?: number;
    appliedAt?: Date;
  }
): Promise<void> {
  await trx
    .updateTable("actions")
    .set({
      status: patch.status,
      status_reason: patch.reason ?? null,
      provider_result: patch.providerResult === undefined ? null : JSON.stringify(patch.providerResult),
      attempts: patch.attempts ?? 0,
      applied_at: patch.appliedAt ?? null,
      approved_at: ["applied", "approved"].includes(patch.status) ? at(-HOUR_MS) : null,
      notified_at: at(-HOUR_MS),
      updated_at: at(-5 * MINUTE_MS),
    })
    .where("id", "=", sendId)
    .execute();
}

export async function ended(trx: Transaction<DB>, o: Org, patch: Parameters<typeof finishSend>[2], opts: Pair = {}) {
  const p = await waiting(trx, o, opts);
  await finishSend(trx, p.sendId, patch);
  return p;
}
