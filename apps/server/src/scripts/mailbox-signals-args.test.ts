import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseMailboxSignalsArgs } from "./mailbox-signals-args";

const ORG = "11111111-1111-4111-8111-111111111111";
const BOX = "22222222-2222-4222-8222-222222222222";
const base = ["--org-id", ORG, "--mailbox-id", BOX];

describe("parseMailboxSignalsArgs", () => {
  test("the ids alone: the window is 30 days", () => {
    expect(parseMailboxSignalsArgs(base)).toEqual({ orgId: ORG, mailboxId: BOX, days: 30 });
  });

  test("--days 1 and 90 are the bounds", () => {
    expect(parseMailboxSignalsArgs([...base, "--days", "1"]).days).toBe(1);
    expect(parseMailboxSignalsArgs([...base, "--days", "90"]).days).toBe(90);
  });

  test.each([
    ["a missing --mailbox-id", ["--org-id", ORG]],
    ["a missing --org-id", ["--mailbox-id", BOX]],
    ["an id that is no uuid", ["--org-id", ORG, "--mailbox-id", "x"]],
    ["--days 91", [...base, "--days", "91"]],
    ["--days 0", [...base, "--days", "0"]],
    ["--days that is no number", [...base, "--days", "many"]],
    ["an unknown flag", [...base, "--no-such-flag"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseMailboxSignalsArgs(argv)).toThrow(UsageError);
  });
});
