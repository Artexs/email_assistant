import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseOrgStatusArgs } from "./org-status-args";

const orgId = "0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11";

describe("parseOrgStatusArgs", () => {
  test("no argument means every organization", () => {
    expect(parseOrgStatusArgs([])).toEqual({});
  });

  test("a uuid names one organization", () => {
    expect(parseOrgStatusArgs(["--org-id", orgId])).toEqual({ orgId });
  });

  test("a value that is not a uuid is a usage error", () => {
    expect(() => parseOrgStatusArgs(["--org-id", "not-a-uuid"])).toThrow(UsageError);
  });

  test("an unknown flag throws a parse error that runCli maps to usage", () => {
    expect(() => parseOrgStatusArgs(["--nope"])).toThrow(/--nope/);
  });
});
