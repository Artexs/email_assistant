import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { BotError, GrammyError } from "grammy";
import type { Transaction } from "kysely";

import { createLinkToken, createTelegramBot, type CommandName, type LinkedChat } from "../../src/modules/channels";
import type { CallbackResult, UpdateHandlers } from "../../src/modules/channels/port";
import { ERROR_TEXT, helpText, LINK_EXPIRED_TEXT, LINK_USED_TEXT, LINKED_TEXT } from "../../src/modules/channels/texts";
import type { DB } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, linkChat, randomChatId } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { callbackUpdate, messageUpdate, recordCalls, testBotInfo } from "./telegram-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const TOKEN = "123456:ROUTERTOKENaaaaaaaaaaaaaaaaaaaaaaaaa";
const T = new Date("2026-11-06T10:00:00Z");
const UNKNOWN_TOKEN = "A".repeat(43);

let lines: { level: string; text: string }[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  lines = [];
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push({ level: "log", text: args.join(" ") });
  });
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push({ level: "error", text: args.join(" ") });
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

function makeFake() {
  const commands: { link: LinkedChat; name: CommandName }[] = [];
  const callbacks: { link: LinkedChat; data: string }[] = [];
  const state: { commandText: string; callback: () => CallbackResult } = {
    commandText: "STATUS-TEXT",
    callback: () => ({ answer: "Saved" }),
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
  };
  return { commands, callbacks, state, handlers };
}

function setup(trx: Transaction<DB>) {
  const fake = makeFake();
  const bot = createTelegramBot(TOKEN, { db: trx, now: () => T, handlers: fake.handlers }, { botInfo: testBotInfo });
  const recorder = recordCalls(bot);
  let updateId = 1;
  const send = (chatId: number, text: string, extra?: { chatType?: "group" | "supergroup"; fromIsBot?: boolean }) =>
    bot.handleUpdate(messageUpdate({ updateId: updateId++, chatId, text, ...extra }));
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
      expect(calls[0]?.payload.text).toBe(LINKED_TEXT);
      expect(calls[0]?.payload.link_preview_options).toEqual({ is_disabled: true });
      expect(calls[0]?.payload.parse_mode).toBeUndefined();
      expect(await linkCount(trx, chatId)).toBe(1);
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
      expect(calls[0]?.payload.text).toBe(LINK_USED_TEXT);
      expect(await linkCount(trx, second)).toBe(0);
    });
  });

  test("an expired token gets LINK_EXPIRED_TEXT", async () => {
    await withRollback(db, async (trx) => {
      const { calls, send } = setup(trx);
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const chatId = randomChatId();
      const { token } = await createLinkToken(trx, { orgId }, userId, new Date(T.getTime() - 16 * 60_000));
      await send(chatId, `/start ${token}`);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.payload.text).toBe(LINK_EXPIRED_TEXT);
      expect(await linkCount(trx, chatId)).toBe(0);
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
      expect(calls.map((call) => call.payload.text)).toEqual([helpText(), helpText(), helpText()]);
      expect(fake.commands).toHaveLength(1);
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
      expect(calls[0]?.payload.text).toBe(ERROR_TEXT);
      const errors = lines.filter((line) => line.level === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.text).toContain("callback failed");
      expect(lines.some((line) => line.text.includes("MARKER-ERR"))).toBe(false);
    });
  });

  test("button answer and edit errors are logged by label, and the flow goes on", async () => {
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
      const warns = lines.filter(
        (line) => line.text.includes("answering a button tap failed") || line.text.includes("editing a message failed")
      );
      expect(warns).toHaveLength(1);
      expect(warns[0]?.text).toContain("answering a button tap failed");
      expect(lines.some((line) => line.text.includes("MARKER"))).toBe(false);
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

  test("a handler error is logged by label only", async () => {
    await withRollback(db, async (trx) => {
      const { fake, bot, calls, send } = setup(trx);
      const linked = await linkedMember(trx);
      fake.handlers.command = () => Promise.reject(new Error("MARKER-CMD"));
      // `handleUpdate` throws; the polling loop passes the error to the handler that `bot.catch` set.
      const error = await send(linked.chatId, "/status").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BotError);
      await bot.errorHandler(error as BotError);
      expect(calls).toHaveLength(0);
      const errors = lines.filter((line) => line.level === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.text).toContain("failed: Error");
      expect(lines.some((line) => line.text.includes("MARKER-CMD"))).toBe(false);
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
      const all = lines.map((line) => line.text).join("\n");
      expect(lines.length).toBeGreaterThan(0);
      for (const secret of [token, TOKEN, String(chatId), "SECRET-TEXT-123", "BUTTON-DATA-9", "MARKER-ERR"]) {
        expect(all).not.toContain(secret);
      }
    });
  });
});
