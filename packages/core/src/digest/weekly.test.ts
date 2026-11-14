import { describe, expect, test } from "bun:test";

import { weekStatsExample } from "../metrics/fixtures";
import { textTables } from "../texts";
import type { WeekStats } from "../web/stats";

import { rateText, renderWeeklyReport } from "./weekly";

const timeZone = "Europe/Warsaw";
const en = textTables.en;
const pl = textTables.pl;

const EMPTY: Partial<WeekStats> = {
  m1: {
    important: 0,
    misses: 0,
    missesBySource: { correction: 0, review: 0, moved_back: 0, answered_check: 0 },
    sample: { labelled: 0, important: 0, misses: 0, missRateUpper: null },
  },
  m2: { due: 0, closedOnTime: 0, surfacedOnTime: 0, pending: 0 },
  m3: { hiddenImportant: 0, wrongPerson: 0, wrongContent: 0, sentMistake: 0, total: 0, notNeeded: 0, noReason: 0 },
  m4: { triaged: 0, handled: 0, wouldHandle: 0 },
  m5: { urgent: 0, noticed: 0, withoutNotice: 0, quietHours: 0, p90Minutes: null },
  m8: [],
};

describe("rateText", () => {
  test("3. no base prints a dash; else the rounded percent and both numbers", () => {
    expect(rateText(0, 0)).toBe("– (0 of 0)");
    expect(rateText(1, 3)).toBe("33% (1 of 3)");
    expect(rateText(124, 200, "z")).toBe("62% (124 z 200)");
  });
});

