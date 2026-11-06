import type { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";

export const testBotInfo: UserFromGetMe = {
  id: 424242,
  is_bot: true,
  first_name: "Test bot",
  username: "test_ea_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

export interface RecordedCall {
  method: string;
  payload: Record<string, unknown>;
}

// No request leaves the process: the transformer answers every call itself.
export function recordCalls(bot: Bot): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "sendMessage") {
      const sent = payload as { chat_id: number; text: string };
      return Promise.resolve({
        ok: true,
        result: {
          message_id: 1000 + calls.length,
          date: 0,
          chat: { id: sent.chat_id, type: "private", first_name: "Test" },
          text: sent.text,
        },
      } as never);
    }
    return Promise.resolve({ ok: true, result: true } as never);
  });
  return { calls };
}

export function messageUpdate(input: {
  updateId: number;
  chatId: number;
  text: string;
  chatType?: "private" | "group" | "supergroup";
  fromIsBot?: boolean;
}): Update {
  const command = /^\/[A-Za-z0-9_]+/.exec(input.text);
  return {
    update_id: input.updateId,
    message: {
      message_id: input.updateId,
      date: 0,
      chat: { id: input.chatId, type: input.chatType ?? "private", first_name: "Test" } as never,
      from: { id: input.chatId, is_bot: input.fromIsBot ?? false, first_name: "Test" },
      text: input.text,
      ...(command ? { entities: [{ type: "bot_command", offset: 0, length: command[0].length }] } : {}),
    },
  };
}

export function callbackUpdate(input: { updateId: number; chatId: number; data: string; messageId: number }): Update {
  return {
    update_id: input.updateId,
    callback_query: {
      id: `cb-${input.updateId}`,
      from: { id: input.chatId, is_bot: false, first_name: "Test" },
      chat_instance: "test",
      data: input.data,
      message: {
        message_id: input.messageId,
        date: 0,
        chat: { id: input.chatId, type: "private", first_name: "Test" },
        text: "old",
      },
    },
  };
}
