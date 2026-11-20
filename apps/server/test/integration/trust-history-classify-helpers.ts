import { randomUUID } from "node:crypto";

import { llmPrices, type Category, type EvidenceKey } from "@ea/core";

import { insertDefaultSettings } from "../../src/modules/config";
import { type HistoryCheckReason } from "../../src/modules/trust";
import type { Db } from "../../src/platform/db";
import type { LlmClient } from "../../src/platform/llm";

import { advance, RUNNING_KEY, withHistoryBox, type BoxOptions, type HistoryBox } from "./trust-history-helpers";

// Helpers for the tests of the classify step: a committed box with a check that waits in `classifying`, mail rows that
// the test places directly (the backfill is tested in its own files), and a fake model client with a fixed price.

export const MODEL = RUNNING_KEY.model;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Tokens that cost exactly one cent with the fixture price below (1 USD per million tokens in and out). */
export const CENT_TOKENS = 10_000;

/** Registers the fixture price of the test model; the returned function removes it. */
export function priceFixture(): () => void {
  llmPrices[MODEL] = [{ inputPerM: 1, outputPerM: 1, source: "test", checked: "2026-11-17" }];
  return () => {
    Reflect.deleteProperty(llmPrices, MODEL);
  };
}

export interface SeedMail {
  /** The category that the fake model answers for this mail (in its subject). Default `info`. */
  category?: Category;
  acted?: boolean;
  from?: string;
  body?: string | null;
  folder?: string;
  receivedAt?: Date;
  messageId?: string | null;
}

/** Inserts mail into the box, newest first (mail 0 is one hour old). Returns the ids in that order. */
export async function seedMails(db: Db, box: HistoryBox, mails: readonly SeedMail[]): Promise<string[]> {
  if (mails.length === 0) return [];
  const rows = mails.map((mail, index) => ({
    org_id: box.orgId,
    mailbox_id: box.mailboxId,
    dedup_key: `test:${randomUUID()}`,
    thread_key: `test:${randomUUID()}`,
    content_hash: "h",
    uid: 1000 + index,
    source_uid: 1000 + index,
    folder: mail.folder ?? "INBOX",
    source_folder: mail.folder ?? "INBOX",
    status: "skipped",
    skip_reason: "history_check",
    backfilled_at: box.clock.now,
    received_at: mail.receivedAt ?? new Date(box.clock.now.getTime() - (index + 1) * HOUR_MS),
    from_address: mail.from ?? `sender${index}@x.test`,
    subject: `CAT:${mail.category ?? "info"} item ${index}`,
    body_text: mail.body === undefined ? `Body of mail ${index}` : mail.body,
    message_id_header: mail.messageId === undefined ? `<m${index}-${randomUUID()}@x.test>` : mail.messageId,
  }));
  const ids = (await db.insertInto("emails").values(rows).returning("id").execute()).map((row) => row.id);
  const flags = mails.flatMap((mail, index) =>
    mail.acted === true
      ? [
          {
            email_id: ids[index] as string,
            org_id: box.orgId,
            seen: true,
            answered: true,
            flagged: false,
            checked_at: box.clock.now,
          },
        ]
      : []
  );
  if (flags.length > 0) await db.insertInto("email_flags").values(flags).execute();
  return ids;
}