describe("renderWeeklyReport", () => {
  test("1. a full week prints every line, with no button", () => {
    const message = renderWeeklyReport({ week: weekStatsExample(), timeZone, answeredWaiting: 2 }, en);
    expect(message.text).toBe(
      [
        "📈 Week Mon 16 Nov – Sun 22 Nov",
        "Missed important mail (lower bound): 20% (1 of 5)",
        "Random review sample: 0 missed of 1",
        "Open loops on time: 50% closed (1 of 2), 100% surfaced (2 of 2)",
        "Serious mistakes: 4 (hidden important 2, wrong person 1, wrong content 0, sent by mistake 1)",
        "Handled for you: 33% (3 of 9)",
        "Urgent notice time: p90 3 min (1 notice, 1 without a notice)",
        "Cost: $0.41 per mailbox per month (target ≤ $5)",
        "Auto: notification 97% of 41 labels (lower bound 87%)",
        "/review: 2 replied mails wait for a check.",
      ].join("\n")
    );
    expect(message.buttons).toEqual([]);
  });

  test("2. an empty week says so and prints the none-lines; no review line", () => {
    const week = weekStatsExample(EMPTY);
    const lines = renderWeeklyReport({ week, timeZone, answeredWaiting: 0 }, en).text.split("\n");
    expect(lines).toContain("No mail this week.");
    expect(lines).toContain("Open loops on time: no delegation was due");
    expect(lines).toContain("Urgent notice time: no urgent mail");
    expect(lines).toContain("Auto: no category on auto");
    expect(lines).toContain("Handled for you: – (0 of 0)");
    expect(lines.some((line) => line.startsWith("/review"))).toBe(false);
    expect(lines.some((line) => line.startsWith("Missed important mail"))).toBe(false);
  });

  test("shadow mode, pending loops, unpriced calls, few labels, several auto rows, one call", () => {
    const base = weekStatsExample();
    const row = base.m8[3];
    if (row === undefined) throw new Error("fixture");
    const week = weekStatsExample({
      m1: { ...base.m1, sample: { ...base.m1.sample, labelled: 0 } },
      m2: { due: 3, closedOnTime: 0, surfacedOnTime: 3, pending: 2 },
      m4: { triaged: 8, handled: 0, wouldHandle: 2 },
      m5: { urgent: 1, noticed: 0, withoutNotice: 1, quietHours: 0, p90Minutes: null },
      m7: { ...base.m7, unpricedCalls: 1 },
      m8: [
        { ...row, category: "spam", auto: true, kept: 12, precision: 0.9, wilsonLower: 0.6 },
        { ...row, category: "info", auto: true, kept: 30, precision: 0.5, wilsonLower: 0.33 },
        { ...row, mailboxId: "00000000-0000-4000-8000-000000000002", kept: 50, precision: 0.8, wilsonLower: 0.7 },
      ],
    });
    const text = renderWeeklyReport({ week, timeZone, answeredWaiting: 1 }, en).text;
    expect(text).not.toContain("Random review sample");
    expect(text).toContain("Open loops on time: 0% closed (0 of 3), 100% surfaced (3 of 3), 2 still open");
    expect(text).toContain("Would handle (shadow mode): 25% (2 of 8)");
    expect(text).toContain("Urgent notice time: p90 – (0 notices, 1 without a notice)");
    expect(text).toContain("1 call without a price");
    // `barCategories` order; the row with the most kept labels stands for the category.
    expect(text).toContain(
      "Auto: info 50% of 30 labels (lower bound 33%); notification 80% of 50 labels (lower bound 70%); spam fewer than 30 labels (12)"
    );
    expect(text).toContain("/review: 1 replied mail waits for a check.");
  });

  test("Polish: every line has one colon at most, and counts follow the plural form", () => {
    const week = weekStatsExample({ m7: { ...weekStatsExample().m7, unpricedCalls: 5 } });
    const text = renderWeeklyReport({ week, timeZone, answeredWaiting: 2 }, pl).text;
    for (const line of text.split("\n")) expect(line.split(":").length - 1).toBeLessThanOrEqual(1);
    expect(text.split("\n")[0]).toBe("📈 Tydzień pon. 16 lis – niedz. 22 lis");
    expect(text).toContain("2 wiadomości z odpowiedzią czekają na sprawdzenie");
    expect(text).toContain("1 powiadomienie, 1 bez powiadomienia");
    expect(text).toContain("5 wywołań bez ceny");
    expect(text).toContain("50% zamkniętych (1 z 2)");
    const one = renderWeeklyReport({ week, timeZone, answeredWaiting: 1 }, pl).text;
    expect(one).toContain("1 wiadomość z odpowiedzią czeka na sprawdzenie");
    const many = renderWeeklyReport({ week, timeZone, answeredWaiting: 5 }, pl).text;
    expect(many).toContain("5 wiadomości z odpowiedzią czeka na sprawdzenie");
  });

  test("a week with no mail in Polish prints the Polish none-lines", () => {
    const text = renderWeeklyReport({ week: weekStatsExample(EMPTY), timeZone, answeredWaiting: 0 }, pl).text;
    expect(text).toContain("W tym tygodniu nie było poczty.");
    expect(text).toContain("Automat: żadna kategoria nie działa sama");
  });

  test("Polish: the review sample follows the plural form of the missed count", () => {
    const sample = (missed: number): string => {
      const base = weekStatsExample();
      const week = weekStatsExample({
        m1: { ...base.m1, sample: { labelled: 9, important: 40, misses: missed, missRateUpper: null } },
      });
      return renderWeeklyReport({ week, timeZone, answeredWaiting: 0 }, pl).text;
    };
    expect(sample(1)).toContain("Losowa próba z /review: 1 pominięta z 40");
    expect(sample(2)).toContain("2 pominięte z 40");
    expect(sample(5)).toContain("5 pominiętych z 40");
    expect(sample(12)).toContain("12 pominiętych z 40");
    expect(sample(22)).toContain("22 pominięte z 40");
  });

  test("Polish: the auto line puts the genitive plural after z", () => {
    const base = weekStatsExample();
    const auto = (kept: number): string => {
      const week = weekStatsExample({
        m8: base.m8.map((row) => (row.category === "notification" ? { ...row, kept } : row)),
      });
      return renderWeeklyReport({ week, timeZone, answeredWaiting: 0 }, pl).text;
    };
    expect(auto(32)).toContain("97% z 32 etykiet (dolna granica 87%)");
    expect(auto(52)).toContain("97% z 52 etykiet");
    expect(auto(41)).toContain("97% z 41 etykiet");
    expect(auto(30)).toContain("97% z 30 etykiet");
    expect(auto(12)).toContain("mniej niż 30 etykiet (12)");
    expect(textTables.pl.notices.weekly.autoEnough("x", 97, 1)).toBe("x 97% z 1 etykiety");
  });

  test("Polish decimals use a comma; English keeps the point", () => {
    const base = weekStatsExample();
    const week = weekStatsExample({ m5: { ...base.m5, p90Minutes: 2.5 } });
    const polish = renderWeeklyReport({ week, timeZone, answeredWaiting: 0 }, pl).text;
    expect(polish).toContain("p90 2,5 min");
    expect(polish).toContain("$0,41 miesięcznie");
    const english = renderWeeklyReport({ week, timeZone, answeredWaiting: 0 }, en).text;
    expect(english).toContain("p90 2.5 min");
    expect(english).toContain("$0.41 per mailbox");
  });
});
