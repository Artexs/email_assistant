# F097 stage 14 — Report: Wilson bound, sim gate, tables, gate file

Part of [`../plan.md`](../plan.md).

After this stage a sim report shows everything the epic asks (P5, P9, D23–D28, D32): per-category precision and recall, false-negative rates on `urgent` and `needs_reply`, urgent recall per urgency source, per-language and per-hard-case tables, the Wilson lower bound and the sim gate, cost and cap, corpus version and audit status; a holdout run writes the gate file; `--real --json` and `--gap` compare sim and real labels.

## Step 1 — Wilson interval and the sim gate in core

**Goal.** One Wilson function for every later epic; the sim gate rule (D23, D24).

**Files.** `packages/core/src/triage/metrics.ts`, `metrics.test.ts`.

**Interfaces.**

```ts
// Wilson score interval at 95 % (z = 1.959964). n = 0 gives { lower: 0, upper: 1 }.
export function wilsonInterval(successes: number, n: number, z = 1.959964): { lower: number; upper: number };

export interface SimGateRow {
  support: number; threshold: number | null; kept: number; tp: number;
  precision: number | null; wilsonLower: number | null; recall: number | null;
  decision: "go" | "no-go" | "no-go: too few";
}
export const SIM_MIN_SUPPORT = 200;
export function simGoNoGo(
  rows: Prediction[],
  opts?: { bar?: number; minSupport?: number; minKept?: number }
): Record<BarCategory, SimGateRow>;
```

