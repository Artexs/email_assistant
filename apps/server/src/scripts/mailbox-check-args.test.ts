import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseMailboxCheckArgs } from "./mailbox-check-args";

const org = "11111111-1111-4111-8111-111111111111";
const mailbox = "22222222-2222-4222-8222-222222222222";

describe("parseMailboxCheckArgs", () => {
  test("the ids with --probe", () => {
    expect(parseMailboxCheckArgs(["--org-id", org, "--mailbox-id", mailbox, "--probe"])).toEqual({
      orgId: org,
      mailboxId: mailbox,
      probe: true,
    });
  });

  test("the ids alone: probe is off", () => {
    expect(parseMailboxCheckArgs(["--org-id", org, "--mailbox-id", mailbox])).toEqual({
      orgId: org,
      mailboxId: mailbox,
      probe: false,
    });
  });

  test.each([
    ["a missing --mailbox-id", ["--org-id", org]],
    ["a missing --org-id", ["--mailbox-id", mailbox]],
    ["an id that is no uuid", ["--org-id", "x", "--mailbox-id", mailbox]],
    ["an operand", ["--org-id", org, "--mailbox-id", mailbox, "extra"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseMailboxCheckArgs(argv)).toThrow(UsageError);
  });
});
