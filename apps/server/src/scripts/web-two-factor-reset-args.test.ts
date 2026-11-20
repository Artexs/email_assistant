import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseTwoFactorResetArgs } from "./web-two-factor-reset-args";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("parseTwoFactorResetArgs", () => {
  test("both ids and a confirm give the object", () => {
    expect(parseTwoFactorResetArgs(["--org-id", ORG, "--user-id", USER, "--confirm", "Acme"])).toEqual({
      orgId: ORG,
      userId: USER,
      confirm: "Acme",
    });
  });

  test("a missing or blank confirm is a usage error", () => {
    expect(() => parseTwoFactorResetArgs(["--org-id", ORG, "--user-id", USER])).toThrow(UsageError);
    expect(() => parseTwoFactorResetArgs(["--org-id", ORG, "--user-id", USER, "--confirm", " "])).toThrow(UsageError);
  });

  test("a missing or bad id, an unknown option or a positional is a usage error", () => {
    expect(() => parseTwoFactorResetArgs(["--org-id", ORG, "--confirm", "Acme"])).toThrow();
    expect(() => parseTwoFactorResetArgs(["--user-id", USER, "--confirm", "Acme"])).toThrow();
    expect(() => parseTwoFactorResetArgs(["--org-id", "nope", "--user-id", USER, "--confirm", "Acme"])).toThrow();
    expect(() => parseTwoFactorResetArgs(["--org-id", ORG, "--user-id", "nope", "--confirm", "Acme"])).toThrow();
    expect(() =>
      parseTwoFactorResetArgs(["--org-id", ORG, "--user-id", USER, "--confirm", "Acme", "--print"])
    ).toThrow();
    expect(() => parseTwoFactorResetArgs(["--org-id", ORG, "--user-id", USER, "--confirm", "Acme", "extra"])).toThrow();
    expect(() => parseTwoFactorResetArgs([])).toThrow();
  });
});