Rule (D24): per bar category, `support` = LLM rows with that expected category; `support < minSupport` → `no-go: too few` (threshold null, the lowest sweep point's numbers); else the first `THRESHOLDS` point with `kept ≥ minKept` and `wilsonInterval(tp, kept).lower ≥ bar` → `go`; else `no-go` with the lowest eligible point's numbers.

**Decisions.** D23, D24.

**Test** (plan F4 numbers, 4 decimals):

1. `wilsonInterval(200, 200).lower` → 0.9812; `(199, 200).lower` → 0.9722; `(190, 190).lower` → 0.9802; `(185, 185).lower` → 0.9797; `(0, 0)` → `{ lower: 0, upper: 1 }`.
2. 200 `notification` rows all predicted `notification` at confidence 0.95 → `go` at threshold 0.5, `wilsonLower` 0.9812.
3. The same with one false positive (an `info` row predicted `notification`) → `no-go` (lower 0.9724 for 200/201).
4. 199 rows of support → `no-go: too few`.
5. The existing `goNoGo` tests pass unchanged.

**Check.** `bun test packages/core/src/triage/metrics.test.ts`

**Done when.** Cases 1–5 pass.

## Step 2 — Report sections and the gate file

**Goal.** The sim report and the machine-readable gate result (D27, D28, P5, P9).

**Files.** `apps/server/src/modules/triage/eval-report.ts`, `eval-report.test.ts`, `apps/server/src/modules/triage/eval-sim-report.ts` (new: the sim sections and the gate JSON builder; keeps `eval-report.ts` under 400 lines), `eval-sim-report.test.ts`, `apps/server/src/scripts/eval.ts` (writes the gate file), `apps/server/src/modules/triage/index.ts`.

**Interfaces.**

```ts
export interface SimMeta { lang: "pl" | "en" | "de"; part: SimPart; urgencySource?: UrgencySource; hardCases: string[] }
export interface SimReportInput {
  report: CasesEvalReport;
  meta: Map<string, SimMeta>;                 // by case id, from the loaded cases
  corpus: { scenario: string; version: string; manifestSha: string | null; audit: "pending" | "done" | "not frozen"; part: SimPart };
  hideIds: boolean;                            // D28: true for holdout
}
export function renderSimSections(input: SimReportInput): string[];
export function buildGateFile(input: SimReportInput & { now: Date }): GateFile;
export const gateFileSchema: z.ZodType<GateFile>;
export function gateFileName(input: { role: LlmRole; promptVersion: string; model: string; reasoningEffort: string | null; scenario: string; version: string }): string;
// `${role}-${promptVersion}-${model}-${effort ?? "default"}-${scenario}-v${version}.json`, every part with [^\w.-] → _
```

`renderEvalReport(report, { title, sim?: SimReportInput })`: with `sim`, the header gains `- corpus: <scenario> v<version> (<part>), manifest <first 12 hex>, owner audit: <status>` and `- cost: $<spent 4 dp> of cap $<cap 2 dp>`; after the shared parts it adds:

1. `## Sim gate` — table `category | support | threshold | kept | precision | Wilson 95% lower | recall | decision` (`simGoNoGo`, bar = the run's bar).
2. `## Missed mail` — `urgent` and `needs_reply`: support, recall, false-negative rate, and the Wilson 95 % upper bound of the false-negative rate.
3. `## Urgent recall by source` — rows `text`, `vip`, `context`: n, found, recall, Wilson lower.
4. `## By language` — rows `pl`, `en`, `de`: n, accuracy, `urgent` recall, `needs_reply` recall.
5. `## Hard cases` — one row per tag present: n, right (final category = expected; for `kind: injection` also `injectionPassed`), rate.
6. With `hideIds` (holdout): the failed injection id line becomes `Failed injection cases: <count>`; the "blocked" line prints a count, no ids; no other section prints an id.

`buildGateFile` (D27): `{ scenario, version, manifestSha, audit, provisional, part, date, role, provider, model, reasoningEffort, promptVersion, bar, minKept, categories: { [bar category]: SimGateRow & { metrics: { tp, fp, fn, support } } }, urgentRecallBySource: { text, vip, context: { n, recall } }, injection: { passed, total } }`. `provisional` = `audit !== "done"` (a consumer such as E4-B must not unlock `auto` from a provisional file; plan § Seams). `metrics` = `computeMetrics` of the final predictions (no threshold), the measure the gap check compares (stage 15). No case id, no text.

`scripts/eval.ts` writes the gate file only when all of these hold, else it prints `no gate file: <reason>` and writes none: `--part holdout`; `complete: true`; `--bar` is 0.98 and `--min-kept` is 30 (the defaults: a gate file never carries a looser bar); no `--limit`. It writes to `evals/results/gate/<gateFileName>` and overwrites an older file of the same name (same prompt, model, effort and corpus version). It also writes the markdown to `--out` when given.

**Decisions.** D27, D28, P5, P9.

**Test** (unit, a hand-built `CasesEvalReport` of 12 results and its meta):

1. `renderSimSections` holds the five section titles; the urgent-by-source table has the right n and recall for a fixture with text 2/3, vip 1/1, context 0/2.
2. `hideIds: true` → the rendered text contains none of the 12 case ids; `hideIds: false` → the failed injection id is present.
3. `buildGateFile` parses with `gateFileSchema`; its JSON contains no case id.
4. `gateFileName({ role: "classifier", promptVersion: "classifier-v2", model: "gpt-6-luna", reasoningEffort: "none", scenario: "lab-01", version: "1.1" })` → `classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.1.json`; effort `null` → `…-default-…`.
6. The gate-file guard (exported pure function `gateFileRefusal(options, report)`): `--bar 0.9` → `no gate file: bar is not 0.98`; `--limit 10` → refusal; `--part dev` → refusal; an incomplete run → refusal; defaults on a complete holdout run → `null`.
7. `buildGateFile` with audit `pending` → `provisional: true`; with `done` → `false`.
5. The old report tests (`eval-report.test.ts`) pass unchanged (no `sim` option → same text).

**Check.** `bun test apps/server/src/modules/triage/eval-report.test.ts apps/server/src/modules/triage/eval-sim-report.test.ts`

**Done when.** Cases 1–7 pass.

**Out of scope.** `--real --json` and the gap command (stage 15).
