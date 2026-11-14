import { describe, expect, test } from "bun:test";

import { truthRow } from "./fixtures";
import { isImportant, isMiss, missedImportant, truthSourceOf } from "./m1";

describe("truthSourceOf", () => {
  test("groups the feedback sources", () => {
    expect(["cli", "telegram", "web", "undo"].map((s) => truthSourceOf(s as "cli"))).toEqual([
      "correction",
      "correction",
      "correction",
      "correction",
    ]);
    expect(truthSourceOf("review")).toBe("review");
    expect(truthSourceOf("imap_move")).toBe("moved_back");
    expect(truthSourceOf("answered_check")).toBe("answered_check");
  });
});

describe("missedImportant", () => {
  test("counts important mail, misses, their sources and the review sample", () => {
    const rows = [
      truthRow({ predicted: "info", truth: "urgent", truthSource: "correction" }),
      truthRow({ predicted: "needs_reply" }),
      truthRow({ predicted: "urgent" }),
      truthRow({ predicted: "info" }),
      truthRow({ predicted: "spam", truth: "needs_reply", truthSource: "moved_back" }),
      truthRow({ predicted: "urgent", truth: "needs_reply", truthSource: "review" }),
      truthRow({ predicted: "needs_reply", truth: "info", truthSource: "review" }),
      truthRow({ predicted: "delegation", truth: "needs_reply", truthSource: "correction" }),
      truthRow({ predicted: "unsure", truth: "urgent", truthSource: "answered_check" }),
      truthRow({ predicted: "notification", wrongOnly: true }),
    ];
    const result = missedImportant(rows);
    expect(result.important).toBe(7);
    expect(result.misses).toBe(3);
    expect(result.missesBySource).toEqual({ correction: 1, review: 0, moved_back: 1, answered_check: 1 });
    expect(result.sample.labelled).toBe(2);
    expect(result.sample.important).toBe(1);
    expect(result.sample.misses).toBe(0);
    expect(result.sample.missRateUpper).toBeCloseTo(0.7935, 3);
  });

  test("no rows gives zeros and no upper bound", () => {
    expect(missedImportant([])).toEqual({
      important: 0,
      misses: 0,
      missesBySource: { correction: 0, review: 0, moved_back: 0, answered_check: 0 },
      sample: { labelled: 0, important: 0, misses: 0, missRateUpper: null },
    });
  });

  test("a review-labelled miss counts in the sample and in its source", () => {
    const result = missedImportant([truthRow({ predicted: "info", truth: "needs_reply", truthSource: "review" })]);
    expect(result.missesBySource.review).toBe(1);
    expect(result.sample).toMatchObject({ labelled: 1, important: 1, misses: 1 });
    expect(result.sample.missRateUpper).toBe(1);
  });
});

describe("isImportant and isMiss", () => {
  test("a truth overrides the prediction", () => {
    expect(isImportant(truthRow({ predicted: "urgent", truth: "info", truthSource: "correction" }))).toBe(false);
  });

  test("an urgent prediction of a needs-reply truth is no miss", () => {
    expect(isMiss(truthRow({ predicted: "urgent", truth: "needs_reply", truthSource: "review" }))).toBe(false);
  });

  test("a mail without a truth is never a miss", () => {
    expect(isMiss(truthRow({ predicted: "spam" }))).toBe(false);
  });
});
