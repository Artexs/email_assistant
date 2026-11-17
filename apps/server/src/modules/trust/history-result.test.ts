import { describe, expect, test } from "bun:test";

import { historyResultOf, type ResultItem } from "./history-result";

const item = (category: ResultItem["category"], wouldMove: boolean, actedOn: boolean): ResultItem => ({
  category,
  wouldMove,
  actedOn,
});

describe("historyResultOf", () => {
  test("acted is shared, moved needs acted-on and would move, wouldMove counts all mail the category would move", () => {
    const items = [
      ...Array.from({ length: 60 }, () => item("needs_reply", false, true)),
      item("notification", true, true),
      item("notification", true, false),
      item("spam", true, false),
      item("urgent", false, false),
    ];
    const result = historyResultOf(items);
    expect(result.notification).toMatchObject({
      acted: 61,
      moved: 1,
      total: 64,
      wouldMove: 2,
      outcome: "inconclusive",
    });
    expect(result.spam).toMatchObject({ acted: 61, moved: 0, total: 64, wouldMove: 1 });
    expect(result.info).toMatchObject({ moved: 0, wouldMove: 0 });
  });

  test("two of sixty acted-on mails moved is a fail; under 50 acted-on is no_result with no bound", () => {
    const sixty = [
      ...Array.from({ length: 58 }, () => item("needs_reply", false, true)),
      item("info", true, true),
      item("info", true, true),
    ];
    expect(historyResultOf(sixty).info.outcome).toBe("fail");
    const few = historyResultOf(sixty.slice(0, 45));
    expect(few.info).toMatchObject({ outcome: "no_result", upper: null });
  });

  test("a mail that is not a moving category (unsure, urgent) counts in the total only", () => {
    const result = historyResultOf([item("unsure", true, true), item("urgent", true, true)]);
    expect(result.info).toMatchObject({ acted: 2, moved: 0, total: 2, wouldMove: 0 });
  });
});
