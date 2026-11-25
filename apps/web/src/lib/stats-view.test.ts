import { afterEach, describe, expect, test } from "bun:test";
import { EVIDENCE_MIN_LABELS, type WeekStats } from "@ea/core/web";

import { en } from "../i18n/en";
import { setLocaleForTest } from "../i18n";
import type { TextKey } from "../i18n";
import { hasSplit, statsHead, statsRows, weekLabel, type StatsHead } from "./stats-view";

afterEach(() => setLocaleForTest("en"));

const MAILBOX = "00000000-0000-4000-8000-0000000000aa";
const OTHER_MAILBOX = "00000000-0000-4000-8000-0000000000bb";
// The three evidence keys: null with the flag `trust_ladder` off. The page does not show them yet.
const NO_TRUST = { global: null, history: null, trip: null } as const;

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
    replyDrafts: {
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

  test("Polish writes the cost and the minutes with a decimal comma", () => {
    setLocaleForTest("pl");
    const slow = week({ m5: { ...week().m5, p90Minutes: 2.5 } });
    const rows = statsRows([slow]);
    expect(cellOf(rows, "stats_m5")).toBe("2,5 min (1)");
    expect(cellOf(rows, "stats_m7")).toBe("0,41 USD");
  });

  test("the split rows show only with a split, one per kind, and the totals change their label", () => {
    const tally = (due: number, closed: number, surfaced: number) => ({
      due,
      closedOnTime: closed,
      surfacedOnTime: surfaced,
      pending: 0,
    });
    const none = tally(0, 0, 0);
    expect(statsRows([week()]).map((row) => row.label)).not.toContain("stats_m2_kind_waiting");
    const split = week({
      m2: {
        ...tally(3, 2, 3),
        byKind: { delegation: none, waiting: tally(3, 2, 3), promised: none, delegated: none },
      },
    });
    const rows = statsRows([split, week()]);
    const labels = rows.map((row) => row.label);
    expect(labels).not.toContain("stats_m2_closed");
    expect(labels.slice(labels.indexOf("stats_m2_loops_closed"), labels.indexOf("stats_m3"))).toEqual([
      "stats_m2_loops_closed",
      "stats_m2_loops_surfaced",
      "stats_m2_kind_delegation",
      "stats_m2_kind_waiting",
      "stats_m2_kind_promised",
      "stats_m2_kind_delegated",
    ]);
    expect(cellOf(rows, "stats_m2_kind_waiting")).toBe("67% (2 of 3) closed · 100% (3 of 3) surfaced");
    expect(cellOf(rows, "stats_m2_kind_promised")).toBe("–");
    expect(cellOf(rows, "stats_m2_kind_waiting", 1)).toBe("–");
    for (const row of rows) expect(Object.hasOwn(en, row.label)).toBe(true);
    setLocaleForTest("pl");
    expect(cellOf(statsRows([split]), "stats_m2_kind_waiting")).toBe(
      "67 % (2 z 3) zamkniętych · 100 % (3 z 3) pokazanych"
    );
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
    const gate = { ...NO_TRUST, recall: 0.9, decision: "go" as const };
    const rows = statsRows([
      week({
        replyDrafts: {
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
        },
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
            ...NO_TRUST,
          },
        ],
      }),
    ]);
    expect(cellOf(rows, "stats_m8_spam")).toBe("99% of 120 (≥ 97%) · auto");
    expect(cellOf(rows, "stats_m8_info")).toBe("–");
    expect(cellOf(rows, "stats_m8_urgent")).toBe("–");
  });

  test("the evidence hides precision below 30 labels and shows it from 30", () => {
    const gate = {
      ...NO_TRUST,
      recall: 0.9,
      decision: "go" as const,
      auto: false,
      mailboxId: MAILBOX,
      category: "spam" as const,
    };
    const few = statsRows([week({ m8: [{ ...gate, kept: 3, precision: 1, wilsonLower: 0.44 }] })]);
    expect(cellOf(few, "stats_m8_spam")).toBe("3 of 30 rated mails needed");
    expect(cellOf(few, "stats_m8_spam")).not.toContain("%");
    const justBelow = statsRows([week({ m8: [{ ...gate, kept: 29, precision: 1, wilsonLower: 0.88 }] })]);
    expect(cellOf(justBelow, "stats_m8_spam")).toBe("29 of 30 rated mails needed");
    const shown = statsRows([week({ m8: [{ ...gate, kept: 30, precision: 0.97, wilsonLower: 0.83 }] })]);
    expect(cellOf(shown, "stats_m8_spam")).toBe("97% of 30 (≥ 83%)");
  });

  test("below 30 labels a category on auto keeps its auto mark", () => {
    const gate = { ...NO_TRUST, recall: 0.9, decision: "go" as const, mailboxId: MAILBOX, category: "spam" as const };
    const few = statsRows([week({ m8: [{ ...gate, auto: true, kept: 29, precision: 1, wilsonLower: 0.88 }] })]);
    expect(cellOf(few, "stats_m8_spam")).toBe("29 of 30 rated mails needed · auto");
    const notAuto = statsRows([week({ m8: [{ ...gate, auto: false, kept: 29, precision: 1, wilsonLower: 0.88 }] })]);
    expect(cellOf(notAuto, "stats_m8_spam")).toBe("29 of 30 rated mails needed");
  });

  test("a category with no labels shows a dash, auto or not", () => {
    const gate = {
      ...NO_TRUST,
      recall: null,
      decision: "no-go: too few" as const,
      mailboxId: MAILBOX,
      category: "spam" as const,
    };
    const none = statsRows([week({ m8: [{ ...gate, auto: true, kept: 0, precision: null, wilsonLower: null }] })]);
    expect(cellOf(none, "stats_m8_spam")).toBe("–");
  });

  test("the label minimum is the one of the metrics", () => {
    expect(EVIDENCE_MIN_LABELS).toBe(30);
  });

  test("every row label is an English key and the rows are the same for every week count", () => {
    const rows = statsRows([week()]);
    expect(rows).toHaveLength(14);
    for (const row of rows) expect(Object.hasOwn(en, row.label)).toBe(true);
    expect(statsRows([])).toHaveLength(14);
  });

  test("the Polish cells keep the count and use the Polish connector", () => {
    setLocaleForTest("pl");
    expect(cellOf(statsRows([week()]), "stats_m1")).toBe("20 % (1 z 5)");
    const gate = {
      ...NO_TRUST,
      recall: 0.9,
      decision: "go" as const,
      auto: true,
      mailboxId: MAILBOX,
      category: "spam" as const,
    };
    const few = statsRows([week({ m8: [{ ...gate, kept: 3, precision: 1, wilsonLower: 0.44 }] })]);
    expect(cellOf(few, "stats_m8_spam")).toBe("3 z 30 potrzebnych ocenionych wiadomości · automat");
    const shown = statsRows([week({ m8: [{ ...gate, kept: 30, precision: 0.97, wilsonLower: 0.83 }] })]);
    expect(cellOf(shown, "stats_m8_spam")).toBe("97 % z 30 (≥ 83 %) · automat");
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

const ZERO_TALLY = { due: 0, closedOnTime: 0, surfacedOnTime: 0, pending: 0 };

describe("statsHead", () => {
  const rows: {
    name: string;
    patch: Partial<WeekStats>;
    split: boolean;
    ring: StatsHead["ring"];
    tiles: string[];
    thirdLabel: TextKey;
  }[] = [
    {
      name: "a handled share",
      patch: { m4: { triaged: 200, handled: 150, wouldHandle: 0 } },
      split: false,
      ring: { value: 150, max: 200, percent: "75%", label: "stats_m4" },
      tiles: ["4", "3 min", "50%"],
      thirdLabel: "stats_m2_closed",
    },
    {
      name: "a shadow week shows the would-handle share",
      patch: { m4: { triaged: 200, handled: 0, wouldHandle: 120 } },
      split: false,
      ring: { value: 120, max: 200, percent: "60%", label: "stats_m4_would" },
      tiles: ["4", "3 min", "50%"],
      thirdLabel: "stats_m2_closed",
    },
    {
      name: "no triaged mail gives an empty ring and a dash",
      patch: { m4: { triaged: 0, handled: 0, wouldHandle: 0 } },
      split: false,
      ring: { value: 0, max: 0, percent: "–", label: "stats_m4" },
      tiles: ["4", "3 min", "50%"],
      thirdLabel: "stats_m2_closed",
    },
    {
      name: "no p90, no due loop and no mistake give 0 and two dashes",
      patch: {
        m3: { ...week().m3, total: 0 },
        m5: { ...week().m5, p90Minutes: null },
        m2: { ...ZERO_TALLY },
      },
      split: false,
      ring: { value: 3, max: 9, percent: "33%", label: "stats_m4" },
      tiles: ["0", "–", "–"],
      thirdLabel: "stats_m2_closed",
    },
    {
      name: "a split week uses the loops label and trims the p90 to one decimal",
      patch: {
        m3: { ...week().m3, total: 2 },
        m5: { ...week().m5, p90Minutes: 12.4 },
        m2: { due: 4, closedOnTime: 3, surfacedOnTime: 4, pending: 0 },
      },
      split: true,
      ring: { value: 3, max: 9, percent: "33%", label: "stats_m4" },
      tiles: ["2", "12.4 min", "75%"],
      thirdLabel: "stats_m2_loops_closed",
    },
  ];

  test.each(rows)("$name", ({ patch, split, ring, tiles, thirdLabel }) => {
    const head = statsHead(week(patch), split);
    expect(head.ring).toEqual(ring);
    expect(head.tiles.map((tile) => tile.value)).toEqual(tiles);
    expect(head.tiles.map((tile) => tile.label)).toEqual(["stats_m3", "stats_m5", thirdLabel]);
  });

  test.each(rows)("$name: the ring percent is the percent of the table cell", ({ patch, ring }) => {
    const source = week(patch);
    const cell = cellOf(statsRows([source]), ring.label) ?? "";
    expect(ring.percent === "–" ? cell : cell.split(" ")[0]).toBe(ring.percent);
  });

  test("Polish writes the percent with a space and the minutes with a comma", () => {
    setLocaleForTest("pl");
    const head = statsHead(week({ m5: { ...week().m5, p90Minutes: 2.5 } }), false);
    expect(head.ring.percent).toBe("33 %");
    expect(head.tiles[1]?.value).toBe("2,5 min");
  });

  test("hasSplit is true when any week holds the split", () => {
    const split = week({
      m2: {
        ...ZERO_TALLY,
        byKind: { delegation: ZERO_TALLY, waiting: ZERO_TALLY, promised: ZERO_TALLY, delegated: ZERO_TALLY },
      },
    });
    expect([hasSplit([week()]), hasSplit([week(), split])]).toEqual([false, true]);
  });
});
