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

/** D14: the error name (or typeof for a non-object) and its string or number code, never the message. For the event form: log.error("x_failed", { ...errorFields(error) }). */
export function errorFields(error: unknown): { error: string; error_code?: string | number } {
  const name = error instanceof Error ? error.name : typeof error;
  if (typeof error !== "object" || error === null) {
    return { error: name };
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? { error: name, error_code: code } : { error: name };
}
