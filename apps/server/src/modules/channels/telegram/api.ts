import { CALLBACK_MAX_BYTES, MESSAGE_MAX_CHARS, type OutButton, type OutMessage } from "@ea/core";
import { Api } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";

import { ChannelError, type ChatChannel } from "../port";

import { isNotModified, toChannelError } from "./errors";

export function createTelegramApi(token: string, opts?: { apiRoot?: string }): Api {
  return new Api(token, opts?.apiRoot === undefined ? undefined : { apiRoot: opts.apiRoot });
}

/** Options for every send and edit: plain text (no `parse_mode`), no link preview, optional keyboard. */
export function messageOptions(
  buttons: OutButton[][],
  opts: { clearKeyboard: boolean }
): { link_preview_options: { is_disabled: true }; reply_markup?: InlineKeyboardMarkup } {
  const base = { link_preview_options: { is_disabled: true as const } };
  if (buttons.length === 0) {
    return opts.clearKeyboard ? { ...base, reply_markup: { inline_keyboard: [] } } : base;
  }
  return {
    ...base,
    reply_markup: {
      inline_keyboard: buttons.map((row) => row.map((button) => ({ text: button.text, callback_data: button.data }))),
    },
  };
}

function guard(message: OutMessage): void {
  if (message.text.length < 1 || message.text.length > MESSAGE_MAX_CHARS) {
    throw new ChannelError("bad_request", "message_too_long");
  }
  for (const row of message.buttons) {
    for (const button of row) {
      const bytes = Buffer.byteLength(button.data);
      if (bytes < 1 || bytes > CALLBACK_MAX_BYTES) {
        throw new ChannelError("bad_request", "button_data_too_long");
      }
    }
  }
}

export function createTelegramChannel(api: Api): ChatChannel {
  return {
    async send(chatId, message) {
      guard(message);
      try {
        const result = await api.sendMessage(
          chatId,
          message.text,
          messageOptions(message.buttons, { clearKeyboard: false })
        );
        return { messageId: result.message_id };
      } catch (error) {
        throw toChannelError(error);
      }
    },
    async edit(chatId, messageId, message) {
      guard(message);
      try {
        await api.editMessageText(
          chatId,
          messageId,
          message.text,
          messageOptions(message.buttons, { clearKeyboard: true })
        );
      } catch (error) {
        if (isNotModified(error)) {
          return;
        }
        throw toChannelError(error);
      }
    },
  };
}
