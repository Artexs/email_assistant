import { SLO_KINDS, UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseOpsAlertTestArgs } from "./ops-alert-test-args";

// "usage" for a `UsageError`, the `parseArgs` error code otherwise: `runCli` maps both to exit 2.
function failure(argv: string[]): string {
  try {
    parseOpsAlertTestArgs(argv);
  } catch (error) {
    return error instanceof UsageError ? "usage" : String((error as { code?: unknown }).code);
  }
  return "no error";
}

describe("parseOpsAlertTestArgs", () => {
  test("--kind takes one kind; --all takes every kind", () => {
    expect(parseOpsAlertTestArgs(["--kind", "slo_disk"])).toEqual({ kinds: ["slo_disk"] });
    expect(parseOpsAlertTestArgs(["--all"])).toEqual({ kinds: [...SLO_KINDS] });
  });

  test.each([
    [[], "usage"],
    [["--all", "--kind", "slo_disk"], "usage"],
    [["--kind", "nope"], "usage"],
    [["--kind"], "ERR_PARSE_ARGS_INVALID_OPTION_VALUE"],
    [["slo_disk"], "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL"],
  ])("%p is a usage error: %p", (argv, kind) => {
    expect(failure(argv)).toBe(kind);
  });
});
