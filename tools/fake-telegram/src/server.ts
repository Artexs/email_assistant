import { handleControl } from "./control";
import { BotApiError, CALLBACK_DATA_MAX_BYTES, DESCRIPTIONS, errorResponse, TEXT_MAX_CHARS } from "./errors";
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
  /** The next `times` calls of `method` (default 1) fail with the fault, then calls work again. */
  failNext(method: string, fault: { code: 409 } | { code: 429; retryAfter: number }, times?: number): void;
  stop(): Promise<void>;
}

// The union of the fields of the 7 methods; the Bot API is not validated in stage 1.
interface Payload {
  chat_id?: number | string;
  message_id?: number;
  text?: string;
  reply_markup?: { inline_keyboard?: { text: string; callback_data?: string }[][] };
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
    row.map((button) => ({ text: button.text, data: button.callback_data ?? "" }))
  );

function checkText(payload: Payload): string {
  const { text } = payload;
  if (typeof text !== "string" || text.trim() === "") throw new BotApiError(400, DESCRIPTIONS.textEmpty);
  if (text.length > TEXT_MAX_CHARS) throw new BotApiError(400, DESCRIPTIONS.textTooLong);
  return text;
}

function checkButtons(payload: Payload): void {
  for (const row of payload.reply_markup?.inline_keyboard ?? []) {
    for (const button of row) {
      const bytes = typeof button.callback_data === "string" ? Buffer.byteLength(button.callback_data) : 0;
      if (bytes < 1 || bytes > CALLBACK_DATA_MAX_BYTES) throw new BotApiError(400, DESCRIPTIONS.buttonDataInvalid);
    }
  }
}

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
  const faults = new Map<string, { fault: BotApiError; left: number }>();

  const checkChat = (payload: Payload): number => {
    const chatId = Number(payload.chat_id);
    if (!state.hasChat(chatId)) throw new BotApiError(400, DESCRIPTIONS.chatNotFound);
    return chatId;
  };

  const getUpdates = async (payload: Payload, signal: AbortSignal) => {
    const limit = Math.min(Math.max(Number(payload.limit) || 100, 1), 100);
    const timeout = Math.min(Math.max(Number(payload.timeout) || 0, 0), MAX_POLL_SECONDS);
    const rawOffset = Number(payload.offset);
    const offset = payload.offset === undefined || !Number.isFinite(rawOffset) ? undefined : rawOffset;
    const updates = state.takeUpdates({ offset, limit });
    if (updates.length > 0 || timeout === 0) return updates;

    // A newer getUpdates call ends this wait with a 409.
    activePoll?.abort();
    const poll = new AbortController();
    activePoll = poll;
    await state.nextUpdate(AbortSignal.any([signal, poll.signal]), timeout * 1000);
    if (activePoll === poll) activePoll = undefined;
    if (poll.signal.aborted) {
      if (signal.aborted) return [];
      throw new BotApiError(409, DESCRIPTIONS.conflict);
    }
    return state.takeUpdates({ offset, limit });
  };

  const takeFault = (method: string) => {
    const entry = faults.get(method);
    if (!entry) return undefined;
    entry.left -= 1;
    if (entry.left <= 0) faults.delete(method);
    return entry.fault;
  };

  const handle = async (method: string, payload: Payload, signal: AbortSignal) => {
    const fault = takeFault(method);
    if (fault) throw fault;
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
      case "sendMessage": {
        const chatId = checkChat(payload);
        const text = checkText(payload);
        checkButtons(payload);
        return toBotApiMessage(state.botSend({ chatId, text, buttons: toButtons(payload) }), state.bot);
      }
      case "editMessageText": {
        const chatId = checkChat(payload);
        const text = checkText(payload);
        checkButtons(payload);
        return toBotApiMessage(
          state.botEdit({ chatId, messageId: Number(payload.message_id), text, buttons: toButtons(payload) }),
          state.bot
        );
      }
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
      const { pathname } = new URL(request.url);
      if (pathname.startsWith("/_fake/")) return handleControl(request, state);
      const match = /^\/bot([^/]+)\/([A-Za-z0-9_]+)$/.exec(pathname);
      if (!match) return errorResponse(new BotApiError(404, DESCRIPTIONS.notFound));
      if (match[1] !== token) return errorResponse(new BotApiError(401, DESCRIPTIONS.unauthorized));
      const payload = await readPayload(request);
      try {
        const result = await handle(match[2] ?? "", payload, request.signal);
        if (result === undefined) return errorResponse(new BotApiError(404, DESCRIPTIONS.notFound));
        return reply({ ok: true, result });
      } catch (error) {
        if (error instanceof BotApiError) return errorResponse(error);
        return reply({ ok: false, error_code: 500, description: "Internal Server Error" }, 500);
      }
    },
  });

  return {
    apiRoot: `http://127.0.0.1:${server.port}`,
    port: server.port as number,
    token,
    state,
    failNext(method, fault, times = 1) {
      const error =
        fault.code === 409
          ? new BotApiError(409, DESCRIPTIONS.conflict)
          : new BotApiError(429, DESCRIPTIONS.tooManyRequests(fault.retryAfter), fault.retryAfter);
      faults.set(method, { fault: error, left: times });
    },
    stop: () => server.stop(true),
  };
}
