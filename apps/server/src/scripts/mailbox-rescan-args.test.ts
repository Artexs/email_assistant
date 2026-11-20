import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseMailboxRescanArgs } from "./mailbox-rescan-args";

const org = "11111111-1111-4111-8111-111111111111";
const mailbox = "22222222-2222-4222-8222-222222222222";

describe("parseMailboxRescanArgs", () => {
  test("the two ids", () => {
    expect(parseMailboxRescanArgs(["--org-id", org, "--mailbox-id", mailbox])).toEqual({
      orgId: org,
      mailboxId: mailbox,
    });
  });

  test.each([
    ["no argument", []],
    ["a missing --mailbox-id", ["--org-id", org]],
    ["an id that is no uuid", ["--org-id", org, "--mailbox-id", "x"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseMailboxRescanArgs(argv)).toThrow(UsageError);
  });
});
