import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseMailboxAuditArgs } from "./mailbox-audit-args";

const ORG = "11111111-1111-4111-8111-111111111111";
const BOX = "22222222-2222-4222-8222-222222222222";
const base = ["--org-id", ORG, "--mailbox-id", BOX];

describe("parseMailboxAuditArgs", () => {
  test("the ids and an ISO time", () => {
    expect(parseMailboxAuditArgs([...base, "--since", "2026-11-01T00:00:00Z"])).toEqual({
      orgId: ORG,
      mailboxId: BOX,
      since: new Date("2026-11-01T00:00:00Z"),
    });
  });

  test.each([
    ["a missing --org-id", ["--mailbox-id", BOX, "--since", "2026-11-01T00:00:00Z"]],
    ["a missing --mailbox-id", ["--org-id", ORG, "--since", "2026-11-01T00:00:00Z"]],
    ["an id that is no uuid", ["--org-id", "x", "--mailbox-id", BOX, "--since", "2026-11-01T00:00:00Z"]],
    ["a missing --since", base],
    ["a --since that is no date", [...base, "--since", "yesterday"]],
    ["an unknown flag", [...base, "--since", "2026-11-01T00:00:00Z", "--no-such-flag"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseMailboxAuditArgs(argv)).toThrow(UsageError);
  });
});
