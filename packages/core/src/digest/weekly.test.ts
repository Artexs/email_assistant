import { describe, expect, test } from "bun:test";

import { weekStatsExample } from "../metrics/fixtures";
import { noticeViewSchemas } from "../notices/views";
import { textTables } from "../texts";
import { barCategories } from "../triage/metrics";
import type { WeekStats } from "../web/stats";

import { MESSAGE_MAX_CHARS } from "./message";
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

// The evidence lines of `auto`.
describe("the evidence lines of the weekly report", () => {
  const MAILBOXES = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
  type Row = WeekStats["m8"][number];
  const on = (mailboxId: string, category: Row["category"], patch: Partial<Row> = {}): Row => ({
    mailboxId,
    category,
    auto: true,
    kept: 40,
    precision: 0.97,
    recall: 0.9,
    wilsonLower: 0.9,
    decision: "go",
    global: { decision: "go", provisional: false, wilsonLower: 0.9, cases: 120 },
    history: { outcome: "pass", acted: 80, moved: 1 },
    trip: { tripped: false, reason: null },
    ...patch,
  });
  const allKeys = (): WeekStats =>
    weekStatsExample({ m8: MAILBOXES.flatMap((id) => barCategories.map((category) => on(id, category))) });
  const textOf = (week: WeekStats, texts: typeof en): string =>
    renderWeeklyReport({ week, timeZone, answeredWaiting: 0 }, texts).text;
  const evidenceLines = (text: string, marker: string): string[] =>
    text.split("\n").filter((line) => line.includes(marker));

  test("4. all keys set, 5 categories and 3 mailboxes: one line per category, the message fits 4096", () => {
    const english = textOf(allKeys(), en);
    expect(evidenceLines(english, "· proof")).toEqual([
      "urgent: auto on · proof go · check pass",
      "reply: auto on · proof go · check pass",
      "info: auto on · proof go · check pass",
      "notification: auto on · proof go · check pass",
      "spam: auto on · proof go · check pass",
    ]);
    const polish = textOf(allKeys(), pl);
    expect(evidenceLines(polish, "· dowód")).toHaveLength(5);
    expect(evidenceLines(polish, "· dowód")[0]).toBe("pilne: automat włączony · dowód go · sprawdzenie zaliczone");
    // Polish: one colon at most per line.
    for (const line of polish.split("\n")) expect(line.split(":").length - 1).toBeLessThanOrEqual(1);
    for (const text of [english, polish]) expect(text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
  });

  test("4. proof and check phrases follow the row; a trip reads paused with its reason phrase", () => {
    const week = weekStatsExample({
      m8: [
        on(MAILBOXES[0] as string, "info", {
          global: { decision: "no-go", provisional: true, wilsonLower: 0.5, cases: 10 },
          history: null,
        }),
        on(MAILBOXES[0] as string, "spam", { history: { outcome: "inconclusive", acted: 60, moved: 2 } }),
        // A tripped category has `auto` off; the trip of any mailbox decides the line of the category.
        on(MAILBOXES[0] as string, "notification", { auto: false, trip: { tripped: true, reason: "corrections" } }),
        on(MAILBOXES[1] as string, "notification"),
        // `auto` off and no trip: no line.
        on(MAILBOXES[0] as string, "urgent", { auto: false }),
      ],
    });
    expect(evidenceLines(textOf(week, en), "· proof").concat(evidenceLines(textOf(week, en), "paused"))).toEqual([
      "info: auto on · proof no-go · check none",
      "spam: auto on · proof go · check inconclusive",
      "notification: paused (you corrected its moves)",
    ]);
    expect(evidenceLines(textOf(week, pl), "wstrzymane")).toEqual([
      "powiadomienia: wstrzymane (poprawiono jego ruchy)",
    ]);
  });

  test("5. keys null: no evidence line, in en and pl", () => {
    const week = weekStatsExample();
    for (const texts of [en, pl]) {
      const text = textOf(week, texts);
      expect(text).not.toContain("· proof");
      expect(text).not.toContain("· dowód");
      expect(text).not.toContain("paused");
      expect(text).not.toContain("wstrzymane");
    }
    // The text of test 1 (full week, null keys), with no review line.
    expect(textOf(week, en)).toBe(
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
      ].join("\n")
    );
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

  describe("the loops line (F116 stage 23)", () => {
    const tally = (due: number, closed: number, surfaced: number) => ({
      due,
      closedOnTime: closed,
      surfacedOnTime: surfaced,
      pending: 0,
    });
    const withLoops = (byKind: NonNullable<WeekStats["m2"]["byKind"]>): WeekStats =>
      weekStatsExample({ m2: { due: 2, closedOnTime: 1, surfacedOnTime: 2, pending: 0, byKind } });
    const none = tally(0, 0, 0);
    const lines = (week: WeekStats, texts: typeof en): string[] =>
      renderWeeklyReport({ week, timeZone, answeredWaiting: 0 }, texts).text.split("\n");

    test("it follows the loops line and sums the three kinds of loop, not the delegations", () => {
      const week = withLoops({
        delegation: tally(1, 1, 1),
        waiting: tally(2, 1, 2),
        promised: none,
        delegated: tally(1, 0, 1),
      });
      const result = lines(week, en);
      const at = result.indexOf("Open loops on time: 50% closed (1 of 2), 100% surfaced (2 of 2)");
      expect(result[at + 1]).toBe("Of which loops: 33% closed (1 of 3), 100% surfaced (3 of 3)");
    });

    test("Polish text", () => {
      const week = withLoops({ delegation: none, waiting: tally(2, 1, 2), promised: tally(1, 1, 1), delegated: none });
      expect(lines(week, pl)).toContain("W tym otwarte sprawy: 67% zamkniętych (2 z 3), 100% zgłoszonych Ci (3 z 3)");
    });

    test("no line without a split, or when no loop was due", () => {
      expect(lines(weekStatsExample(), en).some((line) => line.startsWith("Of which loops"))).toBe(false);
      const quiet = withLoops({ delegation: tally(2, 1, 2), waiting: none, promised: none, delegated: none });
      expect(lines(quiet, en).some((line) => line.startsWith("Of which loops"))).toBe(false);
    });
  });
});

// The line of the open rule suggestions (flag `sender_suggestions`): a count and a link, or a fixed phrase.
describe("the suggestion line of the weekly report", () => {
  const lineOf = (suggestions: { open: number; panelUrl?: string } | undefined, texts: typeof en): string[] =>
    renderWeeklyReport({ week: weekStatsExample(), timeZone, answeredWaiting: 0, suggestions }, texts)
      .text.split("\n")
      .filter((line) => line.startsWith("💡"));
  const link = "https://panel.example.test/rules";

  test("English: one line with the count and the link; the verb follows the plural form", () => {
    expect(lineOf({ open: 2, panelUrl: link }, en)).toEqual([`💡 2 rule suggestions wait for you · ${link}`]);
    expect(lineOf({ open: 1, panelUrl: link }, en)).toEqual([`💡 1 rule suggestion waits for you · ${link}`]);
    expect(lineOf({ open: 5 }, en)).toEqual(["💡 5 rule suggestions wait for you · check them in the panel"]);
    expect(lineOf({ open: 1 }, en)).toEqual(["💡 1 rule suggestion waits for you · check it in the panel"]);
  });

  test("Polish: the count follows a colon, so no noun takes a plural form", () => {
    for (const open of [1, 2, 5, 22]) {
      expect(lineOf({ open, panelUrl: link }, pl)).toEqual([`💡 Sugestie reguł do przejrzenia: ${open} · ${link}`]);
    }
    expect(lineOf({ open: 3 }, pl)).toEqual(["💡 Sugestie reguł do przejrzenia: 3 · sprawdź w panelu"]);
  });

  test("0 open rows, and a view with no key, print no line", () => {
    expect(lineOf({ open: 0, panelUrl: link }, en)).toEqual([]);
    expect(lineOf(undefined, en)).toEqual([]);
    expect(lineOf(undefined, pl)).toEqual([]);
  });

  test("a view queued before the key (no `suggestions`) still parses and renders; a bad link or an extra key does not parse", () => {
    const view = { week: weekStatsExample(), timeZone, answeredWaiting: 0 };
    const schema = noticeViewSchemas.weekly_report;
    expect(schema.safeParse(view).success).toBe(true);
    expect(schema.safeParse({ ...view, suggestions: { open: 2, panelUrl: link } }).success).toBe(true);
    expect(schema.safeParse({ ...view, suggestions: { open: 2, panelUrl: "javascript:alert(1)" } }).success).toBe(
      false
    );
    expect(schema.safeParse({ ...view, suggestions: { open: 2, address: "a@acme.pl" } }).success).toBe(false);
  });
});

// The line of the reply drafts of the week: shown only when a draft was made; "closed" is the sum of the four closes of a changed mail.
describe("the reply draft line of the weekly report", () => {
  const counts = {
    made: 9,
    sent_by_tap: 3,
    sent_by_user: 1,
    rejected: 2,
    expired: 1,
    newer_mail: 1,
    answered: 2,
    original_moved: 3,
    draft_changed: 4,
    no_draft: 7,
    failed: 6,
  };
  const lineOf = (replyDrafts: WeekStats["replyDrafts"], texts: typeof en): string[] =>
    renderWeeklyReport({ week: weekStatsExample({ replyDrafts }), timeZone, answeredWaiting: 0 }, texts)
      .text.split("\n")
      .filter((line) => line.startsWith("✍️"));

  test("English: the six figures, and closed is newer mail + answered + moved + changed", () => {
    expect(lineOf(counts, en)).toEqual([
      "✍️ Reply drafts: 9 made · 3 sent by tap · 1 sent by you · 2 rejected · 1 expired · 10 closed",
    ]);
  });

  test("Polish: the labels are plural participles that stay the same for every number", () => {
    expect(lineOf(counts, pl)).toEqual([
      "✍️ Szkice odpowiedzi: przygotowane 9 · wysłane po zatwierdzeniu 3 · wysłane z programu pocztowego 1 · odrzucone 2 · wygasłe 1 · zamknięte 10",
    ]);
    for (const made of [1, 2, 5, 22]) {
      expect(lineOf({ ...counts, made }, pl)[0]).toContain(`przygotowane ${made} ·`);
    }
  });

  test("the line is hidden when no draft was made, even when other counts are set", () => {
    expect(lineOf({ ...counts, made: 0 }, en)).toEqual([]);
    expect(lineOf({ ...counts, made: 0 }, pl)).toEqual([]);
    expect(lineOf(weekStatsExample().replyDrafts, en)).toEqual([]);
  });

  test("the suggestion line and the reply draft line stand together", () => {
    const text = renderWeeklyReport(
      { week: weekStatsExample({ replyDrafts: counts }), timeZone, answeredWaiting: 0, suggestions: { open: 2 } },
      en
    ).text;
    expect(text).toContain("💡 2 rule suggestions wait for you");
    expect(text).toContain("✍️ Reply drafts: 9 made");
  });

  test("a view queued before the key has no `replyDrafts` and still parses with all zero", () => {
    const old: Partial<WeekStats> = weekStatsExample();
    delete old.replyDrafts;
    const parsed = noticeViewSchemas.weekly_report.safeParse({ week: old, timeZone, answeredWaiting: 0 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.week.replyDrafts.made).toBe(0);
    expect(
      noticeViewSchemas.weekly_report.safeParse({
        week: { ...old, replyDrafts: { ...counts, extra: 1 } },
        timeZone,
        answeredWaiting: 0,
      }).success
    ).toBe(false);
  });
});

describe("the mail line and the auto items of the weekly report", () => {
  type Row = WeekStats["m8"][number];
  const mailbox = "00000000-0000-4000-8000-000000000001";
  const row = (category: Row["category"], patch: Partial<Row> = {}): Row => ({
    mailboxId: mailbox,
    category,
    auto: true,
    kept: 40,
    precision: 0.97,
    recall: 0.9,
    wilsonLower: 0.9,
    decision: "go",
    global: null,
    history: null,
    trip: null,
    ...patch,
  });
  const linesOf = (patch: Partial<WeekStats>): string[] =>
    renderWeeklyReport({ week: weekStatsExample({ ...EMPTY, ...patch }), timeZone, answeredWaiting: 0 }, en).text.split(
      "\n"
    );
  const autoLine = (rows: Row[]): string | undefined => linesOf({ m8: rows }).find((line) => line.startsWith("Auto:"));
  const mail = (important: number, triaged: number, labelled = 0): Partial<WeekStats> => {
    const base = weekStatsExample();
    return {
      m1: {
        ...base.m1,
        important,
        misses: important === 0 ? 0 : 1,
        sample: { ...base.m1.sample, labelled, important: 1, misses: 0 },
      },
      m4: { ...base.m4, triaged },
    };
  };

  test.each([
    ["no important mail and nothing triaged", 0, 0, ["No mail this week."]],
    ["no important mail but mail triaged", 0, 5, ["Missed important mail (lower bound): – (0 of 0)"]],
    ["important mail and nothing triaged", 3, 0, ["Missed important mail (lower bound): 33% (1 of 3)"]],
  ])("the mail line: %s", (_name, important, triaged, expected) => {
    const lines = linesOf(mail(important, triaged));
    expect(lines.slice(1, 1 + expected.length)).toEqual(expected);
    expect(lines.includes("No mail this week.")).toBe(important === 0 && triaged === 0);
  });

  test.each([
    ["nothing handled and some mail would be", 0, 2, ["Would handle (shadow mode): 25% (2 of 8)"]],
    ["nothing handled and none would be", 0, 0, []],
    ["some mail handled and some would be", 3, 2, []],
  ])("the shadow mode line: %s", (_name, handled, wouldHandle, expected) => {
    const lines = linesOf({ m4: { triaged: 8, handled, wouldHandle } });
    expect(lines.filter((line) => line.startsWith("Would handle"))).toEqual(expected);
  });

  test("the review sample line shows from one labelled mail", () => {
    expect(linesOf(mail(3, 3, 0))).not.toContain("Random review sample: 0 missed of 1");
    expect(linesOf(mail(3, 3, 1))[2]).toBe("Random review sample: 0 missed of 1");
  });

  test.each([
    ["a category with no auto row has no item", [row("spam", { auto: false })], undefined],
    ["29 kept labels: too few", [row("spam", { kept: 29 })], "Auto: spam fewer than 30 labels (29)"],
    [
      "30 kept labels and no precision: too few",
      [row("spam", { kept: 30, precision: null })],
      "Auto: spam fewer than 30 labels (30)",
    ],
    [
      "30 kept labels, a precision and no lower bound: no suffix",
      [row("spam", { kept: 30, wilsonLower: null })],
      "Auto: spam 97% of 30 labels",
    ],
    [
      "30 kept labels, a precision and a lower bound: the suffix",
      [row("spam", { kept: 30, wilsonLower: 0.874 })],
      "Auto: spam 97% of 30 labels (lower bound 87%)",
    ],
  ])("auto item: %s", (_name, rows, expected) => {
    expect(autoLine(rows)).toBe(expected ?? "Auto: no category on auto");
  });

  test("with two auto rows of one category the row with more kept labels stands; a tie keeps the first", () => {
    expect(autoLine([row("spam", { kept: 35, precision: 0.8 }), row("spam", { kept: 40, precision: 0.9 })])).toBe(
      "Auto: spam 90% of 40 labels (lower bound 90%)"
    );
    expect(autoLine([row("spam", { kept: 40, precision: 0.9 }), row("spam", { kept: 35, precision: 0.8 })])).toBe(
      "Auto: spam 90% of 40 labels (lower bound 90%)"
    );
    expect(autoLine([row("spam", { kept: 40, precision: 0.8 }), row("spam", { kept: 40, precision: 0.9 })])).toBe(
      "Auto: spam 80% of 40 labels (lower bound 90%)"
    );
  });
});

describe("the evidence items of the weekly report", () => {
  type Row = WeekStats["m8"][number];
  const mailbox = "00000000-0000-4000-8000-000000000001";
  const row = (category: Row["category"], patch: Partial<Row> = {}): Row => ({
    mailboxId: mailbox,
    category,
    auto: true,
    kept: 40,
    precision: 0.97,
    recall: 0.9,
    wilsonLower: 0.9,
    decision: "go",
    global: { decision: "go", provisional: false, wilsonLower: 0.9, cases: 120 },
    history: { outcome: "pass", acted: 80, moved: 1 },
    trip: { tripped: false, reason: null },
    ...patch,
  });
  const evidence = (rows: Row[]): string[] =>
    renderWeeklyReport({ week: weekStatsExample({ ...EMPTY, m8: rows }), timeZone, answeredWaiting: 0 }, en)
      .text.split("\n")
      .filter((line) => line.startsWith("spam:"));

  test("a tripped row with a reason reads paused and gives no auto-on line; without a reason it does not", () => {
    expect(evidence([row("spam", { trip: { tripped: true, reason: "corrections" } })])).toEqual([
      "spam: paused (you corrected its moves)",
    ]);
    expect(evidence([row("spam", { trip: { tripped: true, reason: null } })])).toEqual([
      "spam: auto on · proof go · check pass",
    ]);
  });

  test("a trip that is not tripped does not pause the category, whatever its reason", () => {
    expect(evidence([row("spam", { trip: { tripped: false, reason: "corrections" } })])).toEqual([
      "spam: auto on · proof go · check pass",
    ]);
  });

  test("with several auto rows the row with the most kept labels gives the proof and the check; a tie keeps the first", () => {
    const none = { decision: "none" as const, provisional: false, wilsonLower: null, cases: 0 };
    const rows = [row("spam", { kept: 35, global: none }), row("spam", { kept: 40, history: null })];
    expect(evidence(rows)).toEqual(["spam: auto on · proof go · check none"]);
    expect(evidence([...rows].reverse())).toEqual(["spam: auto on · proof go · check none"]);
    expect(evidence([row("spam", { kept: 40, global: none }), row("spam", { kept: 40 })])).toEqual([
      "spam: auto on · proof none · check pass",
    ]);
  });

  test("a row with no global proof adds no line", () => {
    expect(evidence([row("spam", { global: null })])).toEqual([]);
  });

  test.each([
    ["go", "proof go"],
    ["none", "proof none"],
    ["no-go", "proof no-go"],
  ] as const)("the proof decision %s reads %s", (decision, phrase) => {
    const global = { decision, provisional: false, wilsonLower: 0.9, cases: 120 };
    expect(evidence([row("spam", { global })])).toEqual([`spam: auto on · ${phrase} · check pass`]);
  });

  test.each([
    [undefined, "check none"],
    ["pass", "check pass"],
    ["fail", "check fail"],
    ["inconclusive", "check inconclusive"],
    ["unknown", "check no result"],
  ] as const)("the check outcome %s reads %s", (outcome, phrase) => {
    const history = outcome === undefined ? null : ({ outcome, acted: 80, moved: 1 } as unknown as Row["history"]);
    expect(evidence([row("spam", { history })])).toEqual([`spam: auto on · proof go · ${phrase}`]);
  });
});
