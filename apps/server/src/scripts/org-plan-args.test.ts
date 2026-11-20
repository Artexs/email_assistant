import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseOrgPlanArgs } from "./org-plan-args";

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

describe("parseOrgPlanArgs", () => {
  test("parses the full set", () => {
    expect(
      parseOrgPlanArgs(["--org-id", orgId, "--plan", "trial", "--trial-days", "14", "--max-mailboxes", "3"])
    ).toEqual({ orgId, plan: "trial", trialDays: 14, maxMailboxes: 3 });
  });

  test("keeps only the org id when nothing else is given", () => {
    expect(parseOrgPlanArgs(["--org-id", orgId])).toEqual({ orgId });
  });

  test("a bad argument is a usage error", () => {
    expect(isUsageError(() => parseOrgPlanArgs(["--plan", "active"]))).toBe(true);
    expect(isUsageError(() => parseOrgPlanArgs(["--org-id", "nope"]))).toBe(true);
    expect(isUsageError(() => parseOrgPlanArgs(["--org-id", orgId, "--plan", "gold"]))).toBe(true);
    expect(isUsageError(() => parseOrgPlanArgs(["--org-id", orgId, "--trial-days", "1.5"]))).toBe(true);
    expect(isUsageError(() => parseOrgPlanArgs(["--org-id", orgId, "--max-mailboxes", "-1"]))).toBe(true);
    expect(isUsageError(() => parseOrgPlanArgs(["--org-id", orgId, "extra"]))).toBe(true);
    expect(isUsageError(() => parseOrgPlanArgs(["--org-id", orgId, "--unknown", "x"]))).toBe(true);
  });
});
