import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { textTables, type OutMessage, MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { BotError, GrammyError, HttpError } from "grammy";
import type { Transaction } from "kysely";

import { createLinkToken, createTelegramBot, type CommandName, type LinkedChat } from "../../src/modules/channels";
import type { CallbackResult, UpdateHandlers } from "../../src/modules/channels/port";
import { localeOfUser } from "../../src/modules/channels/telegram/bot";
import type { DB } from "../../src/platform/db";
import { setLogFormat, setLogLevel } from "../../src/platform/log";

import { addMember, createOrgWithMailbox, linkChat, randomChatId } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { callbackUpdate, messageUpdate, recordCalls, testBotInfo } from "./telegram-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// The bot token holds MARKER: a leak of the URL of an API call shows in `expectNoMarker`.
const TOKEN = "123456:MARKERROUTERTOKENaaaaaaaaaaaaaaaaaaaaaaaaa";
// A fake bot token as an error text: it passes the value rule of the logger, so only a correct field list keeps it out.
const CANARY = "123456:MARKER-TOKEN";
const T = new Date("2026-11-06T10:00:00Z");
const UNKNOWN_TOKEN = "A".repeat(43);

// The log is JSON; `lines` holds every line of both console streams, formatted like the console does,
// so a raw error object shows its fields.
let lines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  setLogFormat("json");
  setLogLevel("debug");
  lines = [];
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(format(...args));
  });
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(format(...args));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  setLogFormat("text");
  setLogLevel("info");
});

const BASE_KEYS = ["time", "level", "module", "event", "msg"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface LoggedEvent {
  level: string;
  fields: Record<string, unknown>;
}

// The `telegram` event lines of one name: the level and the fields after the base keys (the context keys `job`
// and `run_id` come first). A dropped field shows as `dropped_fields`, so an exact match on `fields` also
// proves that every value passed the logger.
function eventsOf(event: string): LoggedEvent[] {
  return lines.flatMap((line) => {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.module !== "telegram" || parsed.event !== event) return [];
    const fields = Object.fromEntries(Object.entries(parsed).filter(([key]) => !BASE_KEYS.includes(key)));
    return [{ level: String(parsed.level), fields }];
  });
}

// The fields of a line that ran in the context of an update.
const inUpdate = (fields: Record<string, unknown>): Record<string, unknown> => ({
  job: "telegram.update",
  run_id: expect.stringMatching(UUID),
  ...fields,
});

function expectNoMarker(): void {
  expect(lines.some((line) => line.includes("MARKER"))).toBe(false);
}

// A Telegram error of each kind; every one holds the canary where the real one holds the token or a text.
const telegramErrors: [string, () => unknown, Record<string, unknown>][] = [
  [
    "a GrammyError",
    () =>
      new GrammyError(
        "Call to 'sendMessage' failed!",
        { ok: false, error_code: 403, description: CANARY },
        "sendMessage",
        { text: CANARY }
      ),
    { error: "GrammyError", error_code: 403, method: "sendMessage" },
  ],
  [
    "an HttpError",
    () =>
      new HttpError("Network request for 'sendMessage' failed!", new Error(`https://api.telegram.org/bot${CANARY}/x`)),
    { error: "HttpError", method: "sendMessage" },
  ],
  ["another error", () => new Error(CANARY), { error: "Error" }],
];

function makeFake() {
  const commands: { link: LinkedChat; name: CommandName }[] = [];
  const callbacks: { link: LinkedChat; data: string }[] = [];
  const texts: { link: LinkedChat; text: string; replyToMessageId: number }[] = [];
  const state: { commandText: string; callback: () => CallbackResult; text: () => OutMessage | undefined } = {
    commandText: "STATUS-TEXT",
    callback: () => ({ answer: "Saved" }),
    text: () => ({ text: "TEXT-ANSWER", buttons: [] }),
  };
  const handlers: UpdateHandlers = {
    command(link, name) {
      commands.push({ link, name });
      return Promise.resolve({ text: state.commandText, buttons: [[{ text: "Btn", data: "x:1" }]] });
    },
    callback(link, data) {
      callbacks.push({ link, data });
      return Promise.resolve(state.callback());
    },
    text(link, text, replyToMessageId) {
      texts.push({ link, text, replyToMessageId });
      return Promise.resolve(state.text());
    },
  };
  return { commands, callbacks, texts, state, handlers };
}

