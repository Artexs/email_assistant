import { afterEach, describe, expect, test } from "bun:test";
import { Api } from "grammy";

import { ChannelError } from "../../../apps/server/src/modules/channels/port";
import { createTelegramApi, createTelegramChannel } from "../../../apps/server/src/modules/channels/telegram/api";
import { isNotModified, toChannelError } from "../../../apps/server/src/modules/channels/telegram/errors";

import { startFakeTelegram, type FakeTelegram } from "./server";
import { DEFAULT_CHAT_ID, FAKE_TOKEN } from "./state";

let fake: FakeTelegram | undefined;

afterEach(async () => {
  await fake?.stop();
  fake = undefined;
});

const start = (chat = true) => {
  fake = startFakeTelegram();
  if (chat) fake.state.sendAsUser({ chatId: DEFAULT_CHAT_ID, text: "hi" });
  return fake;
};

async function rejection(promise: Promise<unknown>): Promise<ChannelError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ChannelError) return error;
    throw error;
  }
  throw new Error("the call did not fail");
}

describe("fake telegram with the app channel", () => {
  test("isNotModified reads the fake's not-modified error", async () => {
    const { apiRoot } = start();
    const api = new Api(FAKE_TOKEN, { apiRoot });
    const sent = await api.sendMessage(DEFAULT_CHAT_ID, "text");
    const error = await api.editMessageText(DEFAULT_CHAT_ID, sent.message_id, "text").catch((e: unknown) => e);
    expect(isNotModified(error)).toBe(true);
    expect(toChannelError(error).kind).toBe("bad_request");
  });

  test("edit with the same content resolves", async () => {
    const { apiRoot } = start();
    const channel = createTelegramChannel(createTelegramApi(FAKE_TOKEN, { apiRoot }));
    const { messageId } = await channel.send(DEFAULT_CHAT_ID, { text: "text", buttons: [] });
    await channel.edit(DEFAULT_CHAT_ID, messageId, { text: "text", buttons: [] });
  });

  test("send under an injected 429 is rate_limited", async () => {
    const instance = start();
    const channel = createTelegramChannel(createTelegramApi(FAKE_TOKEN, { apiRoot: instance.apiRoot }));
    instance.failNext("sendMessage", { code: 429, retryAfter: 3 });
    const error = await rejection(channel.send(DEFAULT_CHAT_ID, { text: "text", buttons: [] }));
    expect(error.kind).toBe("rate_limited");
    expect(error.retryAfterMs).toBe(3000);
  });

  test("a wrong token is a config error", async () => {
    const { apiRoot } = start();
    const channel = createTelegramChannel(createTelegramApi("1000001:wrong-token-wrong-token-wrong", { apiRoot }));
    const error = await rejection(channel.send(DEFAULT_CHAT_ID, { text: "text", buttons: [] }));
    expect(error.kind).toBe("config");
  });

  test("send to an unknown chat is bad_request", async () => {
    const { apiRoot } = start(false);
    const channel = createTelegramChannel(createTelegramApi(FAKE_TOKEN, { apiRoot }));
    const error = await rejection(channel.send(DEFAULT_CHAT_ID, { text: "text", buttons: [] }));
    expect(error.kind).toBe("bad_request");
  });
});
