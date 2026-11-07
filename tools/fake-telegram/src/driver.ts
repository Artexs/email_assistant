import { DEFAULT_CHAT_ID, type FakeCallback, type FakeMessage } from "./state";

const POLL_MS = 100;
const PRESS_TIMEOUT_MS = 10_000;
const WAIT_TIMEOUT_MS = 30_000;

export class FakeTelegramTimeout extends Error {}
export class FakeTelegramUnreachable extends Error {}
export class FakeTelegramRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export interface FakeTelegramClient {
  health(): Promise<{ bot: { id: number; username: string } }>;
  send(text: string, opts?: { chatId?: number }): Promise<{ updateId: number; messageId: number }>;
  press(opts: {
    chatId?: number;
    messageId?: number;
    button?: string;
    data?: string;
    timeoutMs?: number;
  }): Promise<{ callbackId: string; messageId: number; answer: string }>;
  /** Messages of a chat, oldest first; `[]` while the chat has no message, unless `strict` (then it throws). */
  read(opts?: { chatId?: number; strict?: boolean }): Promise<FakeMessage[]>;
  waitFor(
    pattern: RegExp,
    opts?: { chatId?: number; timeoutMs?: number; afterMessageId?: number }
  ): Promise<FakeMessage>;
}

type Reply = { ok: true } & Record<string, unknown>;

export function createFakeTelegramClient(url: string): FakeTelegramClient {
  const root = url.replace(/\/+$/, "");

  async function call(path: string, body?: unknown): Promise<Reply> {
    let response: Response;
    try {
      response = await fetch(`${root}/_fake${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new FakeTelegramUnreachable(`cannot connect to ${root}: ${(error as Error).message}`);
    }
    const json = (await response.json().catch(() => undefined)) as (Reply | { ok: false; error?: string }) | undefined;
    if (!json || !json.ok) {
      const message = json && "error" in json && json.error ? json.error : `HTTP ${response.status}`;
      throw new FakeTelegramRequestError(response.status, message);
    }
    return json;
  }

  const read = async (opts: { chatId?: number; strict?: boolean } = {}): Promise<FakeMessage[]> => {
    try {
      const reply = await call(`/chats/${opts.chatId ?? DEFAULT_CHAT_ID}`);
      return reply.messages as FakeMessage[];
    } catch (error) {
      if (
        error instanceof FakeTelegramRequestError &&
        error.status === 404 &&
        error.message === "no such chat" &&
        !opts.strict
      ) {
        return [];
      }
      throw error;
    }
  };

  return {
    async health() {
      const reply = await call("/health");
      return { bot: reply.bot as { id: number; username: string } };
    },

    async send(text, opts = {}) {
      const reply = await call("/send", { text, chatId: opts.chatId });
      return { updateId: reply.updateId as number, messageId: reply.messageId as number };
    },

    async press({ timeoutMs = PRESS_TIMEOUT_MS, ...target }) {
      const reply = await call("/press", target);
      const callbackId = reply.callbackId as string;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const { callback } = (await call(`/callbacks/${encodeURIComponent(callbackId)}`)) as unknown as {
          callback: FakeCallback;
        };
        if (callback.answered) {
          return { callbackId, messageId: reply.messageId as number, answer: callback.answerText ?? "" };
        }
        if (Date.now() >= deadline) {
          throw new FakeTelegramTimeout(`no answer to callback ${callbackId} within ${timeoutMs} ms`);
        }
        await Bun.sleep(POLL_MS);
      }
    },

    read,

    async waitFor(pattern, { chatId, timeoutMs = WAIT_TIMEOUT_MS, afterMessageId = 0 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const messages = await read({ chatId });
        const found = messages.find(
          (m) =>
            m.from === "bot" &&
            m.messageId > afterMessageId &&
            new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, "")).test(m.text)
        );
        if (found) return found;
        if (Date.now() >= deadline) {
          throw new FakeTelegramTimeout(`no bot message matching ${pattern} within ${timeoutMs} ms`);
        }
        await Bun.sleep(POLL_MS);
      }
    },
  };
}
