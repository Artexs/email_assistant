import { AgentMailError } from "../../modules/testmail";
import { exitCodeOf } from "../../platform/cli";
import { ConfigError } from "../../platform/config";
import { describeError, HardError } from "../../platform/errors";

/**
 * The one safe line for an error of a testmail tool, and its exit code (docs/cli.md): 3 when an outside system did not answer,
 * else 1. A `HardError`, `ConfigError` or `AgentMailError` message is written for the operator and holds no secret (an AgentMail
 * message names the op, status, name and code only); every other error shows its label only.
 */
export function failureOf(error: unknown): { code: 1 | 3; text: string } {
  const code = exitCodeOf(error);
  if (error instanceof HardError || error instanceof ConfigError || error instanceof AgentMailError) {
    return { code, text: error.message };
  }
  return { code, text: `${code === 3 ? "unreachable" : "failed"}: ${describeError(error)}` };
}
