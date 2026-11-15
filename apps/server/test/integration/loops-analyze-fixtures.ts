import { randomUUID } from "node:crypto";

import type { Transaction } from "kysely";

import { insertDefaultSettings } from "../../src/modules/config";
import type { AnalyzeDeps } from "../../src/modules/loops";
import { upsertOrgFeature } from "../../src/modules/tenancy";
import { createLlmPause } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";
import type { GenerateFn, GenerateRequest } from "../../src/platform/llm";
import { createFixedLlmClient } from "../../src/platform/llm/testing";

import { newOrg, NOW, type Org } from "./mail-sent-fixtures";

// Shared setup of the Sent analysis tests (F116 stage 12).

export { NOW };

// Wednesday 2026-11-18, 10:00 UTC: the day of most test mails.
export const WED = new Date("2026-11-18T10:00:00Z");
export const FRI = new Date("2026-11-20T10:00:00Z");
// The clock of the runs: Friday 11:00 UTC, so a mail of Wednesday or Friday is under 14 days old.
export const RUN_AT = new Date("2026-11-20T11:00:00Z");

// An organization with the Sent flag, the switch, and the flag `open_loops` on.
export async function loopsOrg(trx: Transaction<DB>, opts: { loopsFlag?: boolean } = {}): Promise<Org> {
  const org = await newOrg(trx);
  await insertDefaultSettings(trx, org.ctx, org.mailboxId);
  await upsertOrgFeature(trx, org.ctx, {
    flag: "open_loops",
    enabled: opts.loopsFlag !== false,
    setBy: "test",
    setAt: NOW,
  });
  return org;
}

export interface MailOpts {
  to?: string[];
  cc?: string[];
  subject?: string | null;
  body?: string | null;
  sentAt?: Date;
  threadKey?: string;
  messageId?: string;
  content?: "pending" | "stored" | "headers_only" | "gone";
  listId?: string | null;
  autoSubmitted?: string | null;
  hasCalendar?: boolean;
  fromAddress?: string | null;
}

// One user row of `sent_emails`. Returns the id.
export async function sentMail(trx: Transaction<DB>, org: Org, opts: MailOpts = {}): Promise<string> {
  const content = opts.content ?? "stored";
  const sentAt = opts.sentAt ?? WED;
  const row = await trx
    .insertInto("sent_emails")
    .values({
      org_id: org.ctx.orgId,
      mailbox_id: org.mailboxId,
      dedup_key: `mid:<${randomUUID()}@x.test>:h1`,
      path: "Sent",
      uidvalidity: "7",
      uid: String(Math.floor(Math.random() * 1_000_000_000)),
      message_id: opts.messageId ?? `<${randomUUID()}@x.test>`,
      thread_key: opts.threadKey ?? `<${randomUUID()}@x.test>`,
      from_address: opts.fromAddress ?? null,
      to_addresses: opts.to ?? ["anna@example.test"],
      cc_addresses: opts.cc ?? [],
      subject: opts.subject === undefined ? "Offer for next week" : opts.subject,
      body_text: content === "stored" ? (opts.body === undefined ? "Can you send the numbers?" : opts.body) : null,
      list_id: opts.listId ?? null,
      auto_submitted: opts.autoSubmitted ?? null,
      has_calendar: opts.hasCalendar ?? false,
      origin: "user",
      content,
      sent_at: sentAt,
      internal_date: sentAt,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

export interface Answer {
  expects_reply: boolean;
  ask: string | null;
  due: unknown;
  promise: string | null;
  promise_due: unknown;
  language: "pl" | "en" | "other";
}

export const ASK: Answer = {
  expects_reply: true,
  ask: "send the numbers",
  due: null,
  promise: null,
  promise_due: null,
  language: "en",
};

export interface FakeExtractor {
  llm: ReturnType<typeof createFixedLlmClient>;
  requests: GenerateRequest[];
}

// A model client for the extractor role. `reply` is the JSON answer, or a function of the call number (1-based) that
// returns the answer or throws. Every call is counted in `requests`.
// The key that the log tests plant in the client. No log line and no audit row may hold it.
export const PLANTED_KEY = "PLANTED-KEY-f116";

export function fakeExtractor(reply: Answer | ((call: number) => Answer | never) = ASK): FakeExtractor {
  const requests: GenerateRequest[] = [];
  const generate: GenerateFn = async (request) => {
    requests.push(request);
    const answer = typeof reply === "function" ? reply(requests.length) : reply;
    return { text: JSON.stringify(answer), tokensIn: 100, tokensOut: 20, blocked: false };
  };
  return { llm: createFixedLlmClient(generate, { model: "fake-extractor", apiKey: PLANTED_KEY }), requests };
}

export function depsOf(trx: Transaction<DB>, fake: FakeExtractor, extra: Partial<AnalyzeDeps> = {}): AnalyzeDeps {
  return { db: trx, llm: fake.llm, dailyCap: 300, scope: { kind: "all" }, pause: createLlmPause(), ...extra };
}

export async function analysisOf(trx: Transaction<DB>, sentEmailId: string) {
  return trx.selectFrom("sent_analyses").selectAll().where("sent_email_id", "=", sentEmailId).executeTakeFirst();
}

export async function loopsOf(trx: Transaction<DB>, org: Org) {
  return trx
    .selectFrom("open_loops")
    .selectAll()
    .where("org_id", "=", org.ctx.orgId)
    .orderBy("created_at")
    .orderBy("kind")
    .execute();
}
