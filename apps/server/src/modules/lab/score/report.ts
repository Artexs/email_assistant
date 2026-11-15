import { categories, type Category, type MissedImportant } from "@ea/core";

import type { Interval, RecallCount, TriageScore } from "./triage";

export interface ScoreHeader {
  runId: string;
  mode: "day" | "week";
  // The run is not stopped: the numbers are those of the moment of scoring.
  partial: boolean;
  startDate: string;
  offsetDays: number;
  corpusId: string;
  corpusVersion: string;
  // sha256 of the JSON of the corpus manifest.
  manifestHash: string;
  auditStatus: "pending" | "done";
  // Distinct models of the `llm.call` rows of the run organization in the run window.
  models: string[];
  capUsd: number;
  spendUsd: number;
  spendUnpriced: boolean;
  stopReason: string;
  scoredAt: string;
}

export interface LabScore {
  header: ScoreHeader;
  triage: TriageScore;
  m1: MissedImportant;
  // One entry per section, each with its own renderer in `SECTION_RENDERERS`. Entries hold counts and ids, no text.
  sections: Record<string, unknown>;
}

// Typed section renderers: a section stage adds its entry here and its data under `LabScore.sections`.
export type SectionRenderer = (data: unknown) => string[];
export const section = <T>(render: (data: T) => string[]): SectionRenderer => render as SectionRenderer;

export interface CoverageSection {
  planned: number;
  injected: number;
  skipped: number;
  // Planned, not injected and not skipped yet.
  pending: number;
  late: number;
}

export interface SentCopiesSection {
  appended: number;
  seen: number;
}

const pct = (value: number | null): string => (value === null ? "n/a" : `${(value * 100).toFixed(1)} %`);
const num = (value: number | null): string => (value === null ? "n/a" : value.toFixed(4));
const range = (interval: Interval | null): string =>
  interval === null ? "n/a" : `${pct(interval.lower)} to ${pct(interval.upper)}`;

function table(head: string[], body: string[][]): string[] {
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ];
}

const recallLine = (name: string, count: RecallCount): string[] => [
  name,
  String(count.support),
  String(count.tp),
  num(count.recall),
];

function renderHeader(header: ScoreHeader): string[] {
  return [
    `# Live lab report ${header.runId}${header.partial ? " (partial)" : ""}`,
    "",
    ...table(
      ["Field", "Value"],
      [
        ["Run", header.runId],
        ["Mode", header.mode],
        ["Status", header.partial ? "partial (run not stopped)" : "stopped"],
        ["Start", header.startDate],
        ["Offset days", String(header.offsetDays)],
        ["Corpus", `${header.corpusId} v${header.corpusVersion}`],
        ["Manifest hash", header.manifestHash],
        ["Owner audit", header.auditStatus],
        ["Models seen", header.models.length === 0 ? "none" : header.models.join(", ")],
        ["Cap USD", header.capUsd.toFixed(2)],
        [
          "Spend USD",
          `${header.spendUsd.toFixed(4)}${header.spendUnpriced ? " (lower bound: an unpriced model was called)" : ""}`,
        ],
        ["Stop reason", header.stopReason],
        ["Scored at", header.scoredAt],
      ]
    ),
    "",
  ];
}

function renderTriage(triage: TriageScore): string[] {
  const { missing } = triage;
  const skipped = Object.entries(missing.skipped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, count]) => `${code} ${count}`);
  const categoryRows = categories.map((category: Category) => {
    const row = triage.perCategory[category];
    return [
      category,
      String(row.support),
      String(row.predicted),
      String(row.tp),
      String(row.fp),
      String(row.fn),
      num(row.precision),
      range(row.precisionInterval),
      num(row.recall),
      range(row.recallInterval),
    ];
  });
  const sourceRows = Object.entries(triage.urgentRecallBySource).map(([source, count]) => recallLine(source, count));
  const hardRows = Object.entries(triage.recallByHardCase).map(([tag, count]) => recallLine(tag, count));
  return [
    "## Triage",
    "",
    `Scored ${triage.scored} mails. Left out of precision and recall: not synced ${missing.notSynced}, not triaged ${missing.notTriaged}, skipped ${skipped.length === 0 ? "0" : skipped.join(", ")}.`,
    "",
    ...table(
      ["Category", "Support", "Predicted", "TP", "FP", "FN", "Precision", "Precision 95 %", "Recall", "Recall 95 %"],
      categoryRows
    ),
    "",
    `False-negative rate: urgent ${num(triage.falseNegativeRate.urgent)}, needs_reply ${num(triage.falseNegativeRate.needs_reply)}.`,
    "",
    "Urgent recall by source:",
    "",
    ...table(["Source", "Support", "TP", "Recall"], sourceRows),
    "",
    "Recall by hard-case tag:",
    "",
    ...(hardRows.length === 0 ? ["No hard-case rows."] : table(["Tag", "Support", "TP", "Recall"], hardRows)),
    "",
  ];
}

function renderM1(m1: MissedImportant): string[] {
  return [
    "## M1: important mail missed",
    "",
    `Important mails ${m1.important}, missed ${m1.misses}. The truth is the slot category; an urgent mail needs an urgent prediction, a needs-reply mail must not be info, notification or spam.`,
    "",
  ];
}

export const SECTION_RENDERERS: Record<string, SectionRenderer> = {
  coverage: section<CoverageSection>((data) => [
    "## Coverage",
    "",
    `Planned ${data.planned}, injected ${data.injected}, skipped ${data.skipped}, not injected yet ${data.pending}, injected late ${data.late}.`,
    "",
  ]),
  sentCopies: section<SentCopiesSection>((data) => [
    "## Sent copies",
    "",
    `Sent copies: appended ${data.appended}, seen by the server ${data.seen}.`,
    "",
  ]),
  // The per-slot rows are for the JSON file only.
  mails: section<unknown>(() => []),
};

/**
 * The Markdown and the JSON of a report. The JSON is the whole score; both hold counts, ids and slot ids, never a
 * subject, a body or an address. A section with no renderer is in the JSON only.
 */
export function renderLabReport(score: LabScore): { markdown: string; json: string } {
  const parts = Object.entries(score.sections).flatMap(([key, data]) => SECTION_RENDERERS[key]?.(data) ?? []);
  const markdown = [...renderHeader(score.header), ...renderTriage(score.triage), ...renderM1(score.m1), ...parts]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return { markdown: `${markdown}\n`, json: `${JSON.stringify(score, null, 2)}\n` };
}

/** `sim-<scored date>-lab-01-<runId>`: the run id holds the mode. */
export function reportBaseName(header: ScoreHeader): string {
  return `sim-${header.scoredAt.slice(0, 10)}-${header.corpusId}-${header.runId}`;
}
