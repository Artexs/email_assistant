import { resolve } from "node:path";

import type { Category, UrgencySource } from "@ea/core";
import { beforeAll, describe, expect, test } from "bun:test";

import { loadLabCorpus, type LabCorpus } from "../corpus";
import type { LabEvent, LabRun } from "../state";

import type { ScoredMail } from "./join";
import { renderLabReport, reportBaseName, type LabScore, type ScoreHeader } from "./report";
import { coverageOf } from "./run";
import { scoreM1, scoreTriage } from "./triage";

const ROOT = resolve(import.meta.dir, "../../../../../../evals/sim");

let corpus: LabCorpus;
beforeAll(async () => {
  corpus = await loadLabCorpus(ROOT, "lab-01");
});

let counter = 0;
function mail(truth: Category, predicted: Category | null, extra: Partial<ScoredMail> = {}): ScoredMail {
  counter += 1;
  return {
    slotId: `w-1-${String(counter).padStart(3, "0")}`,
    emailId: predicted === null ? null : `e-${counter}`,
    predicted,
    truth,
    hardCases: [],
    ...extra,
  };
}
const urgent = (predicted: Category, urgencySource: UrgencySource, hardCases: string[] = []): ScoredMail =>
  mail("urgent", predicted, { urgencySource, hardCases });

// The 10 mails of the stage file: urgent 3 (2 right, 1 info), needs_reply 2 (1 right, 1 notification), spam 3 right,
// notification 1 right, info 1 predicted urgent.
const fixture = (): ScoredMail[] => [
  urgent("urgent", "text"),
  urgent("urgent", "vip"),
  urgent("info", "context"),
  mail("needs_reply", "needs_reply"),
  mail("needs_reply", "notification"),
  mail("spam", "spam"),
  mail("spam", "spam"),
  mail("spam", "spam"),
  mail("notification", "notification"),
  mail("info", "urgent"),
];

describe("scoreTriage (stage 12 tests 1-4)", () => {
  test("1: urgent tp 2, fp 1, fn 1; precision and recall 0.6667, with a Wilson interval", () => {
    const urgentScore = scoreTriage(fixture()).perCategory.urgent;
    expect(urgentScore).toMatchObject({ support: 3, predicted: 3, tp: 2, fp: 1, fn: 1 });
    expect(urgentScore.precision).toBeCloseTo(0.6667, 4);
    expect(urgentScore.recall).toBeCloseTo(0.6667, 4);
    expect(urgentScore.recallInterval?.lower).toBeGreaterThan(0.2);
    expect(urgentScore.recallInterval?.upper).toBeLessThan(0.95);
    // A category with no support has no recall and no interval; `unsure` is a predicted value only.
    const delegation = scoreTriage(fixture()).perCategory.delegation;
    expect(delegation).toMatchObject({ support: 0, recall: null, recallInterval: null });
  });

  test("2: false-negative rate urgent 0.3333, needs_reply 0.5; null with no support", () => {
    const { falseNegativeRate } = scoreTriage(fixture());
    expect(falseNegativeRate.urgent).toBeCloseTo(0.3333, 4);
    expect(falseNegativeRate.needs_reply).toBe(0.5);
    expect(scoreTriage([mail("info", "info")]).falseNegativeRate).toEqual({ urgent: null, needs_reply: null });
  });

  test("3: M1 important 5, misses 2", () => {
    const m1 = scoreM1(fixture());
    expect(m1.important).toBe(5);
    expect(m1.misses).toBe(2);
    expect(m1.missesBySource).toEqual({ correction: 0, review: 0, moved_back: 0, answered_check: 0 });
  });

  test("4: urgent recall by source: text 1, vip 1, context 0", () => {
    const { urgentRecallBySource } = scoreTriage(fixture());
    expect(urgentRecallBySource.text.recall).toBe(1);
    expect(urgentRecallBySource.vip.recall).toBe(1);
    expect(urgentRecallBySource.context).toMatchObject({ support: 1, tp: 0, recall: 0 });
  });

  test("recall per hard-case tag counts support and hits", () => {
    const rows = [
      urgent("urgent", "text", ["polish_diacritics"]),
      urgent("info", "vip", ["polish_diacritics", "urgent_no_keyword"]),
      mail("spam", "spam"),
    ];
    const { recallByHardCase } = scoreTriage(rows);
    expect(recallByHardCase.polish_diacritics).toEqual({ support: 2, tp: 1, recall: 0.5 });
    expect(recallByHardCase.urgent_no_keyword).toEqual({ support: 1, tp: 0, recall: 0 });
    expect(Object.keys(recallByHardCase)).toHaveLength(2);
  });

  test("rows with no mail, no result or a skip are counted and left out of precision and recall", () => {
    const rows = [
      ...fixture(),
      mail("urgent", null, { urgencySource: "text", skipped: "not_synced" }),
      mail("urgent", null, { urgencySource: "vip", skipped: "not_triaged", emailId: "e-x" }),
      mail("spam", null, { skipped: "smtp_failed" }),
      mail("spam", null, { skipped: "smtp_failed" }),
    ];
    const score = scoreTriage(rows);
    expect(score.scored).toBe(10);
    expect(score.missing).toEqual({ notSynced: 1, notTriaged: 1, skipped: { smtp_failed: 2 } });
    expect(score.perCategory.urgent).toMatchObject({ support: 3, tp: 2, fn: 1 });
    expect(score.perCategory.spam.support).toBe(3);
    expect(scoreM1(rows).important).toBe(5);
  });
});

