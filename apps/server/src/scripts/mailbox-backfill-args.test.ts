import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseMailboxBackfillArgs } from "./mailbox-backfill-args";

const ORG = "11111111-1111-4111-8111-111111111111";
const BOX = "22222222-2222-4222-8222-222222222222";
const base = ["--org-id", ORG, "--mailbox-id", BOX];

describe("parseMailboxBackfillArgs", () => {
  test("the ids alone: the window is 30 days", () => {
    expect(parseMailboxBackfillArgs(base)).toEqual({ orgId: ORG, mailboxId: BOX, days: 30 });
  });

  test("--days 1 and 180 are the bounds", () => {
    expect(parseMailboxBackfillArgs([...base, "--days", "1"]).days).toBe(1);
    expect(parseMailboxBackfillArgs([...base, "--days", "180"]).days).toBe(180);
  });

  test.each([
    ["a missing --org-id", ["--mailbox-id", BOX]],
    ["a missing --mailbox-id", ["--org-id", ORG]],
    ["an id that is no uuid", ["--org-id", ORG, "--mailbox-id", "x"]],
    ["--days 181", [...base, "--days", "181"]],
    ["--days 0", [...base, "--days", "0"]],
    ["--days that is no number", [...base, "--days", "many"]],
    ["an unknown flag", [...base, "--no-such-flag"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseMailboxBackfillArgs(argv)).toThrow(UsageError);
  });
});
