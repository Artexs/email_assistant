import { GrammyError, HttpError } from "grammy";

import { describeError, errorFields } from "../../../platform/errors";
import { ChannelError } from "../port";

/**
 * A log-safe label of a Telegram error. Never uses the inner error, the payload or the description:
 * the inner error of an `HttpError` holds the URL with the token, the payload holds the message text.
 */
export function telegramErrorLabel(error: unknown): string {
  if (error instanceof GrammyError) {
    return `GrammyError ${error.method} ${error.error_code}`;
  }
  if (error instanceof HttpError) {
    const method = HTTP_ERROR_METHOD.exec(error.message)?.[1];
    return method === undefined ? "HttpError" : `HttpError ${method}`;
  }
  return describeError(error);
}

const HTTP_ERROR_METHOD = /^Network request for '([A-Za-z]+)' failed/;

/** Event fields of a Telegram client error: never the description, the payload or an inner error (they can hold the token). */
export function telegramErrorFields(error: unknown): { error: string; error_code?: string | number; method?: string } {
  if (error instanceof GrammyError) {
    // Only a number: a string code could be a token, and the value rule would let it through.
    return typeof error.error_code === "number"
      ? { error: "GrammyError", error_code: error.error_code, method: error.method }
      : { error: "GrammyError", method: error.method };
  }
  if (error instanceof HttpError) {
    const method = HTTP_ERROR_METHOD.exec(error.message)?.[1];
    return method === undefined ? { error: "HttpError" } : { error: "HttpError", method };
  }
  return errorFields(error);
}

/** A GrammyError 400 "message is not modified" is not a failure. The description is read only for this check and never logged. */
export function isNotModified(error: unknown): boolean {
  return (
    error instanceof GrammyError && error.error_code === 400 && error.description.includes("message is not modified")
  );
}

/** Maps any error of the Telegram client to a `ChannelError`. Copies no message, description, payload or inner error. */
export function toChannelError(error: unknown): ChannelError {
  if (error instanceof ChannelError) {
    return error;
  }
  if (error instanceof GrammyError) {
    const code = `telegram_${error.error_code}`;
    if (error.error_code === 429) {
      return new ChannelError("rate_limited", code, (error.parameters?.retry_after ?? 30) * 1000);
    }
    if (error.error_code === 401) {
      return new ChannelError("config", code);
    }
    if (error.error_code === 403) {
      return new ChannelError("blocked", code);
    }
    if (error.error_code === 400) {
      return new ChannelError("bad_request", code);
    }
    return new ChannelError(error.error_code >= 500 ? "soft" : "other", code);
  }
  if (error instanceof HttpError) {
    return new ChannelError("soft", "telegram_network");
  }
  return new ChannelError("other", "telegram_unknown");
}
