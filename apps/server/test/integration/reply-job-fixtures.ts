import { randomUUID } from "node:crypto";

import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { sql, type Transaction } from "kysely";

import { noApprovalHooks, noDelegationHooks } from "../../src/modules/actions";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { createReplyJobs, createReplyRequest, type ReplyJobDeps, type ReplyTrigger } from "../../src/modules/replies";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB, Db, TenantContext } from "../../src/platform/db";
import type { GenerateFn, GenerateRequest, LlmClient } from "../../src/platform/llm";
import { createFixedLlmClient } from "../../src/platform/llm/testing";

import { createOrgWithMailbox, insertTriaged } from "./fixtures";

// Shared by the drafter job tests: an organization with a mailbox that has every gate open, mail that needs a reply,
// a fake model and the job deps with a clock that the test moves.

export const NOW = new Date("2026-11-18T10:00:00Z");

// A time `minutes` after NOW (negative: before).
export const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * MINUTE_MS);

export interface JobBox {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
}

type Conn = Db | Transaction<DB>;

// All gates open: flag on, mode `assist`, switch on. A test closes one gate by name.
export async function setupBox(
  trx: Transaction<DB>,
  opts: { flag?: boolean; mode?: "assist" | "shadow"; switchOn?: boolean } = {}
): Promise<JobBox> {
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
  const mailbox = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", box.mailboxId)
    .executeTakeFirstOrThrow();
  await insertDefaultSettings(trx, ctx, box.mailboxId);
  await updateMailboxSettings(trx, ctx, box.mailboxId, { mode: opts.mode ?? "assist" });
  await setSwitch(trx, box.mailboxId, opts.switchOn ?? true);
  if (opts.flag ?? true) await setOrgFeature(trx, ctx, { flag: "reply_drafts", enabled: true, actor: "cli", now: NOW });
  return { ctx, userId: box.userId, mailboxId: box.mailboxId, address: mailbox.address };
}

// `reply_drafts` is no key of the mail tool switches: the stored JSON is written as the settings service writes it.
export async function setSwitch(conn: Conn, mailboxId: string, on: boolean): Promise<void> {
  await conn
    .updateTable("mailbox_settings")
    .set({ tool_switches: sql`jsonb_set(tool_switches, '{reply_drafts}', ${on ? "true" : "false"}::jsonb)` })
    .where("mailbox_id", "=", mailboxId)
    .execute();
}

export interface MailOpts {
  receivedAt?: Date;
  from?: string;
  fromName?: string | null;
  subject?: string;
  body?: string | null;
  threadKey?: string;
  messageId?: string;
  language?: "pl" | "en" | "other";
  category?: "needs_reply" | "info" | "urgent";
  // Default true: without an `email_headers` row the mail is "not checked".
  headers?: boolean;
  // The `Auto-Submitted` header value, when set.
  autoSubmitted?: string;
}

// A triaged mail of category `needs_reply` (default) with the captured headers and a stored body.
export async function addReplyMail(trx: Transaction<DB>, box: JobBox, opts: MailOpts = {}): Promise<string> {
  const receivedAt = opts.receivedAt ?? new Date(NOW.getTime() - HOUR_MS);
  const emailId = await insertTriaged(trx, box.ctx, box.mailboxId, {
    category: opts.category ?? "needs_reply",
    createdAt: receivedAt,
    receivedAt,
    from: opts.from ?? `anna-${randomUUID().slice(0, 8)}@client.test`,
    subject: opts.subject ?? "Spotkanie we wtorek",
    messageId: opts.messageId ?? `<${randomUUID()}@client.test>`,
    fields: { language: opts.language ?? "pl" },
    ...(opts.threadKey === undefined ? {} : { threadKey: opts.threadKey }),
  });
  await trx
    .updateTable("emails")
    .set({ body_text: opts.body === undefined ? "Czy wtorek o dziesiątej Ci pasuje?" : opts.body })
    .where("id", "=", emailId)
    .execute();
  if (opts.headers ?? true) {
    await trx
      .insertInto("email_headers")
      .values({
        email_id: emailId,
        org_id: box.ctx.orgId,
        from_name: opts.fromName ?? null,
        auto_submitted: opts.autoSubmitted ?? null,
        parts_known: true,
        captured_at: NOW,
      })
      .execute();
  }
  return emailId;
}

export const CLEAN_ANSWER = {
  decision: "draft",
  reason_code: null,
  body: "Dzień dobry,\n\nTak, wtorek mi pasuje.",
  gaps: [],
  language: "pl",
};

export type FakeAnswer = Record<string, unknown> | string | Error;

export interface FakeLlm {
  llm: LlmClient;
  // The calls that reached the provider, in order.
  readonly requests: GenerateRequest[];
}

// A model that answers from `script(callNumber, request)`: an object is the JSON answer, a string is the raw text, an Error is thrown.
export function fakeLlm(script: (call: number, request: GenerateRequest) => FakeAnswer | Promise<FakeAnswer>): FakeLlm {
  const requests: GenerateRequest[] = [];
  const generate: GenerateFn = async (request) => {
    requests.push(request);
    const answer = await script(requests.length, request);
    if (answer instanceof Error) throw answer;
    const text = typeof answer === "string" ? answer : JSON.stringify(answer);
    return { text, tokensIn: 100, tokensOut: 20, blocked: false };
  };
  return { llm: createFixedLlmClient(generate, { model: "fake-drafter" }), requests };
}

