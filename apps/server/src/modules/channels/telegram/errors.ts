import { GrammyError, HttpError } from "grammy";

import { describeError } from "../../../platform/errors";

/**
 * A log-safe label of a Telegram error. Never uses the inner error, the payload or the description:
 * the inner error of an `HttpError` holds the URL with the token, the payload holds the message text.
 */
export function telegramErrorLabel(error: unknown): string {
  if (error instanceof GrammyError) {
    return `GrammyError ${error.method} ${error.error_code}`;
  }
  if (error instanceof HttpError) {
    const method = /^Network request for '([A-Za-z]+)' failed/.exec(error.message)?.[1];
    return method === undefined ? "HttpError" : `HttpError ${method}`;
  }
  return describeError(error);
}
