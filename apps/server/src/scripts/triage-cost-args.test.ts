import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseTriageCostArgs } from "./triage-cost-args";

const ORG = "11111111-1111-4111-8111-111111111111";
const MAILBOX = "22222222-2222-4222-8222-222222222222";
const base = ["--org-id", ORG, "--mailbox-id", MAILBOX];

describe("parseTriageCostArgs", () => {
  test.each([
    [base, { orgId: ORG, mailboxId: MAILBOX, days: 7, mail: "real" }],
    [[...base, "--days", "30", "--mail", "synthetic"], { orgId: ORG, mailboxId: MAILBOX, days: 30, mail: "synthetic" }],
    [[...base, "--days", "365"], { orgId: ORG, mailboxId: MAILBOX, days: 365, mail: "real" }],
  ])("%p parses", (argv, expected) => {
    expect(parseTriageCostArgs(argv)).toEqual(expected as never);
  });

  test.each([
    [["--mailbox-id", MAILBOX]],
    [["--org-id", ORG]],
    [["--org-id", "nope", "--mailbox-id", MAILBOX]],
    [[...base, "--days", "x"]],
    [[...base, "--days", "0"]],
    [[...base, "--days", "366"]],
    [[...base, "--mail", "all"]],
  ])("%p is a usage error", (argv) => {
    expect(() => parseTriageCostArgs(argv)).toThrow(UsageError);
  });

  test("an unknown flag is a parse error that runCli maps to exit 2", () => {
    expect(() => parseTriageCostArgs([...base, "--no-such-flag"])).toThrow(
      expect.objectContaining({ code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" })
    );
  });
});
