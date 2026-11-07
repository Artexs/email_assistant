import { afterEach, describe, expect, test } from "bun:test";
import { Bot } from "grammy";

import {
  createFakeTelegramClient,
  FakeTelegramRequestError,
  FakeTelegramTimeout,
  FakeTelegramUnreachable,
} from "./driver";
import { startFakeTelegram, type FakeTelegram } from "./server";
import { FAKE_TOKEN } from "./state";

let fake: FakeTelegram | undefined;
let bot: Bot | undefined;

afterEach(async () => {
  await bot?.stop();
  bot = undefined;
  await fake?.stop();
  fake = undefined;
});

function start() {
  fake = startFakeTelegram();
  bot = new Bot(FAKE_TOKEN, { client: { apiRoot: fake.apiRoot } });
  bot.command("echo", (ctx) =>
    ctx.reply(`echo ${ctx.match}`, { reply_markup: { inline_keyboard: [[{ text: "Tap", callback_data: "tap" }]] } })
  );
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "tapped" });
    await ctx.editMessageText("edited");
  });
  void bot.start();
  return createFakeTelegramClient(fake.apiRoot);
}

describe("fake telegram driver client", () => {
  test("health, send and waitFor return the bot reply", async () => {
    const client = start();
    expect((await client.health()).bot.username).toBe("fake_ea_bot");
    const sent = await client.send("/echo hello");
    const reply = await client.waitFor(/echo hello/, { afterMessageId: sent.messageId });
    expect(reply.from).toBe("bot");
    expect((await client.read()).length).toBe(2);
  });

  test("press returns the callback answer, and waitFor sees the edit", async () => {
    const client = start();
    await client.send("/echo x");
    await client.waitFor(/echo x/);
    const pressed = await client.press({ button: "Tap" });
    expect(pressed.answer).toBe("tapped");
    expect((await client.waitFor(/edited/)).messageId).toBe(pressed.messageId);
  });

  test("waitFor times out when nothing matches", async () => {
    const client = start();
    await client.send("/echo x");
    await expect(client.waitFor(/never/, { timeoutMs: 300 })).rejects.toBeInstanceOf(FakeTelegramTimeout);
  });

  test("press of an unknown button is a request error", async () => {
    const client = start();
    await client.send("hi");
    await expect(client.press({ button: "none" })).rejects.toMatchObject({
      status: 404,
      message: "no such button",
    });
    await expect(client.press({ button: "none" })).rejects.toBeInstanceOf(FakeTelegramRequestError);
  });

  test("a closed port is unreachable", async () => {
    const probe = startFakeTelegram();
    const { apiRoot } = probe;
    await probe.stop();
    await expect(createFakeTelegramClient(apiRoot).health()).rejects.toBeInstanceOf(FakeTelegramUnreachable);
  });
});
