import { randomUUID } from "node:crypto";

import { textTables, type UserLocale } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { noDelegationHooks } from "../../src/modules/actions";
import {
  createLinkToken,
  createOutboxSender,
  createTelegramBot,
  createUpdateHandlers,
  detectNotices,
  scheduleDigests,
  type CommandDeps,
} from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { insertDefaultSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { markSynced } from "../../src/modules/mail/repo";
import { setDigestTimes } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertDelegate,
  insertDraftAndSend,
  insertTriaged,
  insertTriagedWithActions,
  isolateChannels,
  linkChat,
  randomChatId,
  renderedOf,
  suspendOrg,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { callbackUpdate, messageUpdate, recordCalls, testBotInfo } from "./telegram-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// Every Telegram path reads the language of the user: `pl` and no choice (null) give Polish, `en` gives English.
const users: { name: string; locale: UserLocale | null; expected: UserLocale }[] = [
  { name: "pl", locale: "pl", expected: "pl" },
  { name: "null", locale: null, expected: "pl" },
  { name: "en", locale: "en", expected: "en" },
];

const T = new Date("2026-11-06T10:00:00Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;
const TOKEN = "123456:LOCALETOKENaaaaaaaaaaaaaaaaaaaaaaaaaa";

let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

// An organization with a synced mailbox and its owner, who has the given locale. The fixture creates the owner with `en`.
async function member(
  trx: Transaction<DB>,
  locale: UserLocale | null,
  opts: { linked: boolean; linkedAt?: Date } = { linked: true }
) {
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  await trx.updateTable("users").set({ locale }).where("id", "=", created.userId).execute();
  await insertDefaultSettings(trx, ctx, created.mailboxId);
  await markSynced(trx, ctx, created.mailboxId, new Date(T.getTime() - 5 * MINUTE));
  await trx
    .updateTable("mailboxes")
    .set({ status_changed_at: new Date(T.getTime() - HOUR) })
    .where("id", "=", created.mailboxId)
    .execute();
  const chatId = randomChatId();
  if (opts.linked) await linkChat(trx, ctx, created.userId, chatId, opts.linkedAt ?? new Date(T.getTime() - HOUR));
  return { ...created, ctx, chatId };
}

function commandDeps(trx: Transaction<DB>): CommandDeps {
  return {
    db: trx,
    now: () => T,
    llmDailyCap: 300,
    triageScope: "all",
    actionsScope: { kind: "off" },
    llm: { provider: "gemini", classifierModel: "gemini-3.5-flash-lite" },
    hooks: noDelegationHooks,
    uidplus: async () => true,
    sendScope: { kind: "all" },
    testMail: NO_TEST_SENDERS,
    operatorContact: null,
  };
}

// The real bot with the real handlers; no request leaves the process.
function botFor(trx: Transaction<DB>) {
  const handlers = createUpdateHandlers(commandDeps(trx));
  const bot = createTelegramBot(TOKEN, { db: trx, now: () => T, handlers }, { botInfo: testBotInfo });
  const { calls } = recordCalls(bot);
  let updateId = 1;
  return {
    calls,
    send: (chatId: number, text: string) => bot.handleUpdate(messageUpdate({ updateId: updateId++, chatId, text })),
    tap: (chatId: number, data: string) =>
      bot.handleUpdate(callbackUpdate({ updateId: updateId++, chatId, data, messageId: 77 })),
  };
}

async function sendQueued(trx: Transaction<DB>): Promise<void> {
  await createOutboxSender({ db: trx, channel: createFakeChannel(), now: () => T }).run();
}

async function outboxRows(trx: Transaction<DB>, orgId: string, kind: string) {
  return trx
    .selectFrom("outbox")
    .select(["id", "kind", "text", "buttons", "view", "channel", "detail", "locale"])
    .where("org_id", "=", orgId)
    .where("kind", "=", kind)
    .execute();
}

function lastCall(calls: { method: string; payload: Record<string, unknown> }[], method: string) {
  return calls.filter((call) => call.method === method).at(-1)?.payload;
}

describe("an urgent notice", () => {
  test.each(users)("$name: the stored text and the row locale follow the user", async ({ locale, expected }) => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const m = await member(trx, locale);
      await insertTriaged(trx, m.ctx, m.mailboxId, {
        category: "urgent",
        createdAt: new Date(T.getTime() - 10 * MINUTE),
      });

      await detectNotices({ db: trx, now: () => T, startedAt: new Date(T.getTime() - HOUR) });
      await sendQueued(trx);

      const rows = await outboxRows(trx, m.orgId, "urgent");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.locale).toBe(expected);
      expect(rows[0]?.text?.startsWith(expected === "pl" ? "🔴 Pilna wiadomość" : "🔴 Urgent mail")).toBe(true);
    });
  });
});