export interface Clock {
  now: Date;
}

export function jobDeps(conn: Conn, llm: LlmClient, clock: Clock, over: Partial<ReplyJobDeps> = {}): ReplyJobDeps {
  return {
    db: conn,
    llm,
    dailyCap: 300,
    scope: { kind: "all" },
    hooks: noDelegationHooks,
    approvalHooks: noApprovalHooks,
    uidplus: async () => true,
    now: () => clock.now,
    ...over,
  };
}

export function runJob(deps: ReplyJobDeps, box: JobBox) {
  return createReplyJobs(deps).drafter.run({ mailboxId: box.mailboxId });
}

// The reply requests of a mailbox, oldest first.
export async function requestsOf(conn: Conn, box: JobBox) {
  return conn
    .selectFrom("reply_requests")
    .selectAll()
    .where("mailbox_id", "=", box.mailboxId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

export async function requestOf(conn: Conn, id: string) {
  return conn.selectFrom("reply_requests").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

// The `create_draft` and `send` rows of the org, oldest first.
export async function pairRows(conn: Conn, box: JobBox) {
  return conn
    .selectFrom("actions")
    .selectAll()
    .where("org_id", "=", box.ctx.orgId)
    .where("type", "in", ["create_draft", "send"])
    .orderBy("created_at")
    .orderBy("type")
    .execute();
}

export async function llmCallRows(conn: Conn, box: JobBox) {
  return conn
    .selectFrom("audit_log")
    .select(["reason_code", "data", "email_id"])
    .where("org_id", "=", box.ctx.orgId)
    .where("event", "=", "llm.call")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

// `count` rows of `llm.call` of this mailbox written `minutesAgo` before NOW (the cap counts them).
export async function seedLlmCalls(conn: Conn, box: JobBox, count: number, at: Date = NOW): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await conn
      .insertInto("audit_log")
      .values({
        org_id: box.ctx.orgId,
        actor: "system",
        event: "llm.call",
        reason_code: "ok",
        data: JSON.stringify({ mailbox_id: box.mailboxId, role: "classifier", model: "m" }),
        created_at: at,
      })
      .execute();
  }
}

// A request of a user or of the scan, made at `at` (the clock of the test, not the clock of the database): the timeout of a tap reads
// `created_at`. The thread key and the folder come from the mail unless the test names them.
export async function queueRequest(
  conn: Conn,
  box: JobBox,
  emailId: string,
  trigger: ReplyTrigger,
  opts: {
    at?: Date;
    instruction?: string;
    previousSendId?: string | null;
    folder?: string;
    threadKey?: string;
    nextAttemptAt?: Date;
  } = {}
): Promise<string> {
  const mail = await conn
    .selectFrom("emails")
    .select(["thread_key", "folder"])
    .where("id", "=", emailId)
    .executeTakeFirstOrThrow();
  const id = await createReplyRequest(conn, box.ctx, {
    mailboxId: box.mailboxId,
    emailId,
    threadKey: opts.threadKey ?? mail.thread_key,
    folder: opts.folder ?? mail.folder,
    trigger,
    requestedBy: trigger === "auto" ? null : box.userId,
    ...(opts.instruction === undefined ? {} : { instruction: opts.instruction }),
    ...(opts.previousSendId === undefined ? {} : { previousSendId: opts.previousSendId }),
    ...(opts.nextAttemptAt === undefined ? {} : { nextAttemptAt: opts.nextAttemptAt }),
  });
  if (id === null) throw new Error("the request exists");
  const at = opts.at ?? NOW;
  await conn
    .updateTable("reply_requests")
    .set({ created_at: at, updated_at: at, next_attempt_at: opts.nextAttemptAt ?? at })
    .where("id", "=", id)
    .execute();
  return id;
}

// The To, Cc and Reply-To that a stored mail has (the recipients of Reply all and Use Reply-To come from them).
export async function setMailAddresses(
  conn: Conn,
  emailId: string,
  addresses: { to?: string[]; cc?: string[]; replyTo?: string[] }
): Promise<void> {
  await conn
    .updateTable("emails")
    .set({ to_addresses: addresses.to ?? [], cc_addresses: addresses.cc ?? [] })
    .where("id", "=", emailId)
    .execute();
  await conn
    .updateTable("email_headers")
    .set({ reply_to: addresses.replyTo ?? [] })
    .where("email_id", "=", emailId)
    .execute();
}

// One mail that the job has drafted (a fake model that answers `CLEAN_ANSWER`): the mail id and its waiting send.
export async function draftedReply(conn: Transaction<DB>, box: JobBox, clock: Clock, opts: MailOpts = {}) {
  const emailId = await addReplyMail(conn, box, opts);
  const { llm } = fakeLlm(() => CLEAN_ANSWER);
  await runJob(jobDeps(conn, llm, clock), box);
  const send = (await pairRows(conn, box)).find((row) => row.type === "send" && row.email_id === emailId);
  if (send === undefined) throw new Error("the job made no send");
  return { emailId, sendId: send.id };
}
