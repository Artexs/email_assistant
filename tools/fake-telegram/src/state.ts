import type { Message, Update } from "grammy/types";

import { BotApiError, DESCRIPTIONS } from "./errors";

// Test values only: the token is not a secret. It passes the config regex ^\d+:[A-Za-z0-9_-]{20,}$.
export const FAKE_TOKEN = "1000001:fake-telegram-token-local-tests-only";

export const DEFAULT_BOT = { id: 1000001, username: "fake_ea_bot", first_name: "Fake EA bot" };

// A private chat: the chat id equals the user id.
export const DEFAULT_CHAT_ID = 5550001;

// CLI only. The TS API uses port 0 (a free port).
export const DEFAULT_PORT = 8090;

export interface FakeBotInfo {
  id: number;
  username: string;
  first_name: string;
}

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

export interface FakeCallback {
  id: string;
  chatId: number;
  messageId: number;
  data: string;
  answered: boolean;
  answerText: string | null;
}

export interface FakeState {
  readonly bot: FakeBotInfo;
  commands: { command: string; description: string }[];
  sendAsUser(input: { chatId: number; text: string; firstName?: string }): {
    updateId: number;
    message: FakeMessage;
  };
  pressButton(input: { chatId: number; messageId: number; data: string }): {
    updateId: number;
    callback: FakeCallback;
  };
  botSend(input: { chatId: number; text: string; buttons: FakeButton[][] }): FakeMessage;
  botEdit(input: { chatId: number; messageId: number; text: string; buttons: FakeButton[][] }): FakeMessage;
  answerCallback(input: { id: string; text?: string }): FakeCallback;
  takeUpdates(input: { offset?: number; limit: number }): Update[];
  /** Resolves on a new update, the abort or the time, whatever comes first. */
  nextUpdate(signal: AbortSignal, waitMs: number): Promise<void>;
  /** Oldest first; [] for an unknown chat. */
  messages(chatId: number): FakeMessage[];
  chatIds(): number[];
  findMessage(chatId: number, messageId: number): FakeMessage | undefined;
  findCallback(id: string): FakeCallback | undefined;
  /** Oldest first; [] for an unknown chat. */
  callbacks(chatId: number): FakeCallback[];
  /** True after the first user message in the chat. */
  hasChat(chatId: number): boolean;
}

const COMMAND_PATTERN = /^\/[A-Za-z0-9_]+(@[A-Za-z0-9_]+)?/;
const DEFAULT_FIRST_NAME = "Tester";

const sameButtons = (a: FakeButton[][], b: FakeButton[][]) =>
  a.length === b.length &&
  a.every(
    (row, i) =>
      row.length === b[i]?.length &&
      row.every((button, j) => button.text === b[i]?.[j]?.text && button.data === b[i]?.[j]?.data)
  );

export function toBotApiMessage(message: FakeMessage, bot: FakeBotInfo): Message {
  return {
    message_id: message.messageId,
    date: message.date,
    chat: { id: message.chatId, type: "private", first_name: DEFAULT_FIRST_NAME },
    from: { id: bot.id, is_bot: true, first_name: bot.first_name, username: bot.username },
    text: message.text,
    ...(message.buttons.length > 0 && {
      reply_markup: {
        inline_keyboard: message.buttons.map((row) =>
          row.map((button) => ({ text: button.text, callback_data: button.data }))
        ),
      },
    }),
  };
}