function setup(trx: Transaction<DB>) {
  const fake = makeFake();
  const bot = createTelegramBot(TOKEN, { db: trx, now: () => T, handlers: fake.handlers }, { botInfo: testBotInfo });
  const recorder = recordCalls(bot);
  let updateId = 1;
  const send = (
    chatId: number,
    text: string,
    extra?: { chatType?: "group" | "supergroup"; fromIsBot?: boolean; replyToMessageId?: number }
  ) => bot.handleUpdate(messageUpdate({ updateId: updateId++, chatId, text, ...extra }));
  const tap = (chatId: number, data: string, messageId = 77) =>
    bot.handleUpdate(callbackUpdate({ updateId: updateId++, chatId, data, messageId }));
  return { fake, bot, calls: recorder.calls, send, tap };
}

async function linkedMember(trx: Transaction<DB>) {
  const created = await createOrgWithMailbox(trx);
  const chatId = randomChatId();
  await linkChat(trx, { orgId: created.orgId }, created.userId, chatId, T);
  return { ...created, chatId };
}

async function linkCount(trx: Transaction<DB>, chatId: number): Promise<number> {
  const rows = await trx
    .selectFrom("chat_links")
    .select("org_id")
    .where("external_chat_id", "=", String(chatId))
    .execute();
  return rows.length;
}

