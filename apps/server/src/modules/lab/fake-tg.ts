// The lab's client of the fake Telegram: HTTP calls to its `/_fake/*` control routes. `apps/server` does not import
// `tools/fake-telegram` (no new workspace dependency); the shapes below copy the fake's wire format.

export interface FakeButton {
  text: string;
  data: string;
}

export interface FakeMessage {
  chatId: number;
  messageId: number;
  from: "user" | "bot";
  text: string;
  date: number;
  buttons: FakeButton[][];
  edits: string[];
}

export interface FakeTgClient {
  /** A message from the user to the bot. */
  send(chatId: number, text: string): Promise<void>;
  /** Oldest first; `[]` for a chat the fake does not know. */
  read(chatId: number): Promise<FakeMessage[]>;
  /** A tap on the button of a bot message that carries `data`. */
  press(chatId: number, messageId: number, data: string): Promise<void>;
  /** True after the first user message in the chat. A restarted fake has none. */
  hasChat(chatId: number): Promise<boolean>;
}

export class FakeTgError extends Error {
  constructor(
    readonly route: string,
    readonly status: number
  ) {
    super(`fake telegram ${route}: HTTP ${status}`);
    this.name = "FakeTgError";
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createFakeTgClient(apiRoot: string, fetchFn: Fetch = fetch): FakeTgClient {
  const root = apiRoot.replace(/\/+$/, "");

  async function call(route: string, init?: RequestInit): Promise<Response> {
    return fetchFn(`${root}/_fake${route}`, init);
  }

  async function post(route: string, body: object): Promise<void> {
    const response = await call(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new FakeTgError(route, response.status);
  }

  async function read(chatId: number): Promise<FakeMessage[]> {
    const response = await call(`/chats/${chatId}`);
    // The fake answers 404 for a chat without a user message.
    if (response.status === 404) return [];
    if (!response.ok) throw new FakeTgError("/chats", response.status);
    const body = (await response.json()) as { messages?: FakeMessage[] };
    return body.messages ?? [];
  }

  return {
    send: (chatId, text) => post("/send", { chatId, text }),
    read,
    press: (chatId, messageId, data) => post("/press", { chatId, messageId, data }),
    async hasChat(chatId) {
      const response = await call(`/chats/${chatId}`);
      if (response.status === 404) return false;
      if (!response.ok) throw new FakeTgError("/chats", response.status);
      return true;
    },
  };
}
