import { parseArgs, type ParseArgsConfig } from "node:util";

import { UsageError } from "@ea/core";

// The first sentence of a `parseArgs` message names the flag and never a value ("Unknown option '--x'").
const FIRST_SENTENCE = /^[^\n]*?(?=\. |\n|$)/;

/**
 * `parseArgs` in strict mode. A bad flag, a missing value or an extra operand throws `UsageError` with safe text (the flag
 * name, never an operand: an operand can be a secret that was put in the wrong place).
 */
export function parseFlags<T extends ParseArgsConfig>(config: T): ReturnType<typeof parseArgs<T>> {
  try {
    // The cast only drops the `strict: true` that this wrapper adds; the result shape is the one of `config`.
    return parseArgs({ ...config, strict: true }) as ReturnType<typeof parseArgs<T>>;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code !== "string" || !code.startsWith("ERR_PARSE_ARGS_")) {
      throw error;
    }
    if (code === "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL") {
      throw new UsageError("unexpected operand");
    }
    const message = error instanceof Error ? error.message : "";
    throw new UsageError(FIRST_SENTENCE.exec(message)?.[0] ?? "bad argument");
  }
}
