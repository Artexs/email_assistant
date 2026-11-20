import { format } from "node:util";

import { EXIT } from "@ea/core";

import { exitCodeOf, type CliOutput } from "../../platform/cli";
import { describeError } from "../../platform/errors";

/**
 * The outer catch of a mailbox tool: prints one line and returns the exit code. An unreachable database or mail server gives
 * `unreachable: <error name and code>` and 3 (docs/cli.md). Any other error gives `failed:` and 1. `detail` keeps the text
 * each tool printed before: `"message"` prints the error message (the mail-connection tools, the exception of docs/cli.md
 * § Output), `"label"` prints only the error name and code.
 */
export function reportFailure(out: CliOutput, error: unknown, detail: "message" | "label"): number {
  const code = exitCodeOf(error);
  if (code === EXIT.unreachable) {
    out.fail(`unreachable: ${describeError(error)}`);
    return code;
  }
  const text = detail === "label" ? describeError(error) : error instanceof Error ? error.message : format(error);
  out.fail(`failed: ${text}`);
  return code;
}
