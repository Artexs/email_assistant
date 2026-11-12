import { describe, expect, test } from "bun:test";

import { parseOrgPlanArgs } from "./org-plan-args";

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

  test("returns null on a bad argument", () => {
    expect(parseOrgPlanArgs(["--plan", "active"])).toBeNull();
    expect(parseOrgPlanArgs(["--org-id", "nope"])).toBeNull();
    expect(parseOrgPlanArgs(["--org-id", orgId, "--plan", "gold"])).toBeNull();
    expect(parseOrgPlanArgs(["--org-id", orgId, "--trial-days", "1.5"])).toBeNull();
    expect(parseOrgPlanArgs(["--org-id", orgId, "--max-mailboxes", "-1"])).toBeNull();
    expect(parseOrgPlanArgs(["--org-id", orgId, "extra"])).toBeNull();
    expect(parseOrgPlanArgs(["--org-id", orgId, "--unknown", "x"])).toBeNull();
  });
});