describe("an approval request", () => {
  test.each(users)("$name: the card and the status line of the tap follow the user", async ({ locale, expected }) => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const m = await member(trx, locale);
      const to = `anna-${randomUUID()}@example.test`;
      const delegateId = await insertDelegate(trx, m.ctx, { name: "Anna Nowak", email: to });
      const pair = await insertDraftAndSend(trx, m.ctx, m.mailboxId, {
        createdAt: new Date(T.getTime() - 30 * MINUTE),
        draftProviderResult: { folder: "Drafts", uid: 7 },
        subject: "Quarterly offer",
        from: "boss@example.test",
        bodyText: "Please prepare the offer.",
        delegateName: "Anna Nowak",
        task: "Prepare the offer",
        to,
        delegateId,
      });

      await detectNotices({ db: trx, now: () => T, startedAt: new Date(T.getTime() - HOUR) });
      await sendQueued(trx);
      const cards = await outboxRows(trx, m.orgId, "approval");
      expect(cards).toHaveLength(1);
      const stored = cards[0]?.text ?? "";
      expect(stored.split("\n")[0]?.startsWith(expected === "pl" ? "📤 Wysłać?" : "📤 Send?")).toBe(true);

      const bot = botFor(trx);
      await bot.tap(m.chatId, `ap:${pair.sendId}`);
      const edited = lastCall(bot.calls, "editMessageText")?.text;
      expect(edited).toBe(`${stored}\n\n${textTables[expected].approvals.edit.approved("11:00")}`);
    });
  });
});

describe("a scheduled digest", () => {
  test.each(users)("$name: the queued view text follows the user", async ({ locale, expected }) => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      // Linked the evening before, so the 08:00 slot of the next day is due.
      const m = await member(trx, locale, { linked: true, linkedAt: new Date("2026-11-05T20:00:00Z") });
      await setDigestTimes(trx, m.ctx, m.userId, ["08:00", "16:00"]);

      await scheduleDigests({ db: trx, now: () => new Date("2026-11-06T07:00:00Z") });

      const rows = await outboxRows(trx, m.orgId, "digest");
      expect(rows).toHaveLength(1);
      const row = rows[0];
      if (!row) throw new Error("no digest row");
      const text = renderedOf(row).text;
      expect(text.startsWith(expected === "pl" ? "📬 Podsumowanie" : "📬 Digest")).toBe(true);
    });
  });
});

describe("/help", () => {
  test.each(users)("$name: the reply is the help text of the locale", async ({ locale, expected }) => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const m = await member(trx, locale);
      const bot = botFor(trx);

      await bot.send(m.chatId, "/help");

      expect(lastCall(bot.calls, "sendMessage")?.text).toBe(textTables[expected].bot.help);
    });
  });
});

describe("an undo tap with nothing to undo", () => {
  test.each(users)("$name: the answer is the text of the locale", async ({ locale, expected }) => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const m = await member(trx, locale);
      const emailId = await insertTriagedWithActions(trx, m.ctx, m.mailboxId, {
        category: "info",
        createdAt: T,
        actions: [{ type: "move", status: "logged" }],
      }).then((mail) => mail.emailId);
      const bot = botFor(trx);

      await bot.tap(m.chatId, `fu:${emailId}`);

      expect(lastCall(bot.calls, "answerCallbackQuery")?.text).toBe(textTables[expected].answers.undo.nothing);
    });
  });
});

describe("/start with a link token", () => {
  test.each(users)("$name: a new token gets the linked text", async ({ locale, expected }) => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const m = await member(trx, locale, { linked: false });
      const bot = botFor(trx);
      const { token } = await createLinkToken(trx, m.ctx, m.userId, T);

      await bot.send(m.chatId, `/start ${token}`);

      expect(lastCall(bot.calls, "sendMessage")?.text).toBe(textTables[expected].bot.linked);
    });
  });

  test.each(users)("$name: a used token gets the link-used text", async ({ locale, expected }) => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const m = await member(trx, locale, { linked: false });
      const bot = botFor(trx);
      const { token } = await createLinkToken(trx, m.ctx, m.userId, T);
      await bot.send(m.chatId, `/start ${token}`);
      bot.calls.length = 0;

      await bot.send(randomChatId(), `/start ${token}`);

      expect(lastCall(bot.calls, "sendMessage")?.text).toBe(textTables[expected].bot.linkUsed);
    });
  });

  test.each(users)("$name: an expired token gets the link-expired text", async ({ locale, expected }) => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const m = await member(trx, locale, { linked: false });
      const bot = botFor(trx);
      const { token } = await createLinkToken(trx, m.ctx, m.userId, new Date(T.getTime() - 16 * MINUTE));

      await bot.send(m.chatId, `/start ${token}`);

      expect(lastCall(bot.calls, "sendMessage")?.text).toBe(textTables[expected].bot.linkExpired);
    });
  });
});

describe("a suspended organization", () => {
  test.each(users)("$name: /status answers that the account is paused", async ({ locale, expected }) => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const m = await member(trx, locale);
      await suspendOrg(trx, m.orgId);
      const bot = botFor(trx);

      await bot.send(m.chatId, "/status");

      expect(lastCall(bot.calls, "sendMessage")?.text).toBe(textTables[expected].bot.accountPaused(null));
    });
  });
});

describe("the Polish status of an active mailbox", () => {
  test("no line holds two colons", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const m = await member(trx, "pl");
      const bot = botFor(trx);

      await bot.send(m.chatId, "/status");

      const text = String(lastCall(bot.calls, "sendMessage")?.text);
      expect(text).toContain("Tryb:");
      for (const line of text.split("\n")) expect(line.match(/:(?=\s|$)/g)?.length ?? 0).toBeLessThanOrEqual(1);
    });
  });
});
