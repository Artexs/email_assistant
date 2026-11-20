import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseTelegramUnlinkArgs } from "./telegram-unlink-args";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";

describe("parseTelegramUnlinkArgs", () => {
  test("the organization and the user", () => {
    expect(parseTelegramUnlinkArgs(["--org-id", org, "--user-id", user])).toEqual({ orgId: org, userId: user });
  });

  test.each([
    ["a missing --user-id", ["--org-id", org]],
    ["a missing --org-id", ["--user-id", user]],
    ["an id that is no uuid", ["--org-id", org, "--user-id", "x"]],
    ["an unknown flag", ["--org-id", org, "--user-id", user, "--no-such-flag"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseTelegramUnlinkArgs(argv)).toThrow(UsageError);
  });
});
