import { afterEach, describe, expect, test } from "bun:test";
import type { WeekStats } from "@ea/core/web";

import { en } from "../i18n/en";
import { setLocaleForTest } from "../i18n";
import { statsRows, weekLabel } from "./stats-view";

afterEach(() => setLocaleForTest("en"));

const MAILBOX = "00000000-0000-4000-8000-0000000000aa";
const OTHER_MAILBOX = "00000000-0000-4000-8000-0000000000bb";

function week(patch: Partial<WeekStats> = {}): WeekStats {
  return {
    weekStart: "2026-11-16",
    mailboxId: null,
    m1: {
      important: 5,
      misses: 1,
      missesBySource: { correction: 1, review: 0, moved_back: 0, answered_check: 0 },
      sample: { labelled: 1, important: 1, misses: 0, missRateUpper: 0.79 },
    },
    m2: { due: 2, closedOnTime: 1, surfacedOnTime: 2, pending: 0 },
    m3: {
      hiddenImportant: 2,
      wrongPerson: 1,
      wrongContent: 0,
      sentMistake: 1,
      total: 4,
      notNeeded: 0,
      noReason: 1,
    },
    m4: { triaged: 9, handled: 3, wouldHandle: 0 },
    m5: { urgent: 2, noticed: 1, withoutNotice: 1, quietHours: 1, p90Minutes: 3 },
    m7: {
      llmUsdWeek: 0.1,
      llmCalls: 10,
      unpricedCalls: 0,
      mailboxes: 1,
      hostingUsdMonth: 0,
      backupUsdMonth: 0,
      perMailboxMonthUsd: 0.4112,
      targetUsd: 5,
    },
    m8: [],
    ...patch,
  };
}

function cellOf(rows: ReturnType<typeof statsRows>, label: string, index = 0): string | undefined {
  return rows.find((row) => row.label === label)?.cells[index]?.text;
}

describe("statsRows", () => {
  test("one week gives the rate and its count in each cell", () => {
    const rows = statsRows([week()]);
    expect(cellOf(rows, "stats_m1")).toBe("20% (1 of 5)");
    expect(cellOf(rows, "stats_m1_sample")).toBe("0 of 1");
    expect(cellOf(rows, "stats_m2_closed")).toBe("50% (1 of 2)");
    expect(cellOf(rows, "stats_m3")).toBe("4");
    expect(cellOf(rows, "stats_m4")).toBe("33% (3 of 9)");
    expect(cellOf(rows, "stats_m4_would")).toBe("0% (0 of 9)");
    expect(cellOf(rows, "stats_m5")).toBe("3 min (1)");
    expect(cellOf(rows, "stats_m7")).toBe("$0.41");
  });

  test("a denominator of 0 or no value gives a dash", () => {
    const empty = week({
      m1: {
        ...week().m1,
        important: 0,
        misses: 0,
        sample: { labelled: 0, important: 0, misses: 0, missRateUpper: null },
      },
      m2: { due: 0, closedOnTime: 0, surfacedOnTime: 0, pending: 0 },
      m4: { triaged: 0, handled: 0, wouldHandle: 0 },
      m5: { urgent: 0, noticed: 0, withoutNotice: 0, quietHours: 0, p90Minutes: null },
    });
    const rows = statsRows([empty]);
    for (const label of [
      "stats_m1",
      "stats_m1_sample",
      "stats_m2_closed",
      "stats_m2_surfaced",
      "stats_m4",
      "stats_m5",
    ]) {
      expect(cellOf(rows, label)).toBe("–");
    }
    expect(cellOf(rows, "stats_m8_spam")).toBe("–");
  });

  test("two weeks give two cells per row, in the order of the answer", () => {
    const rows = statsRows([
      week({ weekStart: "2026-11-16" }),
      week({ weekStart: "2026-11-09", m3: { ...week().m3, total: 0 } }),
    ]);
    for (const row of rows) expect(row.cells).toHaveLength(2);
    expect(rows.find((row) => row.label === "stats_m3")?.cells.map((cell) => cell.text)).toEqual(["4", "0"]);
  });

  test("the evidence rows show the row with most kept mails and mark auto", () => {
    const gate = { recall: 0.9, decision: "go" as const };
    const rows = statsRows([
      week({
        m8: [
          { mailboxId: MAILBOX, category: "spam", auto: false, kept: 40, precision: 0.975, wilsonLower: 0.9, ...gate },
          {
            mailboxId: OTHER_MAILBOX,
            category: "spam",
            auto: true,
            kept: 120,
            precision: 0.99,
            wilsonLower: 0.97,
            ...gate,
          },
          {
            mailboxId: MAILBOX,
            category: "info",
            auto: false,
            kept: 0,
            precision: null,
            wilsonLower: null,
            recall: null,
            decision: "no-go: too few",
          },
        ],
      }),
    ]);
    expect(cellOf(rows, "stats_m8_spam")).toBe("99% of 120 (≥ 97%) · auto");
    expect(cellOf(rows, "stats_m8_info")).toBe("–");
    expect(cellOf(rows, "stats_m8_urgent")).toBe("–");
  });

  test("every row label is an English key and the rows are the same for every week count", () => {
    const rows = statsRows([week()]);
    expect(rows).toHaveLength(14);
    for (const row of rows) expect(Object.hasOwn(en, row.label)).toBe(true);
    expect(statsRows([])).toHaveLength(14);
  });

  test("the Polish cells keep the count and use the Polish connector", () => {
    setLocaleForTest("pl");
    expect(cellOf(statsRows([week()]), "stats_m1")).toBe("20% (1 z 5)");
  });
});

describe("weekLabel", () => {
  test("a Monday reads as day and month", () => {
    expect(weekLabel("2026-11-16")).toBe("16 Nov");
  });

  test("the Polish label uses the Polish month", () => {
    setLocaleForTest("pl");
    expect(weekLabel("2026-11-16")).toBe("16 lis");
  });
});
