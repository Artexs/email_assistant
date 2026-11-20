import { format } from "node:util";

import { encodeCallback, textTables } from "@ea/core";
import { afterEach, beforeEach, spyOn } from "bun:test";
import { type Transaction } from "kysely";

import { noDelegationHooks, type ApprovalDeps, type ApprovalHooks, type SendScope } from "../../src/modules/actions";
import { cardEditHooks, createOutboxSender, type CallbackDeps, type LinkedChat } from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { type DB, type TenantContext } from "../../src/platform/db";
import { setLogFormat, setLogLevel } from "../../src/platform/log";

import {
  addMember,
  createOrgWithMailbox,
  insertDraftAndSend,
  isolateChannels,
  linkChat,
  randomChatId,
} from "./fixtures";

export const LINKED = new Date("2026-11-01T08:00:00Z");
export const CARD_AT = new Date("2026-11-20T13:00:00Z");
export const NOW = new Date("2026-11-20T13:05:00Z");
const SWITCHES = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false };
export const edits = textTables.en.approvals.edit;
export const CLOCK = "14:05";

let logLines: string[] = [];
let errorLines: string[] = [];

// Captures the log lines of each case; read them with `allLines()`.
export function captureLogs(): void {
  let logSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    setLogFormat("json");
    logLines = [];
    errorLines = [];
    logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logLines.push(format(...args));
    });
    warnSpy = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      logLines.push(format(...args));
    });
    errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errorLines.push(format(...args));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    setLogFormat("text");
    setLogLevel("info");
  });
}

export function allLines(): string[] {
  return [...logLines, ...errorLines];
}

export interface World {
  trx: Transaction<DB>;
  orgId: string;
  ctx: TenantContext;
  mailboxId: string;
  u1: string;
  u2: string;
  chat1: number;
  chat2: number;
  emailId: string;
  sendId: string;
  c1: string;
  c2: string;
}

export async function insertCard(
  trx: Transaction<DB>,
  w: Pick<World, "orgId" | "emailId" | "sendId">,
  userId: string,
  messageId: number,
  text: string
): Promise<string> {
  const row = await trx
    .insertInto("outbox")
    .values({
      org_id: w.orgId,
      user_id: userId,
      kind: "approval",
      dedup_key: `approval:${w.sendId}`,
      email_id: w.emailId,
      text,
      buttons: JSON.stringify([[{ text: "✅ Send", data: encodeCallback({ kind: "approve", actionId: w.sendId }) }]]),
      status: "sent",
      next_attempt_at: CARD_AT,
      created_at: CARD_AT,
      sent_at: CARD_AT,
      external_message_id: messageId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// Two owners with a chat each, a waiting send and its two sent cards C1 (message 501) and C2 (message 502).
export async function world(trx: Transaction<DB>): Promise<World> {
  await isolateChannels(trx);
  const { orgId, userId: u1, mailboxId } = await createOrgWithMailbox(trx);
  const ctx = { orgId };
  const u2 = await addMember(trx, orgId, "owner");
  const chat1 = randomChatId();
  const chat2 = randomChatId();
  await linkChat(trx, ctx, u1, chat1, LINKED);
  await linkChat(trx, ctx, u2, chat2, LINKED);
  await insertDefaultSettings(trx, ctx, mailboxId);
  await updateMailboxSettings(trx, ctx, mailboxId, { mode: "assist", toolSwitches: SWITCHES });
  const { emailId, sendId } = await insertDraftAndSend(trx, ctx, mailboxId, {
    notifiedAt: CARD_AT,
    createdAt: CARD_AT,
  });
  const base = { orgId, emailId, sendId };
  const c1 = await insertCard(trx, base, u1, 501, "CARD-ONE");
  const c2 = await insertCard(trx, base, u2, 502, "CARD-TWO");
  return { trx, orgId, ctx, mailboxId, u1, u2, chat1, chat2, emailId, sendId, c1, c2 };
}

export function depsOf(w: World, scope: SendScope = { kind: "all" }, hooks?: ApprovalHooks): ApprovalDeps {
  return {
    db: w.trx,
    hooks: noDelegationHooks,
    approvalHooks: hooks ?? cardEditHooks({ sendScope: scope }),
    uidplus: async () => true,
  };
}

export function tapDeps(w: World, scope: SendScope = { kind: "all" }): CallbackDeps {
  return {
    db: w.trx,
    now: () => NOW,
    actionsScope: { kind: "all" },
    hooks: noDelegationHooks,
    uidplus: async () => true,
    sendScope: scope,
  };
}

export function linkOf(w: World, userId: string): LinkedChat {
  return {
    orgId: w.orgId,
    userId,
    role: "owner",
    chatId: userId === w.u1 ? w.chat1 : w.chat2,
    linkedAt: LINKED,
    locale: "en",
  };
}

export function senderOf(w: World, channel = createFakeChannel(), perUserLimit?: number) {
  let now = NOW;
  const sender = createOutboxSender({
    db: w.trx,
    channel,
    now: () => now,
    ...(perUserLimit === undefined ? {} : { perUserLimit }),
  });
  return {
    channel,
    run: async (when: Date = NOW) => {
      now = when;
      await sender.run();
    },
  };
}

export async function editRows(w: World) {
  return w.trx
    .selectFrom("outbox")
    .select(["id", "user_id", "edit_of_outbox_id", "status", "error_code", "attempts", "next_attempt_at", "dedup_key"])
    .where("org_id", "=", w.orgId)
    .where("kind", "=", "approval_edit")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

export async function sendState(w: World, sendId = w.sendId) {
  return w.trx
    .selectFrom("actions")
    .select(["status", "status_reason"])
    .where("id", "=", sendId)
    .executeTakeFirstOrThrow();
}

// Puts the send into a state by hand (the checks of `actions` need the approval columns for an approved send).
export async function setSend(w: World, status: string, reason: string | null = null): Promise<void> {
  const approved = ["approved", "applying", "applied"].includes(status);
  await w.trx
    .updateTable("actions")
    .set({
      status,
      status_reason: reason,
      ...(approved ? { approved_by: w.u1, approved_at: NOW, approved_via: "web" } : {}),
      ...(status === "applied" ? { applied_at: NOW } : {}),
    })
    .where("id", "=", w.sendId)
    .execute();
}

export function byMessage<T extends { messageId: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.messageId - b.messageId);
}
