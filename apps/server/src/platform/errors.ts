/** Timeout, 429, 503 or lost connection: the job runner may retry. */
export class SoftError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SoftError";
  }
}

/** Every other failure: the job runner does not retry by itself. */
export class HardError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HardError";
  }
}

/** A log-safe label of an error: the name and a string or number `code`, never the message. */
export function describeError(error: unknown): string {
  const label = error instanceof Error ? error.name : typeof error;
  if (typeof error !== "object" || error === null) {
    return label;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? `${label} ${code}` : label;
}

// A system or protocol code: upper-case letters, digits and underscores (ECONNRESET, ERR_TLS_X, 23514). A string
// with a hyphen or a lower-case letter can be text from a server: errorFields leaves it out.
const SAFE_CODE = /^[A-Z0-9_]{1,64}$/;

/** D14: the error name (or typeof for a non-object) and its string or number code, never the message. A string code of another shape is left out. For the event form: log.error("x_failed", { ...errorFields(error) }). */
export function errorFields(error: unknown): { error: string; error_code?: string | number } {
  const name = error instanceof Error ? error.name : typeof error;
  if (typeof error !== "object" || error === null) {
    return { error: name };
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" || (typeof code === "string" && SAFE_CODE.test(code))
    ? { error: name, error_code: code }
    : { error: name };
}
