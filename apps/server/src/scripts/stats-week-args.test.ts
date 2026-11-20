import { buildWeekStats, UsageError, type WeekRows } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseStatsWeekArgs, statsLines } from "./stats-week-args";

const rows = (replies: WeekRows["replies"]): WeekRows => ({
  truth: [],
  delegations: [],
  loops: null,
  moves: [],
  rejects: [],
  mistakes: [],
  handled: [],
  urgent: [],
  llmCalls: [],
  replies,
  gates: [],
  mailboxes: 1,
});
const statsOf = (replies: WeekRows["replies"]) =>
  buildWeekStats(rows(replies), {
    weekStart: "2026-11-16",
    mailboxId: null,
    timeZone: "Europe/Warsaw",
    now: new Date("2026-11-25T10:00:00Z"),
  });

describe("statsLines: the reply drafts line", () => {
  test("a week with no reply draft count prints no line", () => {
    expect(statsLines(statsOf({ pairs: [], requests: [] })).some((line) => line.startsWith("reply_drafts"))).toBe(
      false
    );
  });

  test("a week with counts prints one line with every count and no text", () => {
    const lines = statsLines(
      statsOf({
        pairs: [
          { status: "applied", reason: null },
          { status: "applied", reason: null },
          { status: "rejected", reason: null },
          { status: "expired", reason: "timeout" },
          { status: "expired", reason: "newer_mail" },
        ],
        requests: [{ status: "no_draft" }, { status: "no_draft" }, { status: "no_draft" }],
      })
    );
    expect(lines.filter((line) => line.startsWith("reply_drafts"))).toEqual([
      "reply_drafts made 5 sent_by_tap 2 sent_by_user 0 rejected 1 expired 1 newer_mail 1 answered 0 original_moved 0 draft_changed 0 no_draft 3 failed 0",
    ]);
  });

  test("a week with only requests that ended with no draft or failed prints the line too", () => {
    const line = (requests: WeekRows["replies"]["requests"]) =>
      statsLines(statsOf({ pairs: [], requests })).filter((l) => l.startsWith("reply_drafts"));
    expect(line([{ status: "no_draft" }])).toEqual([
      "reply_drafts made 0 sent_by_tap 0 sent_by_user 0 rejected 0 expired 0 newer_mail 0 answered 0 original_moved 0 draft_changed 0 no_draft 1 failed 0",
    ]);
    expect(line([{ status: "failed" }, { status: "failed" }])[0]).toContain("made 0");
    expect(line([{ status: "failed" }, { status: "failed" }])[0]).toContain("failed 2");
  });
});

const org = "11111111-1111-4111-8111-111111111111";
const mailbox = "22222222-2222-4222-8222-222222222222";

describe("parseStatsWeekArgs", () => {
  test("the organization alone: no mailbox, the last finished week", () => {
    expect(parseStatsWeekArgs(["--org-id", org])).toEqual({ orgId: org, mailboxId: null, week: null });
  });

  test("the organization, a mailbox and a Monday", () => {
    expect(parseStatsWeekArgs(["--org-id", org, "--mailbox-id", mailbox, "--week", "2026-11-16"])).toEqual({
      orgId: org,
      mailboxId: mailbox,
      week: "2026-11-16",
    });
  });

  test.each([
    ["no argument", []],
    ["a day that is not a Monday", ["--org-id", org, "--week", "2026-11-17"]],
    ["a date that does not exist", ["--org-id", org, "--week", "2026-02-30"]],
    ["an --org-id that is no uuid", ["--org-id", "not-a-uuid"]],
    ["a --mailbox-id that is no uuid", ["--org-id", org, "--mailbox-id", "x"]],
    ["an operand", ["--org-id", org, "stray"]],
    ["an unknown flag", ["--org-id", org, "--no-such-flag"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseStatsWeekArgs(argv)).toThrow(UsageError);
  });
});