export function createFakeState(opts: { bot?: FakeBotInfo; now?: () => Date } = {}): FakeState {
  const bot = opts.bot ?? DEFAULT_BOT;
  const now = opts.now ?? (() => new Date());

  const chats = new Map<number, { messages: FakeMessage[]; callbacks: FakeCallback[]; firstName: string }>();
  const callbacksById = new Map<string, FakeCallback>();
  let queue: Update[] = [];
  let lastUpdateId = 0;
  let lastCallbackId = 0;
  let waiters: (() => void)[] = [];

  const unixNow = () => Math.floor(now().getTime() / 1000);

  const getChat = (chatId: number) => {
    let chat = chats.get(chatId);
    if (!chat) {
      chat = { messages: [], callbacks: [], firstName: DEFAULT_FIRST_NAME };
      chats.set(chatId, chat);
    }
    return chat;
  };

  const addMessage = (chatId: number, from: "user" | "bot", text: string, buttons: FakeButton[][]) => {
    const chat = getChat(chatId);
    const message: FakeMessage = {
      chatId,
      messageId: chat.messages.length + 1,
      from,
      text,
      date: unixNow(),
      buttons,
      edits: [],
    };
    chat.messages.push(message);
    return message;
  };

  const pushUpdate = (build: (updateId: number) => Update) => {
    lastUpdateId += 1;
    queue.push(build(lastUpdateId));
    const woken = waiters;
    waiters = [];
    for (const wake of woken) wake();
    return lastUpdateId;
  };

  const findMessage = (chatId: number, messageId: number) => chats.get(chatId)?.messages[messageId - 1];

  return {
    bot,
    commands: [],

    sendAsUser({ chatId, text, firstName = DEFAULT_FIRST_NAME }) {
      getChat(chatId).firstName = firstName;
      const message = addMessage(chatId, "user", text, []);
      const command = COMMAND_PATTERN.exec(text);
      const updateId = pushUpdate((update_id) => ({
        update_id,
        message: {
          message_id: message.messageId,
          date: message.date,
          chat: { id: chatId, type: "private", first_name: firstName },
          from: { id: chatId, is_bot: false, first_name: firstName },
          text,
          ...(command && { entities: [{ type: "bot_command", offset: 0, length: command[0].length }] }),
        },
      }));
      return { updateId, message };
    },

    pressButton({ chatId, messageId, data }) {
      const message = findMessage(chatId, messageId);
      if (!message || message.from !== "bot") throw new Error("no such message");
      if (!message.buttons.some((row) => row.some((button) => button.data === data))) {
        throw new Error("no such button");
      }
      lastCallbackId += 1;
      const callback: FakeCallback = {
        id: `cb-${lastCallbackId}`,
        chatId,
        messageId,
        data,
        answered: false,
        answerText: null,
      };
      const chat = getChat(chatId);
      chat.callbacks.push(callback);
      callbacksById.set(callback.id, callback);
      const updateId = pushUpdate((update_id) => ({
        update_id,
        callback_query: {
          id: callback.id,
          from: { id: chatId, is_bot: false, first_name: chat.firstName },
          chat_instance: `ci-${chatId}`,
          data,
          message: toBotApiMessage(message, bot),
        },
      }));
      return { updateId, callback };
    },

    botSend({ chatId, text, buttons }) {
      return addMessage(chatId, "bot", text, buttons);
    },

    botEdit({ chatId, messageId, text, buttons }) {
      const message = findMessage(chatId, messageId);
      if (!message || message.from !== "bot") throw new BotApiError(400, DESCRIPTIONS.editNotFound);
      if (message.text === text && sameButtons(message.buttons, buttons)) {
        throw new BotApiError(400, DESCRIPTIONS.notModified);
      }
      message.edits.push(message.text);
      message.text = text;
      message.buttons = buttons;
      return message;
    },

    answerCallback({ id, text }) {
      const callback = callbacksById.get(id);
      if (!callback || callback.answered) throw new BotApiError(400, DESCRIPTIONS.queryInvalid);
      callback.answered = true;
      callback.answerText = text ?? null;
      return callback;
    },

    takeUpdates({ offset, limit }) {
      if (offset !== undefined) queue = queue.filter((update) => update.update_id >= offset);
      return queue.slice(0, limit);
    },

    nextUpdate(signal, waitMs) {
      return new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          waiters = waiters.filter((wake) => wake !== done);
          resolve();
        };
        const timer = setTimeout(done, waitMs);
        signal.addEventListener("abort", done);
        waiters.push(done);
      });
    },

    messages: (chatId) => chats.get(chatId)?.messages ?? [],
    chatIds: () => [...chats.keys()],
    findMessage,
    findCallback: (id) => callbacksById.get(id),
    callbacks: (chatId) => chats.get(chatId)?.callbacks ?? [],
    hasChat: (chatId) => chats.get(chatId)?.messages.some((message) => message.from === "user") ?? false,
  };
}
