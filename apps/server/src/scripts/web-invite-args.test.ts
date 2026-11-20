import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseWebInviteArgs } from "./web-invite-args";

const orgId = "0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11";
const userId = "5d1c2a77-3b0e-4a5f-8c0d-1e2f3a4b5c6d";

describe("parseWebInviteArgs", () => {
  test("the organization alone", () => {
    expect(parseWebInviteArgs(["--org-id", orgId])).toEqual({ orgId, userId: undefined, print: false });
  });

  test("a member and --print", () => {
    expect(parseWebInviteArgs(["--org-id", orgId, "--user-id", userId, "--print"])).toEqual({
      orgId,
      userId,
      print: true,
    });
  });

  test.each([
    ["no --org-id", ["--user-id", userId]],
    ["--org-id x", ["--org-id", "x"]],
    ["--user-id x", ["--org-id", orgId, "--user-id", "x"]],
  ])("%s is a usage error", (_name, argv) => {
    expect(() => parseWebInviteArgs(argv)).toThrow(UsageError);
  });

  test("an unknown flag throws a parse error that runCli maps to usage", () => {
    expect(() => parseWebInviteArgs(["--org-id", orgId, "--nope"])).toThrow(/--nope/);
  });
});
