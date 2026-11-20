import { UsageError } from "@ea/core";
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
  test("--kind takes an incident kind or an event kind", () => {
    expect(parseOpsAlertTestArgs(["--kind", "slo_disk"])).toEqual({ kinds: ["slo_disk"] });
    expect(parseOpsAlertTestArgs(["--kind", "llm_cap"])).toEqual({ kinds: ["llm_cap"] });
  });

  test("--all takes the ten kinds, the incident kinds first", () => {
    expect(parseOpsAlertTestArgs(["--all"])).toEqual({
      kinds: [
        "slo_sync_lag",
        "slo_urgent_latency",
        "slo_llm_errors",
        "slo_disk",
        "slo_backup_age",
        "trial_ending",
        "llm_cap",
        "auth_error_24h",
        "auth_mail_failed",
        "send_limit",
      ],
    });
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
