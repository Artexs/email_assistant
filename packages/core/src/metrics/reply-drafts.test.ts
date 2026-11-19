import { describe, expect, test } from "bun:test";

import {
  replyClosedCount,
  replyOutcomeCounts,
  replyOutcomes,
  type ReplyOutcome,
  type ReplyOutcomeCounts,
  type ReplyPairRow,
} from "./reply-drafts";

const pair = (status: string, reason: string | null = null): ReplyPairRow => ({ status, reason });
const zeros = (): ReplyOutcomeCounts => ({
  made: 0,
  sent_by_tap: 0,
  sent_by_user: 0,
  rejected: 0,
  expired: 0,
  newer_mail: 0,
  answered: 0,
  original_moved: 0,
  draft_changed: 0,
  no_draft: 0,
  failed: 0,
});
// The counts of one pair that ended in `name` (`made` is always 1).
const only = (name: ReplyOutcome): ReplyOutcomeCounts => ({ ...zeros(), made: 1, [name]: 1 });

describe("replyOutcomeCounts", () => {
  test("no rows give zero everywhere", () => {
    expect(replyOutcomeCounts({ pairs: [], requests: [] })).toEqual(zeros());
  });

  test("each end of a pair has its own count, and the pair is in made", () => {
    const table: [ReplyPairRow, (typeof replyOutcomes)[number]][] = [
      [pair("applied"), "sent_by_tap"],
      [pair("rejected"), "rejected"],
      [pair("failed"), "failed"],
      [pair("expired", "sent_by_user"), "sent_by_user"],
      [pair("expired", "newer_mail"), "newer_mail"],
      [pair("expired", "answered"), "answered"],
      [pair("expired", "original_moved"), "original_moved"],
      [pair("expired", "draft_changed"), "draft_changed"],
      // A copy that is gone from Drafts is a changed copy.
      [pair("expired", "draft_missing"), "draft_changed"],
      [pair("expired", "timeout"), "expired"],
      [pair("expired"), "expired"],
      [pair("expired", "held_timeout"), "expired"],
    ];
    for (const [row, name] of table) {
      expect({ row, counts: replyOutcomeCounts({ pairs: [row], requests: [] }) }).toEqual({ row, counts: only(name) });
    }
  });

  test("a pair that waits, or that a switch or a suspicious-mail check closed, is only in made", () => {
    for (const row of [
      pair("awaiting_approval"),
      pair("approved"),
      pair("applying"),
      pair("expired", "policy_changed"),
      pair("expired", "suspicious"),
      pair("expired", "something_new"),
      pair("undone"),
    ]) {
      expect({ row, counts: replyOutcomeCounts({ pairs: [row], requests: [] }) }).toEqual({
        row,
        counts: only("made"),
      });
    }
  });

  test("requests that ended with no draft or failed count apart from the pairs", () => {
    const counts = replyOutcomeCounts({
      pairs: [],
      requests: [{ status: "no_draft" }, { status: "no_draft" }, { status: "failed" }],
    });
    expect(counts).toMatchObject({ made: 0, no_draft: 2, failed: 1 });
  });

  test("the fixture of the week: 5 pairs, one redrafted once (one row per pair), one tap that sent, one rejected, one closed, one timeout", () => {
    const counts = replyOutcomeCounts({
      pairs: [
        pair("applied"),
        pair("rejected"),
        pair("expired", "newer_mail"),
        pair("applied"),
        pair("expired", "timeout"),
      ],
      requests: [],
    });
    expect(counts).toMatchObject({ made: 5, sent_by_tap: 2, rejected: 1, newer_mail: 1, expired: 1 });
  });
});

describe("replyClosedCount", () => {
  test("the sum of newer mail, answered, moved and changed, and nothing else", () => {
    const counts = {
      ...Object.fromEntries(replyOutcomes.map((key) => [key, 100])),
      newer_mail: 1,
      answered: 2,
      original_moved: 4,
      draft_changed: 8,
    } as Parameters<typeof replyClosedCount>[0];
    expect(replyClosedCount(counts)).toBe(15);
  });
});
