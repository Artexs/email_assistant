import { describe, expect, test } from "bun:test";

import { parseTwoFactorResetArgs } from "./web-two-factor-reset-args";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("parseTwoFactorResetArgs", () => {
  test("both ids give the object", () => {
    expect(parseTwoFactorResetArgs(["--org-id", ORG, "--user-id", USER])).toEqual({ orgId: ORG, userId: USER });
  });

  test("a missing or bad id, an unknown option or a positional give null", () => {
    expect(parseTwoFactorResetArgs(["--org-id", ORG])).toBeNull();
    expect(parseTwoFactorResetArgs(["--user-id", USER])).toBeNull();
    expect(parseTwoFactorResetArgs(["--org-id", "nope", "--user-id", USER])).toBeNull();
    expect(parseTwoFactorResetArgs(["--org-id", ORG, "--user-id", "nope"])).toBeNull();
    expect(parseTwoFactorResetArgs(["--org-id", ORG, "--user-id", USER, "--print"])).toBeNull();
    expect(parseTwoFactorResetArgs(["--org-id", ORG, "--user-id", USER, "extra"])).toBeNull();
    expect(parseTwoFactorResetArgs([])).toBeNull();
  });
});