const header = (over: Partial<ScoreHeader> = {}): ScoreHeader => ({
  runId: "day-20261123-0a1b",
  mode: "day",
  partial: false,
  startDate: "2026-11-23",
  offsetDays: 91,
  corpusId: "lab-01",
  corpusVersion: "1",
  manifestHash: "ab".repeat(32),
  auditStatus: "pending",
  models: ["gpt-6-luna"],
  capUsd: 1,
  spendUsd: 0.1234,
  spendUnpriced: false,
  stopReason: "done",
  scoredAt: "2026-11-25T10:00:00.000Z",
  ...over,
});

const scoreOf = (rows: ScoredMail[], over: Partial<ScoreHeader> = {}): LabScore => ({
  header: header(over),
  triage: scoreTriage(rows),
  m1: scoreM1(rows),
  sections: {
    coverage: { planned: 12, injected: 10, skipped: 1, pending: 1, late: 2 },
    sentCopies: { appended: 3, seen: 2 },
    mails: rows.map((row) => ({ slotId: row.slotId, truth: row.truth, predicted: row.predicted })),
  },
});

describe("renderLabReport (stage 12 test 5)", () => {
  test("5: the Markdown holds none of the subjects or bodies of the corpus texts; the JSON parses and holds slot ids", () => {
    const slots = [...corpus.slots.values()].filter((slot) => slot.direction === "in").slice(0, 10);
    const rows = fixture().map((row, index) => ({ ...row, slotId: (slots[index] as { id: string }).id }));
    const { markdown, json } = renderLabReport(scoreOf(rows));
    let checked = 0;
    for (const slot of slots) {
      const text = corpus.texts.get(slot.id);
      if (text === undefined) continue;
      for (const piece of [text.subject, text.body.slice(0, 40)]) {
        if (piece.trim().length < 8) continue;
        checked += 1;
        expect(markdown).not.toContain(piece);
        expect(json).not.toContain(piece);
      }
    }
    expect(checked).toBeGreaterThan(5);
    expect(markdown).not.toMatch(/@[a-z0-9.-]+\.test/);
    expect(json).not.toMatch(/@[a-z0-9.-]+\.test/);
    const parsed = JSON.parse(json) as LabScore;
    expect(parsed.triage.perCategory.urgent.tp).toBe(2);
    expect(parsed.m1.misses).toBe(2);
    expect(json).toContain(slots[0]?.id as string);
  });

  test("the report shows the header, the triage table, M1, coverage and the sent copies", () => {
    const { markdown } = renderLabReport(scoreOf(fixture()));
    expect(markdown).toContain("# Live lab report day-20261123-0a1b");
    expect(markdown).not.toContain("(partial)");
    expect(markdown).toContain("| Corpus | lab-01 v1 |");
    expect(markdown).toContain(`| Manifest hash | ${"ab".repeat(32)} |`);
    expect(markdown).toContain("| Owner audit | pending |");
    expect(markdown).toContain("| Models seen | gpt-6-luna |");
    expect(markdown).toContain("| urgent | 3 | 3 | 2 | 1 | 1 | 0.6667 |");
    expect(markdown).toContain("False-negative rate: urgent 0.3333, needs_reply 0.5000.");
    expect(markdown).toContain("Important mails 5, missed 2.");
    expect(markdown).toContain("Planned 12, injected 10, skipped 1, not injected yet 1, injected late 2.");
    expect(markdown).toContain("Sent copies: appended 3, seen by the server 2.");
    expect(markdown).toContain("| context | 1 | 0 | 0.0000 |");
  });

  test("a run that is not stopped is marked partial in the title and the status", () => {
    const { markdown } = renderLabReport(scoreOf(fixture(), { partial: true, stopReason: "running" }));
    expect(markdown).toContain("# Live lab report day-20261123-0a1b (partial)");
    expect(markdown).toContain("| Status | partial (run not stopped) |");
  });

  test("a section with no renderer is in the JSON only; a new renderer shows its lines", () => {
    const score = scoreOf(fixture());
    score.sections.future = { n: 1 };
    const { markdown, json } = renderLabReport(score);
    expect(markdown).not.toContain("future");
    expect(JSON.parse(json).sections.future).toEqual({ n: 1 });
  });

  test("the file name is sim-<scored date>-<corpus>-<run id>", () => {
    expect(reportBaseName(header())).toBe("sim-2026-11-25-lab-01-day-20261123-0a1b");
    expect(reportBaseName(header({ runId: "week-20261123-ffff" }))).toBe("sim-2026-11-25-lab-01-week-20261123-ffff");
  });
});

describe("coverageOf", () => {
  const run = (ids: string[]): LabRun => ({
    plan: {
      runId: "day-20261123-0a1b",
      mode: "day",
      startDate: "2026-11-23",
      offsetDays: 0,
      scenarioDays: [1],
      items: ids.map((slotId) => ({ slotId, at: "2026-11-23T08:00:00.000Z" })),
      endsAt: "2026-11-23T23:00:00.000Z",
      tailEndsAt: "2026-11-24T23:00:00.000Z",
      deadlines: [],
    },
    org: "lab",
    capUsd: 1,
  });

  test("counts planned, injected, skipped, pending and late; a skip of another key is not a slot", () => {
    const events: LabEvent[] = [
      { t: "inject_intent", slotId: "a", messageId: "<a>" },
      { t: "inject_done", slotId: "a", messageId: "<a>" },
      { t: "inject_done", slotId: "b", messageId: "<b>", lateBySec: 300 },
      { t: "skip", code: "smtp_failed", ref: "c" },
      { t: "skip", code: "unmapped", ref: "not-a-slot" },
    ];
    expect(coverageOf(run(["a", "b", "c", "d"]), events)).toEqual({
      planned: 4,
      injected: 2,
      skipped: 1,
      pending: 1,
      late: 1,
    });
  });
});
