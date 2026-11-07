import { afterEach, describe, expect, test } from "bun:test";
import { Bot } from "grammy";

import { startFakeTelegram, type FakeTelegram } from "./server";
import { DEFAULT_CHAT_ID, FAKE_TOKEN, type FakeCallback, type FakeMessage } from "./state";

// Loose view of a control answer; the tests check the values they use.
interface Reply {
  ok: boolean;
  error: string;
  messageId: number;
  updateId: number;
  callbackId: string;
  chats: { chatId: number; messages: number }[];
  callback: FakeCallback;
  bot: { id: number; username: string };
  messages: FakeMessage[];
  callbacks: FakeCallback[];
}

let fake: FakeTelegram | undefined;
let bot: Bot | undefined;

const running = () => {
  if (!fake) throw new Error("fake not started");
  return fake;
};

afterEach(async () => {
  await bot?.stop();
  bot = undefined;
  await fake?.stop();
  fake = undefined;
});

const get = async (path: string) => {
  const response = await fetch(`${running().apiRoot}/_fake${path}`);
  return { status: response.status, body: (await response.json()) as Reply };
};

const post = async (path: string, body: unknown, contentType = "application/json") => {
  const response = await fetch(`${running().apiRoot}/_fake${path}`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Reply };
};

async function waitUntil(condition: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitUntil timed out");
    await Bun.sleep(50);
  }
}

function startBot() {
  bot = new Bot(FAKE_TOKEN, { client: { apiRoot: running().apiRoot } });
  bot.command("start", (ctx) =>
    ctx.reply(`hi ${ctx.match}`, { reply_markup: { inline_keyboard: [[{ text: "↩️ 1", callback_data: "undo:1" }]] } })
  );
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "tapped" });
    await ctx.editMessageText("done");
  });
  void bot.start();
}

describe("fake telegram control routes", () => {
  test("health shows the bot user name", async () => {
    fake = startFakeTelegram();
    const { status, body } = await get("/health");
    expect(status).toBe(200);
    expect<unknown>(body).toEqual({ ok: true, bot: { id: 1000001, username: "fake_ea_bot" } });
  });

  test("send reaches the update queue and the default chat", async () => {
    fake = startFakeTelegram();
    const { status, body } = await post("/send", { text: "/start abc" });
    expect(status).toBe(200);
    expect(body.messageId).toBe(1);
    const updates = running().state.takeUpdates({ limit: 10 });
    expect<unknown>(updates.map((u) => u.update_id)).toEqual([body.updateId]);
    expect<unknown>((await get("/chats")).body.chats).toEqual([{ chatId: DEFAULT_CHAT_ID, messages: 1 }]);
  });

  test("a bot reply, a press by text and by data, and the edit history", async () => {
    fake = startFakeTelegram();
    startBot();
    await post("/send", { text: "/start x" });
    await waitUntil(() => running().state.messages(DEFAULT_CHAT_ID).length >= 2);

    const byText = await post("/press", { button: "↩️ 1" });
    expect(byText.status).toBe(200);
    expect(byText.body).toMatchObject({ messageId: 2, data: "undo:1" });
    await waitUntil(() => running().state.findCallback(byText.body.callbackId)?.answered === true);

    const callback = (await get(`/callbacks/${byText.body.callbackId}`)).body.callback;
    expect(callback.answerText).toBe("tapped");

    const chat = (await get(`/chats/${DEFAULT_CHAT_ID}`)).body;
    const botMessage = chat.messages.find((m) => m.from === "bot");
    expect(botMessage?.text).toBe("done");
    expect<unknown>(botMessage?.edits).toEqual(["hi x"]);
    expect(chat.callbacks).toHaveLength(1);
  });

  test("press by data works with an explicit message", async () => {
    fake = startFakeTelegram();
    const message = running().state.botSend({
      chatId: DEFAULT_CHAT_ID,
      text: "pick",
      buttons: [[{ text: "Yes", data: "y" }]],
    });
    running().state.sendAsUser({ chatId: DEFAULT_CHAT_ID, text: "hello" });
    const { status, body } = await post("/press", { data: "y", messageId: message.messageId });
    expect(status).toBe(200);
    expect(body).toMatchObject({ messageId: message.messageId, data: "y" });
  });

  test("press with an unknown button text answers 404", async () => {
    fake = startFakeTelegram();
    running().state.botSend({ chatId: DEFAULT_CHAT_ID, text: "pick", buttons: [[{ text: "Yes", data: "y" }]] });
    const { status, body } = await post("/press", { button: "No" });
    expect(status).toBe(404);
    expect<unknown>(body).toEqual({ ok: false, error: "no such button" });
  });

  test("press with both or none of button and data answers 400", async () => {
    fake = startFakeTelegram();
    expect((await post("/press", { button: "Yes", data: "y" })).status).toBe(400);
    expect((await post("/press", {})).status).toBe(400);
  });

  test("bad JSON and a missing text answer 400", async () => {
    fake = startFakeTelegram();
    expect((await post("/send", "{nope")).status).toBe(400);
    expect((await post("/send", {})).status).toBe(400);
  });

  test("a POST without the JSON content type answers 415", async () => {
    fake = startFakeTelegram();
    const plain = await post("/send", { text: "hi" }, "text/plain");
    expect(plain.status).toBe(415);
    expect<unknown>(plain.body).toEqual({ ok: false, error: "content-type must be application/json" });
    expect(running().state.chatIds()).toEqual([]);
    expect((await post("/send", { text: "hi" }, "application/json; charset=utf-8")).status).toBe(200);
  });

  test("an unknown chat or callback answers 404", async () => {
    fake = startFakeTelegram();
    expect((await get("/chats/42")).status).toBe(404);
    expect((await get("/callbacks/cb-9")).status).toBe(404);
    expect((await get("/nothing")).status).toBe(404);
  });

  test("non-integer chatId or messageId gives 400", async () => {
    fake = startFakeTelegram();
    const sent = await post("/send", { text: "x", chatId: "abc" });
    expect(sent.status).toBe(400);
    expect(sent.body).toMatchObject({ ok: false, error: "chatId must be an integer" });
    const pressed = await post("/press", { data: "y", messageId: 1.5 });
    expect(pressed.status).toBe(400);
    expect(pressed.body.error).toBe("messageId must be an integer");
  });

  test("malformed percent-encoded callback id gives 404", async () => {
    fake = startFakeTelegram();
    const result = await get("/callbacks/%E0%A4%A");
    expect(result.status).toBe(404);
    expect(result.body.error).toBe("no such callback");
  });
});
