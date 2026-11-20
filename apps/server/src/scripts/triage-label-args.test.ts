import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseTriageLabelArgs } from "./triage-label-args";

const ORG = "11111111-1111-4111-8111-111111111111";
const MAILBOX = "22222222-2222-4222-8222-222222222222";
const EMAIL = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

describe("parseTriageLabelArgs", () => {
  test.each([
    [
      ["--org-id", ORG, "--mailbox-id", MAILBOX],
      { mode: "interactive", orgId: ORG, mailboxId: MAILBOX, limit: 20, synthetic: false },
    ],
    [
      ["--org-id", ORG, "--mailbox-id", MAILBOX, "--limit", "5", "--user-id", USER, "--synthetic"],
      { mode: "interactive", orgId: ORG, mailboxId: MAILBOX, limit: 5, synthetic: true, userId: USER },
    ],
    [
      ["--org-id", ORG, "--email-id", EMAIL, "--category", "spam"],
      { mode: "single", orgId: ORG, emailId: EMAIL, trueCategory: "spam" },
    ],
    [
      ["--org-id", ORG, "--email-id", EMAIL, "--wrong"],
      { mode: "single", orgId: ORG, emailId: EMAIL, verdict: "wrong" },
    ],
    [
      ["--org-id", ORG, "--email-id", EMAIL, "--right"],
      { mode: "single", orgId: ORG, emailId: EMAIL, verdict: "right" },
    ],
  ])("%p parses", (argv, expected) => {
    expect(parseTriageLabelArgs(argv)).toEqual(expected as never);
  });

  test.each([
    [["--mailbox-id", MAILBOX]],
    [["--org-id", ORG]],
    [["--org-id", ORG, "--mailbox-id", MAILBOX, "--user-id", "nope"]],
    [["--org-id", ORG, "--mailbox-id", MAILBOX, "--limit", "0"]],
    [["--org-id", ORG, "--mailbox-id", MAILBOX, "--right"]],
    [["--org-id", ORG, "--email-id", EMAIL]],
    [["--org-id", ORG, "--email-id", EMAIL, "--right", "--wrong"]],
    [["--org-id", ORG, "--email-id", EMAIL, "--category", "news"]],
    [["--org-id", ORG, "--email-id", EMAIL, "--mailbox-id", MAILBOX, "--right"]],
  ])("%p is a usage error", (argv) => {
    expect(() => parseTriageLabelArgs(argv)).toThrow(UsageError);
  });

  test("an unknown flag is a parse error that runCli maps to exit 2", () => {
    expect(() => parseTriageLabelArgs(["--org-id", ORG, "--no-such-flag"])).toThrow(
      expect.objectContaining({ code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" })
    );
  });
});
