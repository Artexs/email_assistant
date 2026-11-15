import type { Api } from "grammy";

import { createTelegramApi } from "./api";

export const DIRECT_SEND_TIMEOUT_MS = 10_000;

/** A plain text to one chat with no outbox row. The abort signal bounds the call: grammY has no request timeout of its own (default 500 s). */
export async function sendDirectText(api: Api, chatId: number, text: string, timeoutMs?: number): Promise<void> {
  // grammY types the signal with the `abort-controller` package; the runtime's `AbortSignal` is the same object at run time.
  const signal = AbortSignal.timeout(timeoutMs ?? DIRECT_SEND_TIMEOUT_MS) as unknown as Parameters<
    Api["sendMessage"]
  >[3];
  await api.sendMessage(chatId, text, {}, signal);
}

/** The same send for a process that has no runtime (the CLI `ops:alert-test`): it builds the API from the token. */
export function directSender(
  token: string,
  chatId: number,
  opts?: { apiRoot?: string }
): (text: string) => Promise<void> {
  const api = createTelegramApi(token, opts);
  return (text) => sendDirectText(api, chatId, text);
}
