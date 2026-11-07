export const TEXT_MAX_CHARS = 4096;
export const CALLBACK_DATA_MAX_BYTES = 64;

/** A Bot API failure. The server turns it into `{ ok: false, error_code, description }`. */
export class BotApiError extends Error {
  constructor(
    readonly code: number,
    readonly description: string,
    readonly retryAfter?: number
  ) {
    super(description);
    this.name = "BotApiError";
  }
}

// The exact Telegram texts are not verified, except "message is not modified" (read by the app).
export const DESCRIPTIONS = {
  unauthorized: "Unauthorized",
  notFound: "Not Found",
  chatNotFound: "Bad Request: chat not found",
  textEmpty: "Bad Request: message text is empty",
  textTooLong: "Bad Request: message is too long",
  buttonDataInvalid: "Bad Request: BUTTON_DATA_INVALID",
  editNotFound: "Bad Request: message to edit not found",
  notModified:
    "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a content and reply markup of the current message",
  queryInvalid: "Bad Request: query is too old and response timeout expired or query ID is invalid",
  conflict: "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
  tooManyRequests: (retryAfter: number) => `Too Many Requests: retry after ${retryAfter}`,
};

export function errorResponse(error: BotApiError): Response {
  return Response.json(
    {
      ok: false,
      error_code: error.code,
      description: error.description,
      ...(error.retryAfter !== undefined && { parameters: { retry_after: error.retryAfter } }),
    },
    { status: error.code }
  );
}
