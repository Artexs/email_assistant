import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseOpsAlertsArgs } from "./ops-alerts-args";

// "usage" for a `UsageError`, the `parseArgs` error code otherwise: `runCli` maps both to exit 2.
function failure(argv: string[]): string {
  try {
    parseOpsAlertsArgs(argv);
  } catch (error) {
    return error instanceof UsageError ? "usage" : String((error as { code?: unknown }).code);
  }
  return "no error";
}

describe("parseOpsAlertsArgs", () => {
  test.each([
    [[], 7],
    [["--days", "30"], 30],
    [["--days", "1"], 1],
    [["--days", "365"], 365],
  ])("%p gives %p days", (argv, days) => {
    expect(parseOpsAlertsArgs(argv)).toEqual({ days });
  });

  test.each([
    [["--days", "0"], "usage"],
    [["--days", "366"], "usage"],
    [["--days", "1.5"], "usage"],
    [["--days", "x"], "usage"],
    [["--days"], "ERR_PARSE_ARGS_INVALID_OPTION_VALUE"],
    [["7"], "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL"],
    [["--all"], "ERR_PARSE_ARGS_UNKNOWN_OPTION"],
  ])("%p is a usage error: %p", (argv, kind) => {
    expect(failure(argv)).toBe(kind);
  });
});
