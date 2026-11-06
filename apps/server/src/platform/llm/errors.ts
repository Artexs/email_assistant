import { HardError, SoftError } from "../errors";

// Error messages hold only the code and the model: never the prompt, the answer, the error body or the key.
const errorMessage = (code: string, model: string): string => `LLM error ${code} (${model})`;

export type SoftCode = "http_429" | "http_500" | "http_502" | "http_503" | "http_504" | "timeout" | "network";
export type ConfigCode =
  | "http_401"
  | "http_402"
  | "http_403"
  | "http_404"
  | "http_400_key"
  | "http_400_precondition"
  | "schema_not_strict";

/** Timeout, 429 or 5xx: the quota or the service, not the mail. */
export class LlmSoftError extends SoftError {
  constructor(
    readonly code: SoftCode,
    readonly model: string
  ) {
    super(errorMessage(code, model));
    this.name = "LlmSoftError";
  }
}

/** A bad key, no payment, no access or an unknown model: retrying the mail does not help. */
export class LlmConfigError extends HardError {
  constructor(
    readonly code: ConfigCode,
    readonly model: string
  ) {
    super(errorMessage(code, model));
    this.name = "LlmConfigError";
  }
}

/** Google blocked the prompt or the answer for safety. */
export class LlmBlockedError extends HardError {
  readonly code = "llm_blocked";

  constructor(readonly model: string) {
    super(errorMessage("llm_blocked", model));
    this.name = "LlmBlockedError";
  }
}

export class LlmHardError extends HardError {
  constructor(
    readonly code: `http_${number}` | "unknown",
    readonly model: string
  ) {
    super(errorMessage(code, model));
    this.name = "LlmHardError";
  }
}

/** Empty text without a block, bad JSON or a Zod failure. */
export class LlmOutputError extends HardError {
  readonly code = "bad_output";

  constructor(readonly model: string) {
    super(errorMessage("bad_output", model));
    this.name = "LlmOutputError";
  }
}

export type LlmError = LlmSoftError | LlmConfigError | LlmBlockedError | LlmHardError | LlmOutputError;

export function isLlmError(error: unknown): error is LlmError {
  return (
    error instanceof LlmSoftError ||
    error instanceof LlmConfigError ||
    error instanceof LlmBlockedError ||
    error instanceof LlmHardError ||
    error instanceof LlmOutputError
  );
}

export function llmErrorCode(error: unknown): string {
  return isLlmError(error) ? error.code : "unknown";
}

/** Codes of a lost or refused connection (Node/undici and Bun names). */
const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ConnectionRefused",
  "ConnectionClosed",
  "FailedToOpenSocket",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A fetch failure has no status. Only a known socket or DNS code counts: a plain TypeError is a bug and stays hard. */
export function isNetworkError(error: Record<string, unknown>): boolean {
  if (!(error instanceof Error)) return false;
  const codes = [error.code, isRecord(error.cause) ? error.cause.code : undefined];
  return codes.some((code) => typeof code === "string" && NETWORK_CODES.has(code));
}
