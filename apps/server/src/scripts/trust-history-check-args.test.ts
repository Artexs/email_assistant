import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseTrustHistoryCheckArgs } from "./trust-history-check-args";

const org = "11111111-1111-4111-8111-111111111111";
const mailbox = "22222222-2222-4222-8222-222222222222";

describe("parseTrustHistoryCheckArgs", () => {
  test("both ids give a typed value", () => {
    expect(parseTrustHistoryCheckArgs(["--org-id", org, "--mailbox-id", mailbox])).toEqual({
      orgId: org,
      mailboxId: mailbox,
    });
  });

  test.each([
    ["a missing mailbox id", ["--org-id", org]],
    ["a missing organization id", ["--mailbox-id", mailbox]],
    ["a bad organization id", ["--org-id", "nope", "--mailbox-id", mailbox]],
    ["a bad mailbox id", ["--org-id", org, "--mailbox-id", "nope"]],
    ["an unknown flag", ["--org-id", org, "--mailbox-id", mailbox, "--no-such-flag"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseTrustHistoryCheckArgs(argv)).toThrow(UsageError);
  });
});
