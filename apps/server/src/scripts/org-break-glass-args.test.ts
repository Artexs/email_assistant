import { describe, expect, test } from "bun:test";

import { parseOrgBreakGlassArgs } from "./org-break-glass-args";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("parseOrgBreakGlassArgs", () => {
  test("9 an organization alone lists; with a user it sets; with --clear it clears", () => {
    expect(parseOrgBreakGlassArgs(["--org-id", ORG])).toEqual({ mode: "list", orgId: ORG });
    expect(parseOrgBreakGlassArgs(["--org-id", ORG, "--user-id", USER])).toEqual({
      mode: "set",
      orgId: ORG,
      userId: USER,
    });
    expect(parseOrgBreakGlassArgs(["--org-id", ORG, "--clear"])).toEqual({ mode: "clear", orgId: ORG });
  });

  test("10 a bad or missing argument gives null", () => {
    expect(parseOrgBreakGlassArgs([])).toBeNull();
    expect(parseOrgBreakGlassArgs(["--org-id", "not-a-uuid"])).toBeNull();
    expect(parseOrgBreakGlassArgs(["--user-id", USER])).toBeNull();
    expect(parseOrgBreakGlassArgs(["--org-id", ORG, "--user-id", "x"])).toBeNull();
    expect(parseOrgBreakGlassArgs(["--org-id", ORG, "--user-id", USER, "--clear"])).toBeNull();
    expect(parseOrgBreakGlassArgs(["--org-id", ORG, "--other"])).toBeNull();
    expect(parseOrgBreakGlassArgs(["--org-id", ORG, "extra"])).toBeNull();
  });
});
