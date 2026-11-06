import { GrammyError, HttpError } from "grammy";

import { describeError } from "../../../platform/errors";
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
    const method = /^Network request for '([A-Za-z]+)' failed/.exec(error.message)?.[1];
    return method === undefined ? "HttpError" : `HttpError ${method}`;
  }
  return describeError(error);
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
