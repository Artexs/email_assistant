import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseTelegramLinkArgs } from "./telegram-link-args";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";

describe("parseTelegramLinkArgs", () => {
  test("the organization alone", () => {
    expect(parseTelegramLinkArgs(["--org-id", org])).toEqual({ orgId: org, userId: undefined });
  });

  test("the organization and a user", () => {
    expect(parseTelegramLinkArgs(["--org-id", org, "--user-id", user])).toEqual({ orgId: org, userId: user });
  });

  test.each([
    ["a missing --org-id", ["--user-id", user]],
    ["an --org-id that is no uuid", ["--org-id", "x"]],
    ["a --user-id that is no uuid", ["--org-id", org, "--user-id", "x"]],
    ["an unknown flag", ["--org-id", org, "--no-such-flag"]],
    ["an operand", ["--org-id", org, "extra"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseTelegramLinkArgs(argv)).toThrow(UsageError);
  });
});
