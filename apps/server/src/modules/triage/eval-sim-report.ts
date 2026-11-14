import {
  type BarCategory,
  barCategories,
  type Category,
  computeMetrics,
  type EvalCase,
  type LlmRole,
  type SimGateRow,
  type SimPart,
  simGoNoGo,
  type UrgencySource,
  wilsonInterval,
} from "@ea/core";
import { z } from "zod";

import type { CaseResult, CasesEvalReport } from "./eval";
import { num, pct, table } from "./eval-format";

// The gate file only ever carries this bar and this minimum support (D27): a looser run writes none.
export const GATE_BAR = 0.98;
export const GATE_MIN_KEPT = 30;

const URGENCY_SOURCES = ["text", "vip", "context"] as const;
const LANGUAGES = ["pl", "en", "de"] as const;
const MISSED_CATEGORIES = ["urgent", "needs_reply"] as const;

export interface SimMeta {
  lang: "pl" | "en" | "de";
  part: SimPart;
  urgencySource?: UrgencySource;
  hardCases: string[];
}

export interface SimReportInput {
  report: CasesEvalReport;
  // By case id, from the loaded cases.
  meta: Map<string, SimMeta>;
  corpus: {
    scenario: string;
    version: string;
    manifestSha: string | null;
    audit: "pending" | "done" | "not frozen";
    part: SimPart;
  };
  // D28: true for holdout. No section prints a case id then.
  hideIds: boolean;
}

// The facts of the sim cases that the sim sections group by.
export function simMetaOf(cases: readonly EvalCase[]): Map<string, SimMeta> {
  const meta = new Map<string, SimMeta>();
  for (const c of cases) {
    if (c.sim === undefined) continue;
    meta.set(c.id, {
      lang: c.lang,
      part: c.sim.part,
      ...(c.sim.urgencySource === undefined ? {} : { urgencySource: c.sim.urgencySource }),
      hardCases: c.sim.hardCases,
    });
  }
  return meta;
}

export function simHeaderLines({ report, corpus }: SimReportInput): string[] {
  const sha = corpus.manifestSha === null ? "none" : corpus.manifestSha.slice(0, 12);
  const cap = report.cost.capUsd === null ? "none" : `$${report.cost.capUsd.toFixed(2)}`;
  return [
    `- corpus: ${corpus.scenario} v${corpus.version} (${corpus.part}), manifest ${sha}, owner audit: ${corpus.audit}`,
    `- cost: $${report.cost.spentUsd.toFixed(4)} of cap ${cap}`,
  ];
}

// The cases that got an answer. An error case has no final category and is in no table.
function answered(report: CasesEvalReport): (CaseResult & { finalCategory: Category })[] {
  return report.cases.filter(
    (c): c is CaseResult & { finalCategory: Category } => c.errorCode === null && c.finalCategory !== null
  );
}

const found = (rows: CaseResult[], category: Category): number =>
  rows.filter((c) => c.finalCategory === category).length;

export function renderSimSections(input: SimReportInput): string[] {
  const { report, meta } = input;
  const rows = answered(report);
  const lines: string[] = [];

  lines.push("## Sim gate", "");
  const gate = simGoNoGo(report.predictions, { bar: report.bar, minKept: report.minKept });
  lines.push(
    ...table(
      ["category", "support", "threshold", "kept", "precision", "Wilson 95% lower", "recall", "decision"],
      barCategories.map((category) => {
        const g = gate[category];
        return [
          category,
          g.support,
          num(g.threshold, 2),
          g.kept,
          pct(g.precision),
          pct(g.wilsonLower),
          pct(g.recall),
          g.decision,
        ];
      })
    )
  );
  lines.push(
    `The sim gate reads the Wilson 95% lower bound of the precision, not the point value. A category needs at least 200 rows of support.`,
    ""
  );

  lines.push("## Missed mail", "");
  lines.push(
    ...table(
      ["category", "support", "recall", "false-negative rate", "false-negative rate, Wilson 95% upper"],
      MISSED_CATEGORIES.map((category) => {
        const own = rows.filter((c) => c.expected === category);
        const missed = own.length - found(own, category);
        return [
          category,
          own.length,
          pct(own.length === 0 ? null : found(own, category) / own.length),
          pct(own.length === 0 ? null : missed / own.length),
          own.length === 0 ? "n/a" : pct(wilsonInterval(missed, own.length).upper),
        ];
      })
    )
  );

  lines.push("## Urgent recall by source", "");
  const urgent = rows.filter((c) => c.expected === "urgent");
  lines.push(
    ...table(
      ["source", "n", "found", "recall", "Wilson 95% lower"],
      URGENCY_SOURCES.map((source) => {
        const own = urgent.filter((c) => meta.get(c.id)?.urgencySource === source);
        const hit = found(own, "urgent");
        return [
          source,
          own.length,
          hit,
          pct(own.length === 0 ? null : hit / own.length),
          own.length === 0 ? "n/a" : pct(wilsonInterval(hit, own.length).lower),
        ];
      })
    )
  );

  lines.push("## By language", "");
  lines.push(
    ...table(
      ["language", "n", "accuracy", "urgent recall", "needs_reply recall"],
      LANGUAGES.map((lang) => {
        const own = rows.filter((c) => meta.get(c.id)?.lang === lang);
        const recall = (category: Category) => {
          const expected = own.filter((c) => c.expected === category);
          return pct(expected.length === 0 ? null : found(expected, category) / expected.length);
        };
        const right = own.filter((c) => c.finalCategory === c.expected).length;
        return [
          lang,
          own.length,
          pct(own.length === 0 ? null : right / own.length),
          recall("urgent"),
          recall("needs_reply"),
        ];
      })
    )
  );

  lines.push("## Hard cases", "");
  const tags = [...new Set([...meta.values()].flatMap((m) => m.hardCases))].sort();
  lines.push(
    ...table(
      ["tag", "n", "right", "rate"],
      tags.map((tag) => {
        const own = rows.filter((c) => meta.get(c.id)?.hardCases.includes(tag));
        const right = own.filter(
          (c) => c.finalCategory === c.expected && (c.kind !== "injection" || c.injectionPassed === true)
        ).length;
        return [tag, own.length, right, pct(own.length === 0 ? null : right / own.length)];
      })
    )
  );
  lines.push("Error cases are in no table of this sim part.", "");
  return lines;
}

