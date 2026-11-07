import { afterEach, describe, expect, test } from "bun:test";
import { Api, Bot } from "grammy";

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

const call = async (method: string, body: object) => {
  const response = await fetch(`${running().apiRoot}/bot${FAKE_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<{ ok: boolean; result: unknown }>;
};

async function waitFor(condition: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await Bun.sleep(50);
  }
}

describe("fake telegram server", () => {
  test("getMe returns the fake bot", async () => {
    fake = startFakeTelegram();
    const me = await new Api(FAKE_TOKEN, { apiRoot: fake.apiRoot }).getMe();
    expect(me.username).toBe("fake_ea_bot");
  });

  test("a grammY bot handles a command and a button press", async () => {
    fake = startFakeTelegram();
    const { state } = fake;
    const bot = new Bot(FAKE_TOKEN, { client: { apiRoot: fake.apiRoot } });
    bot.command("start", (ctx) =>
      ctx.reply(`hi ${ctx.match}`, { reply_markup: { inline_keyboard: [[{ text: "Yes", callback_data: "y" }]] } })
    );
    bot.on("callback_query:data", async (ctx) => {
      await ctx.answerCallbackQuery({ text: "ok" });
      await ctx.editMessageText("done");
    });
    void bot.start();

    state.sendAsUser({ chatId: DEFAULT_CHAT_ID, text: "/start abc" });
    await waitFor(() => state.messages(DEFAULT_CHAT_ID).some((m) => m.from === "bot" && m.text === "hi abc"));
    const botMessage = state.messages(DEFAULT_CHAT_ID).find((m) => m.from === "bot");
    if (!botMessage) throw new Error("no bot message");
    const { callback } = state.pressButton({
      chatId: DEFAULT_CHAT_ID,
      messageId: botMessage.messageId,
      data: "y",
    });
    await waitFor(() => callback.answered && botMessage.text === "done");

    expect(callback.answerText).toBe("ok");
    expect(botMessage.edits).toEqual(["hi abc"]);
    expect(botMessage.buttons).toEqual([]);
    await bot.stop();
  });

  test("getUpdates long poll waits for the timeout, or ends early on an update", async () => {
    fake = startFakeTelegram();
    const { state } = fake;

    const start = Date.now();
    const empty = await call("getUpdates", { timeout: 1 });
    expect(empty.result).toEqual([]);
    expect(Date.now() - start).toBeGreaterThanOrEqual(900);

    setTimeout(() => state.sendAsUser({ chatId: DEFAULT_CHAT_ID, text: "hello" }), 200);
    const early = Date.now();
    const answer = await call("getUpdates", { timeout: 1 });
    expect(Date.now() - early).toBeLessThan(1000);
    const updates = answer.result as { message: { text: string } }[];
    expect(updates).toHaveLength(1);
    expect(updates[0]?.message.text).toBe("hello");
  });

  test("getUpdates ignores an offset that is not a number", async () => {
    fake = startFakeTelegram();
    fake.state.sendAsUser({ chatId: DEFAULT_CHAT_ID, text: "keep" });
    const answer = await call("getUpdates", { offset: "abc" });
    expect(answer.result as unknown[]).toHaveLength(1);
    expect(fake.state.takeUpdates({ limit: 100 })).toHaveLength(1);
  });

  test("setMyCommands stores the commands and deleteWebhook answers true", async () => {
    fake = startFakeTelegram();
    const commands = [{ command: "start", description: "Start" }];
    expect((await call("setMyCommands", { commands })).result).toBe(true);
    expect(fake.state.commands).toEqual(commands);
    expect((await call("deleteWebhook", {})).result).toBe(true);
  });
});
