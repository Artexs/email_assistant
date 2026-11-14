# F097 stage 15 — `--real --json` and the gap command

Part of [`../plan.md`](../plan.md).

After this stage the real-label run can write its counts as JSON, and one command compares sim and real numbers for `notification` and `spam` at the same operating point (D32, P7).

## Step 1 — `--real --json` and the gap command

**Goal.** Sim and real numbers for `notification` and `spam` side by side (D32, P7).

**Files.** `apps/server/src/scripts/eval.ts`, `apps/server/src/modules/triage/eval-gap.ts` (new), `eval-gap.test.ts`, `evals/README.md` (flags).

**Interfaces.**

```
bun run eval --real --org-id <uuid> --mailbox-id <uuid> [--json <file>]   // counts only
bun run eval --gap --sim-json <gate file> --real-json <file> [--out <file.md>]
```

```ts
export const realCountsSchema = z.object({
  date: z.iso.date(), labeled: z.number().int(),
  categories: z.record(z.enum(categories), z.object({ tp: z.number().int(), fp: z.number().int(), fn: z.number().int(), support: z.number().int() }).strict()),
}).strict();
export function realCounts(report: RealEvalReport): RealCounts;
export function renderGap(input: { sim: GateFile; real: RealCounts }): string; // markdown
```

Both sides use the same measure: the final category of every labelled mail, no confidence threshold (`computeMetrics`). The sim side comes from `categories.<c>.metrics` of the gate file (stage 14), the real side from `realCounts` (built from the `--real` report's `metrics`). `renderGap` for `notification` and `spam`: sim precision `tp / (tp + fp)` with its Wilson interval, sim recall `tp / (tp + fn)`; the same for real, plus real n = `tp + fp`; verdict `gap` when the two precision intervals do not overlap, `no gap` when they overlap, `too few real labels` when real `tp + fp < 30` (P9 real-label clause). The report states the measure in one line ("final category, no threshold"). `--gap` needs no DB and no LLM key.

**Decisions.** D32, P7, P9.

**Test.**

1. Sim notification metrics `tp 200, fp 0`, real 28 tp + 2 fp → real interval [0.7868, 0.9815] overlaps the sim interval [0.9812, 1.0] → `no gap`.
2. Real 20 tp + 10 fp → interval [0.4878, 0.8077] → `gap`.
3. Real 10 tp + 5 fp → `too few real labels`.
4. `realCounts` JSON contains no email id and no address (fixture with ids in the report rows).
5. A gate file whose `categories.notification.metrics` is missing (an older file) → `renderGap` throws a typed error naming the field; the CLI prints it and exits 1.

**Check.** `bun test apps/server/src/modules/triage/eval-gap.test.ts`

**Done when.** Cases 1–5 pass.

**Out of scope.** Running the gap on real data (stage 22).
