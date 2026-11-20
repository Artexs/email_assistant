import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseOrgFlagArgs } from "./org-flag-args";

// A usage error: a `UsageError` of the parser, or a `parseArgs` error (unknown flag, missing value), which `runCli` maps to exit 2 as well.
function isUsageError(run: () => unknown): boolean {
  try {
    run();
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    return error instanceof UsageError || (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_"));
  }
  return false;
}

const orgId = "0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11";

describe("parseOrgFlagArgs", () => {
  test("list mode", () => {
    expect(parseOrgFlagArgs(["--org-id", orgId])).toEqual({ mode: "list", orgId });
  });

  test("set mode, on and off", () => {
    expect(parseOrgFlagArgs(["--org-id", orgId, "--flag", "stats_page", "--on"])).toEqual({
      mode: "set",
      orgId,
      flag: "stats_page",
      enabled: true,
    });
    expect(parseOrgFlagArgs(["--org-id", orgId, "--flag", "stats_page", "--off"])).toEqual({
      mode: "set",
      orgId,
      flag: "stats_page",
      enabled: false,
    });
  });

  test("bad input is a usage error", () => {
    const bad = [
      [],
      ["--org-id", "nope"],
      ["--org-id", orgId, "--flag", "stats_page", "--on", "--off"],
      ["--org-id", orgId, "--flag", "stats_page"],
      ["--org-id", orgId, "--on"],
      ["--org-id", orgId, "--flag", "", "--on"],
      ["--org-id", orgId, "extra"],
      ["--org-id", orgId, "--unknown", "x"],
    ];
    for (const argv of bad)
      expect({ argv, usage: isUsageError(() => parseOrgFlagArgs(argv)) }).toEqual({ argv, usage: true });
  });
});
