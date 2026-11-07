import { DEFAULT_CHAT_ID, type FakeState } from "./state";

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });
const done = (body: object) => Response.json({ ok: true, ...body });

type Body = Record<string, unknown>;

const isJson = (request: Request) =>
  (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() === "application/json";

/** Absent gives `undefined`; present but not an integer gives a 400 response. */
function optionalInt(body: Body, key: string): number | undefined | Response {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" && Number.isInteger(value) ? value : fail(400, `${key} must be an integer`);
}

async function readBody(request: Request): Promise<Body | Response> {
  if (!isJson(request)) return fail(415, "content-type must be application/json");
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Body;
  } catch {
    // falls through to the 400 below
  }
  return fail(400, "body must be a JSON object");
}

function send(state: FakeState, body: Body): Response {
  if (typeof body.text !== "string" || body.text === "") return fail(400, "text is required");
  const chatIdValue = optionalInt(body, "chatId");
  if (chatIdValue instanceof Response) return chatIdValue;
  const chatId = chatIdValue ?? DEFAULT_CHAT_ID;
  const { updateId, message } = state.sendAsUser({ chatId, text: body.text });
  return done({ updateId, messageId: message.messageId });
}

function press(state: FakeState, body: Body): Response {
  const button = typeof body.button === "string" ? body.button : undefined;
  const data = typeof body.data === "string" ? body.data : undefined;
  if ((button === undefined) === (data === undefined)) return fail(400, "give exactly one of button or data");
  const chatIdValue = optionalInt(body, "chatId");
  if (chatIdValue instanceof Response) return chatIdValue;
  const chatId = chatIdValue ?? DEFAULT_CHAT_ID;
  const wanted = optionalInt(body, "messageId");
  if (wanted instanceof Response) return wanted;

  const find = (messageId: number): string | undefined => {
    const message = state.findMessage(chatId, messageId);
    if (message?.from !== "bot") return undefined;
    for (const row of message.buttons) {
      for (const candidate of row) {
        if (button !== undefined ? candidate.text === button : candidate.data === data) return candidate.data;
      }
    }
    return undefined;
  };

  let messageId = wanted;
  if (messageId === undefined) {
    messageId = [...state.messages(chatId)].reverse().find((m) => find(m.messageId) !== undefined)?.messageId;
  }
  const pressed = messageId === undefined ? undefined : find(messageId);
  if (messageId === undefined || pressed === undefined) return fail(404, "no such button");
  const result = state.pressButton({ chatId, messageId, data: pressed });
  return done({ updateId: result.updateId, callbackId: result.callback.id, messageId, data: pressed });
}

/** Handles `/_fake/*` requests. The fake listens on loopback only, so the routes need no token. */
export async function handleControl(request: Request, state: FakeState): Promise<Response> {
  const path = new URL(request.url).pathname.slice("/_fake".length);
  const { method } = request;

  if (method === "GET") {
    if (path === "/health") return done({ bot: { id: state.bot.id, username: state.bot.username } });
    if (path === "/chats") {
      return done({ chats: state.chatIds().map((chatId) => ({ chatId, messages: state.messages(chatId).length })) });
    }
    const chat = /^\/chats\/(-?\d+)$/.exec(path);
    if (chat) {
      const chatId = Number(chat[1]);
      if (!state.hasChat(chatId)) return fail(404, "no such chat");
      return done({ chatId, messages: state.messages(chatId), callbacks: state.callbacks(chatId) });
    }
    const callback = /^\/callbacks\/([^/]+)$/.exec(path);
    if (callback) {
      let id: string | undefined;
      try {
        id = decodeURIComponent(callback[1] ?? "");
      } catch {
        // malformed percent-encoding: no callback can have this id
      }
      const found = id === undefined ? undefined : state.findCallback(id);
      return found ? done({ callback: found }) : fail(404, "no such callback");
    }
  }

  if (method === "POST" && (path === "/send" || path === "/press")) {
    const body = await readBody(request);
    if (body instanceof Response) return body;
    return path === "/send" ? send(state, body) : press(state, body);
  }

  return fail(404, "no such control route");
}
