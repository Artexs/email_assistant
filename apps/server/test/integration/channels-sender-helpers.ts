import { afterEach, beforeEach, expect, spyOn } from "bun:test";
import { type Transaction } from "kysely";

import { createOutboxSender, insertOutbox, type OutboxKind } from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { type DB, type TenantContext } from "../../src/platform/db";
import { setLogFormat, setLogLevel } from "../../src/platform/log";

import { createOrgWithMailbox, insertTestEmail, linkChat, randomChatId, testNoticeView } from "./fixtures";

export const T = new Date("2026-11-06T10:00:00Z");
export const SECRET = "secret body text";

export function at(offsetMs: number): Date {
  return new Date(T.getTime() + offsetMs);
}

export const SECOND = 1000;

let logLines: string[] = [];
let errorLines: string[] = [];

// Captures the log lines of each case; read them with `allLines()` or `expectEvent`.
export function captureLogs(): void {
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    setLogFormat("json");
    logLines = [];
    errorLines = [];
    logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logLines.push(args.join(" "));
    });
    errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errorLines.push(args.join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    setLogFormat("text");
    setLogLevel("info");
  });
}

export function allLines(): string[] {
  return [...logLines, ...errorLines];
}

const BASE_KEYS = ["time", "level", "module", "event", "msg"];
const UUID_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface LoggedEvent {
  level: string;
  fields: Record<string, unknown>;
}

// The `channels` event lines of one name: the level and the fields after the base keys. A dropped field shows as
// `dropped_fields`, so an exact match on `fields` also proves that every value passed the logger.
function eventsOf(event: string): LoggedEvent[] {
  return allLines().flatMap((line) => {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.module !== "channels" || parsed.event !== event) return [];
    const fields = Object.fromEntries(Object.entries(parsed).filter(([key]) => !BASE_KEYS.includes(key)));
    const outboxId = fields.outbox_id;
    if (outboxId !== undefined) expect(outboxId).toMatch(UUID_LOWER);
    return [{ level: String(parsed.level), fields }];
  });
}

export function expectEvent(event: string, level: string, fields: Record<string, unknown>): void {
  expect(eventsOf(event)).toEqual([{ level, fields }]);
}

export interface Tenant {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  chatId: number;
}

export async function tenant(trx: Transaction<DB>): Promise<Tenant> {
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  const chatId = randomChatId();
  await linkChat(trx, ctx, created.userId, chatId, T);
  return { ctx, userId: created.userId, mailboxId: created.mailboxId, chatId };
}

let counter = 0;

export async function addRow(
  trx: Transaction<DB>,
  t: Tenant,
  opts: {
    kind?: OutboxKind;
    createdAt?: Date;
    nextAttemptAt?: Date;
    userId?: string;
    digestId?: string;
    marker?: string;
    locale?: "pl" | "en";
    view?: Record<string, unknown>;
  } = {}
): Promise<string> {
  counter += 1;
  const kind = opts.kind ?? "urgent";
  // An `urgent` or approval row needs its e-mail (check constraint of the table).
  const emailId =
    kind === "urgent" || kind === "approval" || kind === "approval_set"
      ? await insertTestEmail(trx, t.ctx, t.mailboxId)
      : undefined;
  const id = await insertOutbox(trx, t.ctx, {
    userId: opts.userId ?? t.userId,
    kind,
    dedupKey: `sender:${counter}`,
    mailboxId: t.mailboxId,
    digestId: opts.digestId,
    emailId,
    view:
      opts.view ??
      testNoticeView(kind as "urgent" | "digest" | "approval" | "approval_set", {
        marker: opts.marker ?? `${SECRET} ${counter}`,
        emailId,
        at: T,
      }),
    locale: opts.locale ?? "en",
    createdAt: opts.createdAt ?? T,
    nextAttemptAt: opts.nextAttemptAt ?? T,
  });
  if (!id) throw new Error("insert returned null");
  return id;
}

export async function rowState(trx: Transaction<DB>, id: string) {
  return trx
    .selectFrom("outbox")
    .select(["status", "attempts", "next_attempt_at", "locked_at", "external_message_id", "error_code"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

export async function storedMessage(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("outbox").select(["text", "buttons"]).where("id", "=", id).executeTakeFirstOrThrow();
}

export function senderFor(trx: Transaction<DB>, channel = createFakeChannel()) {
  let now = T;
  const sender = createOutboxSender({ db: trx, channel, now: () => now });
  return {
    channel,
    run: async (when: Date) => {
      now = when;
      await sender.run();
    },
  };
}
