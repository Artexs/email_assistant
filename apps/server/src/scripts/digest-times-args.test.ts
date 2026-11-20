import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseDigestTimesArgs } from "./digest-times-args";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";

describe("parseDigestTimesArgs", () => {
  test("two times are sorted and kept", () => {
    expect(parseDigestTimesArgs(["--org-id", org, "--times", "18:00,07:30"])).toEqual({
      orgId: org,
      userId: undefined,
      times: ["07:30", "18:00"],
    });
  });

  test("none is an empty list, and a user id is kept", () => {
    expect(parseDigestTimesArgs(["--org-id", org, "--user-id", user, "--times", "none"])).toEqual({
      orgId: org,
      userId: user,
      times: [],
    });
  });

  test.each([
    ["a time that is not a time of day", ["--org-id", org, "--times", "25:00"]],
    ["a missing --times", ["--org-id", org]],
    ["a missing organization id", ["--times", "07:30"]],
    ["a bad organization id", ["--org-id", "x", "--times", "07:30"]],
    ["a bad user id", ["--org-id", org, "--user-id", "x", "--times", "07:30"]],
    ["an operand", ["--org-id", org, "--times", "07:30", "extra"]],
    ["an unknown flag", ["--org-id", org, "--times", "07:30", "--no-such-flag"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseDigestTimesArgs(argv)).toThrow(UsageError);
  });
});
