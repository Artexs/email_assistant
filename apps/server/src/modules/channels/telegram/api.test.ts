import { describe, expect, test } from "bun:test";
import type { Api } from "grammy";

import { describeError } from "../../../platform/errors";
import { createFakeChannel } from "../fake/channel";
import { ChannelError } from "../port";

import { createTelegramApi, createTelegramChannel } from "./api";
import { telegramErrorLabel } from "./errors";

const TOKEN = "123456:MARKERTOKENaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MARKER = "MAILTEXT-MARKER";

interface Call {
  method: string;
  payload: Record<string, unknown>;
}

function setup(answer: unknown): { api: Api; calls: Call[] } {
  const calls: Call[] = [];
  const api = createTelegramApi(TOKEN);
  api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return answer as never;
  });
  return { api, calls };
}

function failure(error_code: number, description = "Bad Request: x", parameters?: { retry_after: number }): unknown {
  return { ok: false, error_code, description, parameters };
}

async function caught(run: () => Promise<unknown>): Promise<ChannelError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ChannelError);
    return error as ChannelError;
  }
  throw new Error("did not throw");
}

describe("telegram channel", () => {
  test("send: payload and result", async () => {
    const { api, calls } = setup({ ok: true, result: { message_id: 77 } });
    const result = await createTelegramChannel(api).send(42, {
      text: "hi",
      buttons: [[{ text: "✅ 1", data: "fe:abc" }]],
    });
    expect(result).toEqual({ messageId: 77 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("sendMessage");
    expect(calls[0]?.payload).toEqual({
      chat_id: 42,
      text: "hi",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "✅ 1", callback_data: "fe:abc" }]] },
    });
    expect("parse_mode" in (calls[0]?.payload ?? {})).toBe(false);
  });

  test("send without buttons has no reply_markup", async () => {
    const { api, calls } = setup({ ok: true, result: { message_id: 1 } });
    await createTelegramChannel(api).send(42, { text: "hi", buttons: [] });
    expect("reply_markup" in (calls[0]?.payload ?? {})).toBe(false);
  });

  test("edit without buttons clears the keyboard", async () => {
    const { api, calls } = setup({ ok: true, result: true });
    await createTelegramChannel(api).edit(42, 5, { text: "x", buttons: [] });
    expect(calls[0]?.method).toBe("editMessageText");
    expect(calls[0]?.payload).toMatchObject({ chat_id: 42, message_id: 5, reply_markup: { inline_keyboard: [] } });
  });

  test("error kinds", async () => {
    const cases: [unknown, string, string, number | null][] = [
      [failure(429, "Too Many Requests", { retry_after: 7 }), "rate_limited", "telegram_429", 7000],
      [failure(429, "Too Many Requests"), "rate_limited", "telegram_429", 30000],
      [failure(401, "Unauthorized"), "config", "telegram_401", null],
      [failure(403, "Forbidden"), "blocked", "telegram_403", null],
      [failure(400), "bad_request", "telegram_400", null],
      [failure(502, "Bad Gateway"), "soft", "telegram_502", null],
      [failure(409, "Conflict"), "other", "telegram_409", null],
    ];
    for (const [answer, kind, code, retryAfterMs] of cases) {
      const { api } = setup(answer);
      const err = await caught(() => createTelegramChannel(api).send(42, { text: "hi", buttons: [] }));
      expect([err.kind, err.code, err.retryAfterMs]).toEqual([kind as never, code, retryAfterMs]);
    }
  });

  test("edit: message is not modified counts as success", async () => {
    const { api } = setup(failure(400, "Bad Request: message is not modified: specified new message content…"));
    await createTelegramChannel(api).edit(42, 5, { text: "x", buttons: [] });
  });

  test("an error thrown by a transformer is unknown and leaks nothing", async () => {
    const api = createTelegramApi(TOKEN);
    api.config.use(async () => {
      throw new Error("boom MARKERTOKEN");
    });
    const err = await caught(() => createTelegramChannel(api).send(42, { text: "hi", buttons: [] }));
    expect([err.kind, err.code]).toEqual(["other", "telegram_unknown"]);
    expect(err.message).not.toContain("MARKERTOKEN");
    expect(describeError(err)).not.toContain("MARKERTOKEN");
  });

  test("a network error is soft and leaks nothing", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const port = server.port;
    await server.stop(true);
    const api = createTelegramApi(TOKEN, { apiRoot: `http://127.0.0.1:${port}` });
    const err = await caught(() => createTelegramChannel(api).send(42, { text: "hi", buttons: [] }));
    expect([err.kind, err.code]).toEqual(["soft", "telegram_network"]);
    expect(err.message).not.toContain("MARKERTOKEN");
    expect(telegramErrorLabel(err)).not.toContain("MARKERTOKEN");
  });

  test("the message text never reaches the error", async () => {
    const { api } = setup(failure(400, `Bad Request: ${MARKER}`));
    const err = await caught(() => createTelegramChannel(api).send(42, { text: `x ${MARKER}`, buttons: [] }));
    expect(err.message).not.toContain(MARKER);
    expect(describeError(err)).not.toContain(MARKER);
    expect(String(err)).not.toContain(MARKER);
  });

  test("guards run before any API call", async () => {
    const { api, calls } = setup({ ok: true, result: { message_id: 1 } });
    const channel = createTelegramChannel(api);
    const tooLong = await caught(() => channel.send(42, { text: "a".repeat(4097), buttons: [] }));
    expect(tooLong.code).toBe("message_too_long");
    const bigData = await caught(() =>
      channel.send(42, { text: "hi", buttons: [[{ text: "b", data: "a".repeat(65) }]] })
    );
    expect(bigData.code).toBe("button_data_too_long");
    expect(calls).toHaveLength(0);
  });
});

describe("fake channel", () => {
  test("records, counts ids and fails on demand", async () => {
    const channel = createFakeChannel();
    const message = { text: "hi", buttons: [] };
    expect(await channel.send(1, message)).toEqual({ messageId: 1000 });
    expect(await channel.send(1, message)).toEqual({ messageId: 1001 });
    channel.failWith(new ChannelError("soft", "telegram_network"), 1);
    expect((await caught(() => channel.send(1, message))).kind).toBe("soft");
    expect(await channel.send(1, message)).toEqual({ messageId: 1002 });
    expect(channel.sent).toHaveLength(3);
  });
});
