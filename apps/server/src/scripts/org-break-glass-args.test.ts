import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseOrgBreakGlassArgs } from "./org-break-glass-args";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("parseOrgBreakGlassArgs", () => {
  test("9 an organization alone lists; with a user it sets; with --clear it clears; both change data only with --confirm", () => {
    expect(parseOrgBreakGlassArgs(["--org-id", ORG])).toEqual({ mode: "list", orgId: ORG });
    expect(parseOrgBreakGlassArgs(["--org-id", ORG, "--user-id", USER, "--confirm", "Acme"])).toEqual({
      mode: "set",
      orgId: ORG,
      userId: USER,
      confirm: "Acme",
    });
    expect(parseOrgBreakGlassArgs(["--org-id", ORG, "--clear", "--confirm", "Acme"])).toEqual({
      mode: "clear",
      orgId: ORG,
      confirm: "Acme",
    });
  });

  test("a set or a clear without a confirm, or a list with one, is a usage error", () => {
    expect(() => parseOrgBreakGlassArgs(["--org-id", ORG, "--user-id", USER])).toThrow(UsageError);
    expect(() => parseOrgBreakGlassArgs(["--org-id", ORG, "--user-id", USER, "--confirm", "  "])).toThrow(UsageError);
    expect(() => parseOrgBreakGlassArgs(["--org-id", ORG, "--clear"])).toThrow(UsageError);
    expect(() => parseOrgBreakGlassArgs(["--org-id", ORG, "--confirm", "Acme"])).toThrow(UsageError);
  });

  test("10 a bad or missing argument throws a usage error", () => {
    expect(() => parseOrgBreakGlassArgs([])).toThrow();
    expect(() => parseOrgBreakGlassArgs(["--org-id", "not-a-uuid"])).toThrow();
    expect(() => parseOrgBreakGlassArgs(["--user-id", USER])).toThrow();
    expect(() => parseOrgBreakGlassArgs(["--org-id", ORG, "--user-id", "x"])).toThrow();
    expect(() =>
      parseOrgBreakGlassArgs(["--org-id", ORG, "--user-id", USER, "--clear", "--confirm", "Acme"])
    ).toThrow();
    expect(() => parseOrgBreakGlassArgs(["--org-id", ORG, "--other"])).toThrow();
    expect(() => parseOrgBreakGlassArgs(["--org-id", ORG, "extra"])).toThrow();
  });
});
