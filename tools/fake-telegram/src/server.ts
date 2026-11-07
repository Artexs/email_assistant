import {
  createFakeState,
  DEFAULT_BOT,
  FAKE_TOKEN,
  toBotApiMessage,
  type FakeBotInfo,
  type FakeButton,
  type FakeState,
} from "./state";

export interface FakeTelegramOptions {
  port?: number;
  token?: string;
  bot?: FakeBotInfo;
}

export interface FakeTelegram {
  apiRoot: string;
  port: number;
  token: string;
  state: FakeState;
  stop(): Promise<void>;
}

// The union of the fields of the 7 methods; the Bot API is not validated in stage 1.
interface Payload {
  chat_id?: number | string;
  message_id?: number;
  text?: string;
  reply_markup?: { inline_keyboard?: { text: string; callback_data: string }[][] };
  commands?: { command: string; description: string }[];
  callback_query_id?: string;
  offset?: number;
  limit?: number;
  timeout?: number;
}

const MAX_POLL_SECONDS = 8;

const reply = (body: object, status = 200) => Response.json(body, { status });

const toButtons = (payload: Payload): FakeButton[][] =>
  (payload.reply_markup?.inline_keyboard ?? []).map((row) =>
    row.map((button) => ({ text: button.text, data: button.callback_data }))
  );

async function readPayload(request: Request): Promise<Payload> {
  if (request.method === "GET") return {};
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Payload) : {};
  } catch {
    return {};
  }
}

export function startFakeTelegram(opts: FakeTelegramOptions = {}): FakeTelegram {
  const token = opts.token ?? FAKE_TOKEN;
  const state = createFakeState({ bot: opts.bot ?? DEFAULT_BOT });
  let activePoll: AbortController | undefined;

  const getUpdates = async (payload: Payload, signal: AbortSignal) => {
    const limit = Math.min(Math.max(Number(payload.limit) || 100, 1), 100);
    const timeout = Math.min(Math.max(Number(payload.timeout) || 0, 0), MAX_POLL_SECONDS);
    const rawOffset = Number(payload.offset);
    const offset = payload.offset === undefined || !Number.isFinite(rawOffset) ? undefined : rawOffset;
    const updates = state.takeUpdates({ offset, limit });
    if (updates.length > 0 || timeout === 0) return updates;

    // A newer getUpdates call ends this wait (stage 2: 409).
    activePoll?.abort();
    const poll = new AbortController();
    activePoll = poll;
    await state.nextUpdate(AbortSignal.any([signal, poll.signal]), timeout * 1000);
    if (activePoll === poll) activePoll = undefined;
    if (poll.signal.aborted) return [];
    return state.takeUpdates({ offset, limit });
  };

  const handle = async (method: string, payload: Payload, signal: AbortSignal) => {
    switch (method) {
      case "getMe":
        return {
          ...state.bot,
          is_bot: true,
          can_join_groups: false,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
        };
      case "deleteWebhook":
        return true;
      case "setMyCommands":
        state.commands = payload.commands ?? [];
        return true;
      case "getUpdates":
        return getUpdates(payload, signal);
      case "sendMessage":
        return toBotApiMessage(
          state.botSend({ chatId: Number(payload.chat_id), text: payload.text ?? "", buttons: toButtons(payload) }),
          state.bot
        );
      case "editMessageText":
        return toBotApiMessage(
          state.botEdit({
            chatId: Number(payload.chat_id),
            messageId: Number(payload.message_id),
            text: payload.text ?? "",
            buttons: toButtons(payload),
          }),
          state.bot
        );
      case "answerCallbackQuery":
        state.answerCallback({ id: payload.callback_query_id ?? "", text: payload.text });
        return true;
      default:
        return undefined;
    }
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port ?? 0,
    idleTimeout: 30,
    async fetch(request) {
      const match = /^\/bot([^/]+)\/([A-Za-z0-9_]+)$/.exec(new URL(request.url).pathname);
      if (!match) return reply({ ok: false, error_code: 404, description: "Not Found" }, 404);
      const payload = await readPayload(request);
      try {
        const result = await handle(match[2] ?? "", payload, request.signal);
        if (result === undefined) return reply({ ok: false, error_code: 404, description: "Not Found" }, 404);
        return reply({ ok: true, result });
      } catch (error) {
        return reply({ ok: false, error_code: 400, description: `Bad Request: ${(error as Error).message}` }, 400);
      }
    },
  });

  return {
    apiRoot: `http://127.0.0.1:${server.port}`,
    port: server.port as number,
    token,
    state,
    stop: () => server.stop(true),
  };
}