describe("telegram router", () => {
  test("an unlinked private chat gets no reply and reaches no handler", async () => {
    await withRollback(db, async (trx) => {
      const { fake, calls, send, tap } = setup(trx);
      const chatId = randomChatId();
      for (const text of ["hello", "/status", "/help", "/start", `/start ${UNKNOWN_TOKEN}`, "/start short"]) {
        await send(chatId, text);
      }
      await tap(chatId, `fe:${randomUUID()}`);
      expect(calls).toHaveLength(0);
      expect(fake.commands).toHaveLength(0);
      expect(fake.callbacks).toHaveLength(0);
    });
  });

  test("groups and bots get no reply", async () => {
    await withRollback(db, async (trx) => {
      const { fake, calls, send } = setup(trx);
      const linked = await linkedMember(trx);
      await send(-randomChatId(), "/status", { chatType: "group" });
      await send(-randomChatId(), "/status", { chatType: "supergroup" });
      await send(linked.chatId, "/status", { fromIsBot: true });
      expect(calls).toHaveLength(0);
      expect(fake.commands).toHaveLength(0);
    });
  });

  test("/start with a valid token links the chat", async () => {
    await withRollback(db, async (trx) => {
      const { calls, send } = setup(trx);
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const chatId = randomChatId();
      const { token } = await createLinkToken(trx, { orgId }, userId, T);
      await send(chatId, `/start ${token}`);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe("sendMessage");
      expect(calls[0]?.payload.text).toBe(textTables.en.bot.linked);
      expect(calls[0]?.payload.link_preview_options).toEqual({ is_disabled: true });
      expect(calls[0]?.payload.parse_mode).toBeUndefined();
      expect(await linkCount(trx, chatId)).toBe(1);
      expect(eventsOf("chat_linked")).toEqual([
        { level: "info", fields: inUpdate({ user_id: userId, org_id: orgId }) },
      ]);
    });
  });

  test("a used token from another chat gets LINK_USED_TEXT and no link", async () => {
    await withRollback(db, async (trx) => {
      const { calls, send } = setup(trx);
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const first = randomChatId();
      const second = randomChatId();
      const { token } = await createLinkToken(trx, { orgId }, userId, T);
      await send(first, `/start ${token}`);
      calls.length = 0;
      await send(second, `/start ${token}`);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.payload.text).toBe(textTables.en.bot.linkUsed);
      expect(await linkCount(trx, second)).toBe(0);
    });
  });

  test("a linked chat that sends its used token again gets ALREADY_LINKED_TEXT", async () => {
    await withRollback(db, async (trx) => {
      const { calls, send } = setup(trx);
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const chatId = randomChatId();
      const { token } = await createLinkToken(trx, { orgId }, userId, T);
      await send(chatId, `/start ${token}`);
      calls.length = 0;
      await send(chatId, `/start ${token}`);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe("sendMessage");
      expect(calls[0]?.payload.text).toBe(textTables.en.bot.alreadyLinked);
      expect(await linkCount(trx, chatId)).toBe(1);
    });
  });

  test("a linked chat that sends an expired token gets LINK_EXPIRED_TEXT", async () => {
    await withRollback(db, async (trx) => {
      const { calls, send } = setup(trx);
      const linked = await linkedMember(trx);
      const { token } = await createLinkToken(
        trx,
        { orgId: linked.orgId },
        linked.userId,
        new Date(T.getTime() - 16 * MINUTE_MS)
      );
      await send(linked.chatId, `/start ${token}`);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.payload.text).toBe(textTables.en.bot.linkExpired);
    });
  });

  test("an expired token gets LINK_EXPIRED_TEXT", async () => {
    await withRollback(db, async (trx) => {
      const { calls, send } = setup(trx);
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const chatId = randomChatId();
      const { token } = await createLinkToken(trx, { orgId }, userId, new Date(T.getTime() - 16 * MINUTE_MS));
      await send(chatId, `/start ${token}`);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.payload.text).toBe(textTables.en.bot.linkExpired);
      expect(await linkCount(trx, chatId)).toBe(0);
      expect(eventsOf("link_token_expired")).toEqual([{ level: "info", fields: inUpdate({}) }]);
    });
  });

  test("D12: a failed locale read falls back to pl and warns with the user id only", async () => {
    await withRollback(db, async (trx) => {
      const { userId } = await createOrgWithMailbox(trx);
      // Only the read of the users table fails; the error text must not reach the log.
      const failing = new Proxy(trx, {
        get(target, prop) {
          if (prop === "selectFrom") {
            return (table: string) => {
              if (table === "users") throw new Error("MARKER-DB-DOWN secret detail");
              return (target.selectFrom as (name: string) => unknown)(table);
            };
          }
          const value: unknown = Reflect.get(target, prop);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      expect(await localeOfUser(failing, userId)).toBe("pl");
      expect(eventsOf("telegram_locale_read_failed")).toEqual([
        { level: "warn", fields: { user_id: userId, error: "Error" } },
      ]);
      expect(lines.some((line) => line.includes("MARKER-DB-DOWN"))).toBe(false);
      // A working read: no choice (null) gives pl; a stored choice wins. The fixture user has `en`.
      await trx.updateTable("users").set({ locale: null }).where("id", "=", userId).execute();
      expect(await localeOfUser(trx, userId)).toBe("pl");
      await trx.updateTable("users").set({ locale: "en" }).where("id", "=", userId).execute();
      expect(await localeOfUser(trx, userId)).toBe("en");
    });
  });

  test("a linked chat: commands go to the handler, other text gets the help", async () => {
    await withRollback(db, async (trx) => {
      const { fake, calls, send } = setup(trx);
      const linked = await linkedMember(trx);
      await send(linked.chatId, "/status");
      expect(fake.commands).toHaveLength(1);
      expect(fake.commands[0]?.name).toBe("status");
      expect(fake.commands[0]?.link).toMatchObject({
        orgId: linked.orgId,
        userId: linked.userId,
        chatId: linked.chatId,
        role: "owner",
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.payload.text).toBe("STATUS-TEXT");
      expect(calls[0]?.payload.reply_markup).toEqual({ inline_keyboard: [[{ text: "Btn", callback_data: "x:1" }]] });

      calls.length = 0;
      for (const text of ["/start", "hello", "/foo"]) {
        await send(linked.chatId, text);
      }
      expect(calls.map((call) => call.payload.text)).toEqual([
        textTables.en.bot.help,
        textTables.en.bot.help,
        textTables.en.bot.help,
      ]);
      expect(fake.commands).toHaveLength(1);
    });
  });

  test("a line of text that replies to a message of the bot goes to the text handler; other text never does", async () => {
    await withRollback(db, async (trx) => {
      const { fake, calls, send } = setup(trx);
      const linked = await linkedMember(trx);

      await send(linked.chatId, "plain text, no reply");
      expect(fake.texts).toHaveLength(0);
      expect(calls.map((call) => call.payload.text)).toEqual([textTables.en.bot.help]);

      calls.length = 0;
      await send(linked.chatId, "say yes for Tuesday", { replyToMessageId: 4242 });
      expect(fake.texts).toHaveLength(1);
      expect(fake.texts[0]).toMatchObject({ text: "say yes for Tuesday", replyToMessageId: 4242 });
      expect(fake.texts[0]?.link).toMatchObject({ userId: linked.userId, orgId: linked.orgId });
      expect(calls.map((call) => call.payload.text)).toEqual(["TEXT-ANSWER"]);

      // The handler has no use for the line (it answers no message that takes text): the bot gives the help answer.
      calls.length = 0;
      fake.state.text = () => undefined;
      await send(linked.chatId, "another line", { replyToMessageId: 9 });
      expect(calls.map((call) => call.payload.text)).toEqual([textTables.en.bot.help]);
    });
  });

  test("a text handler that throws gives the error text; the line and the error text are in no log line", async () => {
    await withRollback(db, async (trx) => {
      const { fake, calls, send } = setup(trx);
      const linked = await linkedMember(trx);
      fake.state.text = () => {
        throw new Error(CANARY);
      };
      await send(linked.chatId, `a line with ${CANARY}`, { replyToMessageId: 5 });
      expect(calls.map((call) => call.payload.text)).toEqual([textTables.en.bot.error]);
      expect(eventsOf("text_failed")).toHaveLength(1);
      expect(lines.join("\n")).not.toContain(CANARY);
    });
  });

  test("a button tap answers, edits and sends", async () => {
    await withRollback(db, async (trx) => {
      const { fake, calls, tap } = setup(trx);
      const linked = await linkedMember(trx);
      fake.state.callback = () => ({
        answer: "Saved",
        edit: { text: "Edited", buttons: [] },
        send: { text: "Picker", buttons: [[{ text: "Urgent", data: "p:1" }]] },
      });
      await tap(linked.chatId, "fe:abc", 55);
      expect(fake.callbacks).toHaveLength(1);
      expect(fake.callbacks[0]?.data).toBe("fe:abc");
      expect(calls.map((call) => call.method)).toEqual(["answerCallbackQuery", "editMessageText", "sendMessage"]);
      expect(calls[0]?.payload.text).toBe("Saved");
      expect(calls[1]?.payload).toMatchObject({
        chat_id: linked.chatId,
        message_id: 55,
        text: "Edited",
        reply_markup: { inline_keyboard: [] },
      });
      expect(calls[2]?.payload.text).toBe("Picker");
    });
  });

  test("a result with a keyboard only edits the buttons of the tapped message, never its text (review 19 N2)", async () => {
    await withRollback(db, async (trx) => {
      const { fake, calls, tap } = setup(trx);
      const linked = await linkedMember(trx);
      fake.state.callback = () => ({ answer: "Done.", keyboard: [[{ text: "Btn", data: "x:1" }]] });
      await tap(linked.chatId, "lc:abc", 56);
      expect(calls.map((call) => call.method)).toEqual(["answerCallbackQuery", "editMessageReplyMarkup"]);
      expect(calls[1]?.payload).toMatchObject({
        chat_id: linked.chatId,
        message_id: 56,
        reply_markup: { inline_keyboard: [[{ text: "Btn", callback_data: "x:1" }]] },
      });
      expect("text" in (calls[1]?.payload ?? {})).toBe(false);
    });
  });

  test("a failing callback handler answers ERROR_TEXT and logs without the message", async () => {
    await withRollback(db, async (trx) => {
      const { fake, calls, tap } = setup(trx);
      const linked = await linkedMember(trx);
      fake.state.callback = () => {
        throw new Error("MARKER-ERR");
      };
      await tap(linked.chatId, "fe:abc");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe("answerCallbackQuery");
      expect(calls[0]?.payload.text).toBe(textTables.en.bot.error);
      expect(eventsOf("callback_failed")).toEqual([{ level: "error", fields: inUpdate({ error: "Error" }) }]);
      expect(lines.some((line) => line.includes("MARKER-ERR"))).toBe(false);
    });
  });

  test("a button answer error is logged by fields and an unmodified edit is no failure; the flow goes on", async () => {
    await withRollback(db, async (trx) => {
      const { fake, bot, calls, tap } = setup(trx);
      const linked = await linkedMember(trx);
      fake.state.callback = () => ({
        answer: "Saved",
        edit: { text: "Edited", buttons: [] },
        send: { text: "Picker", buttons: [] },
      });
      // Installed last, so it runs first: it records the call through the recorder, then throws.
      bot.api.config.use(async (prev, method, payload) => {
        if (method === "answerCallbackQuery") {
          await prev(method, payload);
          throw new GrammyError("x", { ok: false, error_code: 500, description: "MARKER-ANSWER" }, method, payload);
        }
        if (method === "editMessageText") {
          await prev(method, payload);
          throw new GrammyError(
            "x",
            { ok: false, error_code: 400, description: "Bad Request: message is not modified MARKER-EDIT" },
            method,
            payload
          );
        }
        return prev(method, payload);
      });
      await tap(linked.chatId, "fe:abc");
      expect(calls.map((call) => call.method)).toEqual(["answerCallbackQuery", "editMessageText", "sendMessage"]);
      // The 400 "message is not modified" is not a failure: no `message_edit_failed` line.
      expect(eventsOf("message_edit_failed")).toEqual([]);
      expect(eventsOf("callback_answer_failed")).toEqual([
        { level: "warn", fields: inUpdate({ error: "GrammyError", error_code: 500, method: "answerCallbackQuery" }) },
      ]);
      expectNoMarker();
    });
  });

  test("the tenant comes from the link", async () => {
    await withRollback(db, async (trx) => {
      const { fake, send } = setup(trx);
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const memberB = await addMember(trx, b.orgId);
      const chatId = randomChatId();
      await linkChat(trx, { orgId: b.orgId }, memberB, chatId, T);
      await send(chatId, "/digest");
      expect(fake.commands[0]?.link.orgId).toBe(b.orgId);
      expect(fake.commands[0]?.link.orgId).not.toBe(a.orgId);
      expect(fake.commands[0]?.link.userId).toBe(memberB);
    });
  });

  test("a failing command handler replies ERROR_TEXT and logs the error name only", async () => {
    await withRollback(db, async (trx) => {
      const { fake, calls, send } = setup(trx);
      const linked = await linkedMember(trx);
      fake.handlers.command = () => Promise.reject(new Error("MARKER-CMD"));
      await send(linked.chatId, "/status");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe("sendMessage");
      expect(calls[0]?.payload.text).toBe(textTables.en.bot.error);
      expect(eventsOf("command_failed")).toEqual([{ level: "error", fields: inUpdate({ error: "Error" }) }]);
      expect(lines.some((line) => line.includes("MARKER-CMD"))).toBe(false);
    });
  });

  test("a failing reply after a good command is a warn, not a second ERROR_TEXT", async () => {
    await withRollback(db, async (trx) => {
      const { bot, calls, send } = setup(trx);
      const linked = await linkedMember(trx);
      bot.api.config.use(async (prev, method, payload) => {
        if (method === "sendMessage") {
          await prev(method, payload);
          throw new GrammyError("x", { ok: false, error_code: 500, description: "MARKER-SEND" }, method, payload);
        }
        return prev(method, payload);
      });
      await send(linked.chatId, "/status");
      expect(calls.filter((call) => call.payload.text === textTables.en.bot.error)).toHaveLength(0);
      expect(calls.filter((call) => call.method === "sendMessage")).toHaveLength(1);
      expect(eventsOf("command_reply_failed")).toEqual([
        { level: "warn", fields: inUpdate({ error: "GrammyError", error_code: 500, method: "sendMessage" }) },
      ]);
      expect(eventsOf("command_failed")).toEqual([]);
      expectNoMarker();
    });
  });

  test("no log line holds the token, a chat id, a text or button data", async () => {
    await withRollback(db, async (trx) => {
      const { fake, send, tap } = setup(trx);
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const chatId = randomChatId();
      const { token } = await createLinkToken(trx, { orgId }, userId, T);
      await send(chatId, `/start ${token}`);
      await send(chatId, `/start ${token}`);
      await send(randomChatId(), `/start ${UNKNOWN_TOKEN}`);
      await send(chatId, "SECRET-TEXT-123");
      await send(chatId, "/status");
      fake.state.callback = () => {
        throw new Error("MARKER-ERR");
      };
      await tap(chatId, "fe:BUTTON-DATA-9");
      const all = lines.join("\n");
      expect(lines.length).toBeGreaterThan(0);
      for (const secret of [token, TOKEN, String(chatId), "SECRET-TEXT-123", "BUTTON-DATA-9", "MARKER-ERR"]) {
        expect(all).not.toContain(secret);
      }
    });
  });
});

describe("telegram router: log lines", () => {
  const unlinkedUpdate = (updateId: number, chatId: number) => messageUpdate({ updateId, chatId, text: "hi" });

  test("one update writes its lines with job telegram.update and a UUID run_id", async () => {
    await withRollback(db, async (trx) => {
      const { bot } = setup(trx);
      await bot.handleUpdate(unlinkedUpdate(1, randomChatId()));
      expect(eventsOf("update_unlinked_chat")).toEqual([{ level: "debug", fields: inUpdate({}) }]);
    });
  });

  test("two updates at once write two different run_id values", async () => {
    await withRollback(db, async (trx) => {
      const { bot } = setup(trx);
      await Promise.all([
        bot.handleUpdate(unlinkedUpdate(1, randomChatId())),
        bot.handleUpdate(unlinkedUpdate(2, randomChatId())),
      ]);
      const runIds = eventsOf("update_unlinked_chat").map((event) => event.fields.run_id);
      expect(runIds).toHaveLength(2);
      expect(runIds.every((id) => typeof id === "string" && UUID.test(id))).toBe(true);
      expect(runIds[0]).not.toBe(runIds[1]);
    });
  });

  test("a line after an await keeps the run_id: command_failed after a timer", async () => {
    await withRollback(db, async (trx) => {
      const { fake, send } = setup(trx);
      const linked = await linkedMember(trx);
      fake.handlers.command = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error(CANARY);
      };
      await send(linked.chatId, "/status");
      expect(eventsOf("command_failed")).toEqual([{ level: "error", fields: inUpdate({ error: "Error" }) }]);
      expectNoMarker();
    });
  });

  test("callback_failed and callback_answer_failed of one tap share the run_id", async () => {
    await withRollback(db, async (trx) => {
      const { fake, bot, tap } = setup(trx);
      const linked = await linkedMember(trx);
      fake.state.callback = () => {
        throw new Error(CANARY);
      };
      bot.api.config.use((prev, method, payload) => {
        if (method === "answerCallbackQuery") {
          throw new GrammyError("x", { ok: false, error_code: 400, description: CANARY }, method, payload);
        }
        return prev(method, payload);
      });
      await tap(linked.chatId, "fe:abc");
      const [failed, answer] = [eventsOf("callback_failed"), eventsOf("callback_answer_failed")];
      expect(failed).toEqual([{ level: "error", fields: inUpdate({ error: "Error" }) }]);
      expect(answer).toEqual([
        { level: "warn", fields: inUpdate({ error: "GrammyError", error_code: 400, method: "answerCallbackQuery" }) },
      ]);
      expect(failed[0]?.fields.run_id).toBe(answer[0]?.fields.run_id);
      expectNoMarker();
    });
  });

  test("update_failed of bot.catch carries the update_id and no run_id", async () => {
    await withRollback(db, async (trx) => {
      const { bot } = setup(trx);
      const linked = await linkedMember(trx);
      bot.api.config.use((_prev, method, payload) => {
        throw new GrammyError("x", { ok: false, error_code: 400, description: CANARY }, method, payload);
      });
      // grammY 1.46: only the polling loop calls the error handler; the test does the same.
      const failure = await bot.handleUpdate(messageUpdate({ updateId: 4242, chatId: linked.chatId, text: "hi" })).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(failure).toBeInstanceOf(BotError);
      await bot.errorHandler(failure as BotError);
      expect(eventsOf("update_failed")).toEqual([
        { level: "error", fields: { update_id: 4242, error: "GrammyError", error_code: 400, method: "sendMessage" } },
      ]);
      expectNoMarker();
    });
  });

  test("link_token_used and link_token_unknown write no id and no token", async () => {
    await withRollback(db, async (trx) => {
      const { send } = setup(trx);
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const { token } = await createLinkToken(trx, { orgId }, userId, T);
      await send(randomChatId(), `/start ${token}`);
      await send(randomChatId(), `/start ${token}`);
      await send(randomChatId(), `/start ${UNKNOWN_TOKEN}`);
      expect(eventsOf("link_token_used")).toEqual([{ level: "info", fields: inUpdate({}) }]);
      expect(eventsOf("link_token_unknown")).toEqual([{ level: "debug", fields: inUpdate({}) }]);
      expect(lines.some((line) => line.includes(token) || line.includes(UNKNOWN_TOKEN))).toBe(false);
    });
  });

  // Each error kind reaches each line through its real path; the line holds the fields, never the canary.
  for (const [kind, make, expected] of telegramErrors) {
    describe(`with ${kind}`, () => {
      test("command_failed", async () => {
        await withRollback(db, async (trx) => {
          const { fake, send } = setup(trx);
          const linked = await linkedMember(trx);
          fake.handlers.command = () => Promise.reject(make());
          await send(linked.chatId, "/status");
          expect(eventsOf("command_failed")).toEqual([{ level: "error", fields: inUpdate(expected) }]);
          expectNoMarker();
        });
      });

      test("callback_failed", async () => {
        await withRollback(db, async (trx) => {
          const { fake, tap } = setup(trx);
          const linked = await linkedMember(trx);
          fake.state.callback = () => {
            throw make();
          };
          await tap(linked.chatId, "fe:abc");
          expect(eventsOf("callback_failed")).toEqual([{ level: "error", fields: inUpdate(expected) }]);
          expectNoMarker();
        });
      });

      // The transformer is installed last, so it runs first: it throws before the recorder answers.
      const failApi = (bot: ReturnType<typeof setup>["bot"], failing: string): void => {
        bot.api.config.use((prev, method, payload) => {
          if (method === failing) throw make();
          return prev(method, payload);
        });
      };

      test("command_reply_failed", async () => {
        await withRollback(db, async (trx) => {
          const { bot, send } = setup(trx);
          const linked = await linkedMember(trx);
          failApi(bot, "sendMessage");
          await send(linked.chatId, "/status");
          expect(eventsOf("command_reply_failed")).toEqual([{ level: "warn", fields: inUpdate(expected) }]);
          expectNoMarker();
        });
      });

      test("callback_answer_failed", async () => {
        await withRollback(db, async (trx) => {
          const { bot, tap } = setup(trx);
          const linked = await linkedMember(trx);
          failApi(bot, "answerCallbackQuery");
          await tap(linked.chatId, "fe:abc");
          expect(eventsOf("callback_answer_failed")).toEqual([{ level: "warn", fields: inUpdate(expected) }]);
          expectNoMarker();
        });
      });

      test("message_edit_failed", async () => {
        await withRollback(db, async (trx) => {
          const { fake, bot, tap } = setup(trx);
          const linked = await linkedMember(trx);
          fake.state.callback = () => ({ answer: "Saved", edit: { text: "Edited", buttons: [] } });
          failApi(bot, "editMessageText");
          await tap(linked.chatId, "fe:abc");
          expect(eventsOf("message_edit_failed")).toEqual([{ level: "warn", fields: inUpdate(expected) }]);
          expectNoMarker();
        });
      });

      test("update_failed", async () => {
        await withRollback(db, async (trx) => {
          const { bot } = setup(trx);
          const linked = await linkedMember(trx);
          failApi(bot, "sendMessage");
          const failure = await bot
            .handleUpdate(messageUpdate({ updateId: 77, chatId: linked.chatId, text: "hi" }))
            .then(
              () => undefined,
              (error: unknown) => error
            );
          await bot.errorHandler(failure as BotError);
          expect(eventsOf("update_failed")).toEqual([{ level: "error", fields: { update_id: 77, ...expected } }]);
          expectNoMarker();
        });
      });
    });
  }
});