/** A `classifying` check of the box: the key and the window are set as the backfill would set them. */
export async function seedClassifying(
  db: Db,
  box: HistoryBox,
  opts: { reason?: HistoryCheckReason; key?: EvidenceKey; nextAttemptAt?: Date } = {}
): Promise<string> {
  const row = await db
    .insertInto("history_checks")
    .values({
      org_id: box.orgId,
      mailbox_id: box.mailboxId,
      reason: opts.reason ?? "connect",
      status: "classifying",
      key: JSON.stringify(opts.key ?? RUNNING_KEY),
      window_start: new Date(box.clock.now.getTime() - 30 * DAY_MS),
      backfill_done_at: new Date(box.clock.now.getTime() - HOUR_MS),
      next_attempt_at: opts.nextAttemptAt ?? new Date(box.clock.now.getTime() - 60_000),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/** A committed box with default settings and one `classifying` check. */
export async function withClassifyBox(
  db: Db,
  opts: BoxOptions & { reason?: HistoryCheckReason },
  run: (box: HistoryBox, checkId: string) => Promise<void>
): Promise<void> {
  await withHistoryBox(db, { mails: 0, synced: false, ...opts }, async (box) => {
    await db.transaction().execute((trx) => insertDefaultSettings(trx, box, box.mailboxId));
    const checkId = await seedClassifying(db, box, opts.reason === undefined ? {} : { reason: opts.reason });
    await run(box, checkId);
  });
}

export interface FakeLlm extends LlmClient {
  /** The prompt of each call, in order (the subject of a test mail is `CAT:<category> item <index>`). */
  calls: { prompt: string }[];
}

/**
 * The fake model: it answers the category in the subject (`CAT:<category>`), costs `tokens` tokens in, and moves the fixed clock by
 * `delayMs` per call. `fail` returns an error for call number n (counted from 1) to throw instead.
 */
export function fakeLlm(
  box: HistoryBox,
  opts: {
    tokens?: number;
    delayMs?: number;
    model?: string;
    /** The model that the usage names (default: the model of the client). A test of a price that vanishes sets another one. */
    usageModel?: string;
    fail?: (n: number) => Error | undefined;
    /** Hand back the answer without the schema check of the client: a refused answer (a forbidden category) is then refused by the classifier, after the call. */
    raw?: boolean;
    /** The category for call number n (counted from 1), instead of the one in the subject. */
    answer?: (n: number) => Category;
  } = {}
): FakeLlm {
  const calls: { prompt: string }[] = [];
  return {
    calls,
    modelOf: () => opts.model ?? MODEL,
    endpointOf: () => "standard",
    providerOf: () => "openai",
    async generate(req) {
      calls.push({ prompt: req.prompt });
      const failure = opts.fail?.(calls.length);
      if (failure !== undefined) throw failure;
      if (opts.delayMs !== undefined) advance(box, opts.delayMs);
      const category = opts.answer?.(calls.length) ?? /CAT:([a-z_]+)/.exec(req.prompt)?.[1] ?? "info";
      return {
        data: (opts.raw === true ? (x: unknown) => x : req.schema.parse.bind(req.schema))({
          category,
          confidence: 0.9,
          reason_code: "newsletter",
          reason: "a fake answer",
          summary: category === "info" ? "short" : null,
          fields: { due_date: null, language: "en", delegate_id: null, task: null, clarification: null },
        }),
        usage: {
          role: req.role,
          promptVersion: req.promptVersion,
          model: opts.usageModel ?? opts.model ?? MODEL,
          tokensIn: opts.tokens ?? CENT_TOKENS,
          tokensOut: 0,
          latencyMs: opts.delayMs ?? 1,
          endpoint: "standard",
          provider: "openai" as const,
        },
      };
    },
  } as FakeLlm;
}

export async function itemsOf(db: Db, checkId: string) {
  return db.selectFrom("history_check_items").selectAll().where("check_id", "=", checkId).orderBy("email_id").execute();
}

export async function checkOf(db: Db, checkId: string) {
  return db.selectFrom("history_checks").selectAll().where("id", "=", checkId).executeTakeFirstOrThrow();
}

/** `done` and `no_result` rows must carry `finished_at`; an open row must not. */
export function expectFinishedTogether(check: { status: string; finished_at: Date | null }): void {
  const ended = check.status === "done" || check.status === "no_result";
  if (ended !== (check.finished_at !== null)) {
    throw new Error(`status ${check.status} and finished_at ${check.finished_at === null ? "null" : "set"} disagree`);
  }
}

export async function llmCallRows(db: Db, orgId: string) {
  return db
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", orgId)
    .where("event", "=", "llm.call")
    .orderBy("created_at")
    .execute();
}
