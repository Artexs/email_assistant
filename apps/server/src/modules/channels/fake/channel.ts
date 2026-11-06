import type { OutMessage } from "@ea/core";

import type { ChannelError, ChatChannel } from "../port";

export interface FakeChannel extends ChatChannel {
  sent: { chatId: number; message: OutMessage; messageId: number }[];
  edited: { chatId: number; messageId: number; message: OutMessage }[];
  /** The next `times` calls throw `error`; without `times` every call throws until `failWith(null)`. */
  failWith(error: ChannelError | null, times?: number): void;
}

export function createFakeChannel(): FakeChannel {
  let nextId = 1000;
  let failure: ChannelError | null = null;
  let failuresLeft = Number.POSITIVE_INFINITY;

  function throwIfFailing(): void {
    if (failure !== null && failuresLeft > 0) {
      failuresLeft -= 1;
      throw failure;
    }
  }

  const channel: FakeChannel = {
    sent: [],
    edited: [],
    failWith(error, times) {
      failure = error;
      failuresLeft = times ?? Number.POSITIVE_INFINITY;
    },
    async send(chatId, message) {
      throwIfFailing();
      const messageId = nextId;
      nextId += 1;
      channel.sent.push({ chatId, message, messageId });
      return { messageId };
    },
    async edit(chatId, messageId, message) {
      throwIfFailing();
      channel.edited.push({ chatId, messageId, message });
    },
  };
  return channel;
}
