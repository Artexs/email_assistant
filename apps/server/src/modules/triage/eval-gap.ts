import { categories, wilsonInterval } from "@ea/core";
import { z } from "zod";

import type { RealEvalReport } from "./eval";
import { pct, table } from "./eval-format";
import type { GateFile } from "./eval-sim-report";

// P9 (real-label clause): fewer real precision labels than this and the gap check gives no verdict.
export const GAP_MIN_REAL_N = 30;

// The categories the gap check compares (P7).
const GAP_CATEGORIES = ["notification", "spam"] as const;

const countsSchema = z
  .object({ tp: z.number().int(), fp: z.number().int(), fn: z.number().int(), support: z.number().int() })
  .strict();

// The real-label counts of D32: per category counts only, no mail id, no address, no text.
export const realCountsSchema = z
  .object({
    date: z.iso.date(),
    labeled: z.number().int(),
    categories: z.record(z.enum(categories), countsSchema),
  })
  .strict();

export type RealCounts = z.infer<typeof realCountsSchema>;

// An input file that cannot feed the gap check. `field` names the missing or wrong field.
export class GapInputError extends Error {
  readonly field: string;
  constructor(field: string, source: string) {
    super(`${source} has no usable field ${field}`);
    this.name = "GapInputError";
    this.field = field;
  }
}

export function realCounts(report: RealEvalReport): RealCounts {
  const out = {} as RealCounts["categories"];
  for (const category of categories) {
    const { tp, fp, fn, support } = report.metrics[category];
    out[category] = { tp, fp, fn, support };
  }
  return { date: report.startedAt.toISOString().slice(0, 10), labeled: report.labeled, categories: out };
}

// Names the first bad field of a parsed gate file, for the typed error (older files have no `metrics`).
export function gateFileError(issuePath: PropertyKey[]): GapInputError {
  return new GapInputError(issuePath.map(String).join("."), "gate file");
}

interface Side {
  tp: number;
  fp: number;
  fn: number;
}

const interval = (value: { lower: number; upper: number }): string =>
  `[${value.lower.toFixed(4)}, ${value.upper.toFixed(4)}]`;

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

function simSide(sim: GateFile, category: (typeof GAP_CATEGORIES)[number]): Side {
  const metrics = (sim.categories[category] as { metrics?: Partial<Side> } | undefined)?.metrics;
  for (const key of ["tp", "fp", "fn"] as const) {
    if (typeof metrics?.[key] !== "number")
      throw new GapInputError(`categories.${category}.metrics.${key}`, "gate file");
  }
  return metrics as Side;
}

function realSide(real: RealCounts, category: (typeof GAP_CATEGORIES)[number]): Side {
  const counts = real.categories[category];
  if (counts === undefined) throw new GapInputError(`categories.${category}`, "real counts");
  return counts;
}

// Markdown of the sim-vs-real comparison. Both sides use the same measure: the final category, no threshold.
export function renderGap(input: { sim: GateFile; real: RealCounts }): string {
  const { sim, real } = input;
  const lines = [
    "# Sim vs real gap",
    "",
    "- measure: final category, no threshold (both sides)",
    `- sim: ${sim.scenario} v${sim.version} (${sim.part}), ${sim.date}, prompt ${sim.promptVersion}, model ${sim.model}`,
    `- real: ${real.labeled} labelled mails, ${real.date}`,
    `- verdict "gap": the two 95 % Wilson precision intervals do not overlap; "too few real labels": real tp + fp < ${GAP_MIN_REAL_N}`,
    "",
  ];
  const rows: (string | number)[][] = [];
  for (const category of GAP_CATEGORIES) {
    const s = simSide(sim, category);
    const r = realSide(real, category);
    const simN = s.tp + s.fp;
    const realN = r.tp + r.fp;
    const simInterval = wilsonInterval(s.tp, simN);
    const realInterval = wilsonInterval(r.tp, realN);
    const overlap = simInterval.lower <= realInterval.upper && realInterval.lower <= simInterval.upper;
    const verdict = realN < GAP_MIN_REAL_N ? "too few real labels" : overlap ? "no gap" : "gap";
    rows.push([
      category,
      pct(ratio(s.tp, simN)),
      interval(simInterval),
      pct(ratio(s.tp, s.tp + s.fn)),
      pct(ratio(r.tp, realN)),
      interval(realInterval),
      pct(ratio(r.tp, r.tp + r.fn)),
      realN,
      verdict,
    ]);
  }
  lines.push(
    ...table(
      [
        "category",
        "sim precision",
        "sim interval",
        "sim recall",
        "real precision",
        "real interval",
        "real recall",
        "real n (tp + fp)",
        "verdict",
      ],
      rows
    )
  );
  return lines.join("\n");
}
