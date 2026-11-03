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
