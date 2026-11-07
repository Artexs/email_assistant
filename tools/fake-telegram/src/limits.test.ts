import { afterEach, describe, expect, test } from "bun:test";
import { Api, Bot, GrammyError } from "grammy";

import { startFakeTelegram, type FakeTelegram } from "./server";
import { DEFAULT_CHAT_ID, FAKE_TOKEN } from "./state";

let fake: FakeTelegram | undefined;

const running = () => {
  if (!fake) throw new Error("fake not started");
  return fake;
};

afterEach(async () => {
  await fake?.stop();
  fake = undefined;
});

const start = (chat = true) => {
  fake = startFakeTelegram();
  if (chat) fake.state.sendAsUser({ chatId: DEFAULT_CHAT_ID, text: "hi" });
  return new Api(FAKE_TOKEN, { apiRoot: fake.apiRoot });
};

const keyboard = (data: string) => ({ reply_markup: { inline_keyboard: [[{ text: "B", callback_data: data }]] } });

async function failure(promise: Promise<unknown>): Promise<GrammyError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GrammyError) return error;
    throw error;
  }
  throw new Error("the call did not fail");
}

const rawGetUpdates = (timeout: number) =>
  fetch(`${running().apiRoot}/bot${FAKE_TOKEN}/getUpdates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ timeout }),
  });

describe("fake telegram limits and errors", () => {
  test("a wrong token gives 401", async () => {
    start();
    const api = new Api("1000001:wrong-token-wrong-token-wrong", { apiRoot: running().apiRoot });
    const error = await failure(api.getMe());
    expect(error.error_code).toBe(401);
    expect(error.description).toBe("Unauthorized");
  });

  test("an unknown method gives 404", async () => {
    start();
    const response = await fetch(`${running().apiRoot}/bot${FAKE_TOKEN}/noSuchMethod`, { method: "POST" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error_code: 404, description: "Not Found" });
  });

  test("sendMessage before any user message gives chat not found", async () => {
    const api = start(false);
    const error = await failure(api.sendMessage(DEFAULT_CHAT_ID, "hello"));
    expect(error.error_code).toBe(400);
    expect(error.description).toContain("chat not found");
  });

  test("empty text is refused", async () => {
    const api = start();
    for (const text of ["", " "]) {
      const error = await failure(api.sendMessage(DEFAULT_CHAT_ID, text));
      expect(error.error_code).toBe(400);
      expect(error.description).toContain("message text is empty");
    }
  });

  test("4096 characters pass and 4097 are too long", async () => {
    const api = start();
    await api.sendMessage(DEFAULT_CHAT_ID, "a".repeat(4096));
    const error = await failure(api.sendMessage(DEFAULT_CHAT_ID, "a".repeat(4097)));
    expect(error.error_code).toBe(400);
    expect(error.description).toContain("message is too long");
  });

  test("callback_data counts bytes: 64 pass, 66 fail", async () => {
    const api = start();
    await api.sendMessage(DEFAULT_CHAT_ID, "ok", keyboard("a".repeat(64)));
    const error = await failure(api.sendMessage(DEFAULT_CHAT_ID, "bad", keyboard("ż".repeat(33))));
    expect(error.error_code).toBe(400);
    expect(error.description).toContain("BUTTON_DATA_INVALID");
  });

  test("an edit with the same content is not modified, other buttons are accepted", async () => {
    const api = start();
    const sent = await api.sendMessage(DEFAULT_CHAT_ID, "text", keyboard("a"));
    const error = await failure(api.editMessageText(DEFAULT_CHAT_ID, sent.message_id, "text", keyboard("a")));
    expect(error.error_code).toBe(400);
    expect(error.description).toContain("message is not modified");
    await api.editMessageText(DEFAULT_CHAT_ID, sent.message_id, "text", keyboard("b"));
  });

  test("an edit of an unknown message is refused", async () => {
    const api = start();
    const error = await failure(api.editMessageText(DEFAULT_CHAT_ID, 999, "text"));
    expect(error.error_code).toBe(400);
    expect(error.description).toContain("message to edit not found");
  });

  test("an edit of a user message is refused", async () => {
    const api = start(false);
    const { message } = running().state.sendAsUser({ chatId: DEFAULT_CHAT_ID, text: "mine" });
    const error = await failure(api.editMessageText(DEFAULT_CHAT_ID, message.messageId, "changed"));
    expect(error.error_code).toBe(400);
    expect(error.description).toContain("message to edit not found");
  });

  test("a second answer of one callback query is refused", async () => {
    const api = start();
    const { state } = running();
    const sent = await api.sendMessage(DEFAULT_CHAT_ID, "text", keyboard("a"));
    const { callback } = state.pressButton({ chatId: DEFAULT_CHAT_ID, messageId: sent.message_id, data: "a" });
    await api.answerCallbackQuery(callback.id);
    const error = await failure(api.answerCallbackQuery(callback.id));
    expect(error.error_code).toBe(400);
    expect(error.description).toContain("query ID is invalid");
  });

  test("failNext 429 fails one call with retry_after", async () => {
    const api = start();
    running().failNext("sendMessage", { code: 429, retryAfter: 3 });
    const error = await failure(api.sendMessage(DEFAULT_CHAT_ID, "one"));
    expect(error.error_code).toBe(429);
    expect(error.parameters.retry_after).toBe(3);
    await api.sendMessage(DEFAULT_CHAT_ID, "two");
  });

  test("failNext with times fails that many calls", async () => {
    const api = start();
    running().failNext("getMe", { code: 409 }, 2);
    expect((await failure(api.getMe())).error_code).toBe(409);
    expect((await failure(api.getMe())).error_code).toBe(409);
    expect((await api.getMe()).username).toBe("fake_ea_bot");
  });

  test("an injected 409 on getUpdates makes bot.start reject", async () => {
    start();
    running().failNext("getUpdates", { code: 409 });
    const bot = new Bot(FAKE_TOKEN, { client: { apiRoot: running().apiRoot } });
    const error = await failure(bot.start());
    expect(error.error_code).toBe(409);
  });

  test("a second parallel getUpdates ends the first with 409", async () => {
    start(false);
    const first = rawGetUpdates(5);
    await Bun.sleep(100);
    const second = rawGetUpdates(5);
    const firstResponse = await first;
    expect(firstResponse.status).toBe(409);
    const body = (await firstResponse.json()) as { ok: boolean; error_code: number };
    expect(body).toMatchObject({ ok: false, error_code: 409 });

    running().state.sendAsUser({ chatId: DEFAULT_CHAT_ID, text: "later" });
    const secondResponse = await second;
    expect(secondResponse.status).toBe(200);
  });

  test("an aborted waiting getUpdates gives no 409 and a later one works", async () => {
    start(false);
    const controller = new AbortController();
    const url = `${running().apiRoot}/bot${FAKE_TOKEN}/getUpdates`;
    const aborted = fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeout: 5 }),
      signal: controller.signal,
    });
    await Bun.sleep(100);
    controller.abort();
    await expect(aborted).rejects.toThrow();
    await Bun.sleep(50);

    const next = rawGetUpdates(5);
    await Bun.sleep(100);
    running().state.sendAsUser({ chatId: DEFAULT_CHAT_ID, text: "after" });
    const response = await next;
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; result: { message: { text: string } }[] };
    expect(body.ok).toBe(true);
    expect(body.result[0]?.message.text).toBe("after");
  });
});