const gateRowSchema = z.object({
  support: z.number(),
  threshold: z.number().nullable(),
  kept: z.number(),
  tp: z.number(),
  precision: z.number().nullable(),
  wilsonLower: z.number().nullable(),
  recall: z.number().nullable(),
  decision: z.enum(["go", "no-go", "no-go: too few"]),
  metrics: z.object({ tp: z.number(), fp: z.number(), fn: z.number(), support: z.number() }),
});

const sourceSchema = z.object({ n: z.number(), recall: z.number().nullable() });

// The machine-readable result of a holdout run (D27). No case id, no mail text.
export const gateFileSchema = z.object({
  scenario: z.string(),
  version: z.string(),
  manifestSha: z.string().nullable(),
  audit: z.enum(["pending", "done", "not frozen"]),
  // True unless the owner audit is done: a consumer must not unlock `auto` from a provisional file.
  provisional: z.boolean(),
  part: z.enum(["dev", "holdout", "week"]),
  date: z.string(),
  role: z.string(),
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string().nullable(),
  promptVersion: z.string(),
  bar: z.number(),
  minKept: z.number(),
  categories: z.object({
    urgent: gateRowSchema,
    needs_reply: gateRowSchema,
    info: gateRowSchema,
    notification: gateRowSchema,
    spam: gateRowSchema,
  }),
  urgentRecallBySource: z.object({ text: sourceSchema, vip: sourceSchema, context: sourceSchema }),
  injection: z.object({ passed: z.number(), total: z.number() }),
});

export type GateFile = z.infer<typeof gateFileSchema>;

export function buildGateFile(input: SimReportInput & { now: Date }): GateFile {
  const { report, meta, corpus } = input;
  const gate = simGoNoGo(report.predictions, { bar: report.bar, minKept: report.minKept });
  // The final predictions, no threshold: the measure the gap check compares.
  const metrics = computeMetrics(report.predictions);
  const categoriesOut = {} as Record<
    BarCategory,
    SimGateRow & { metrics: GateFile["categories"]["urgent"]["metrics"] }
  >;
  for (const category of barCategories) {
    const { tp, fp, fn, support } = metrics[category];
    categoriesOut[category] = { ...gate[category], metrics: { tp, fp, fn, support } };
  }
  const urgent = answered(report).filter((c) => c.expected === "urgent");
  const bySource = (source: UrgencySource) => {
    const own = urgent.filter((c) => meta.get(c.id)?.urgencySource === source);
    return { n: own.length, recall: own.length === 0 ? null : found(own, "urgent") / own.length };
  };
  return {
    scenario: corpus.scenario,
    version: corpus.version,
    manifestSha: corpus.manifestSha,
    audit: corpus.audit,
    provisional: corpus.audit !== "done",
    part: corpus.part,
    date: input.now.toISOString().slice(0, 10),
    role: report.role,
    provider: report.provider,
    model: report.model,
    reasoningEffort: report.reasoningEffort,
    promptVersion: report.promptVersion,
    bar: report.bar,
    minKept: report.minKept,
    categories: categoriesOut,
    urgentRecallBySource: { text: bySource("text"), vip: bySource("vip"), context: bySource("context") },
    injection: { passed: report.injection.passed, total: report.injection.total },
  };
}

const safe = (part: string): string => part.replace(/[^\w.-]/g, "_");

export function gateFileName(input: {
  role: LlmRole;
  promptVersion: string;
  model: string;
  reasoningEffort: string | null;
  scenario: string;
  version: string;
}): string {
  const parts = [input.role, input.promptVersion, input.model, input.reasoningEffort ?? "default", input.scenario].map(
    safe
  );
  return `${parts.join("-")}-v${safe(input.version)}.json`;
}

// The gate file says "go" only for a full holdout run at the default bar: a looser or partial run writes none.
export function gateFileRefusal(
  options: { part?: string; bar: number; "min-kept": number; limit?: number },
  report: CasesEvalReport
): string | null {
  if (options.part !== "holdout") return "no gate file: part is not holdout";
  if (options.limit !== undefined) return "no gate file: --limit is set";
  if (options.bar !== GATE_BAR) return `no gate file: bar is not ${GATE_BAR}`;
  if (options["min-kept"] !== GATE_MIN_KEPT) return `no gate file: min-kept is not ${GATE_MIN_KEPT}`;
  if (!report.complete) return "no gate file: the run is not complete";
  return null;
}
