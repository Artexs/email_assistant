# F097 stage 13 — `eval --sim`: loader, worker pool, budget

Part of [`../plan.md`](../plan.md). Review job before the land (state file, stop rules, money cap).

After this stage `bun run eval --sim <scenario> --part dev|holdout|week` classifies a corpus part with up to 8 calls in flight, stops at the run budget and the month budget, resumes from its state file, and keeps the old `bun run eval` behaviour (D22, D26, D28). The report additions come in stage 14.

Shared file: `apps/server/src/scripts/eval.ts` was changed by stage 01 (`runReal`). Start from `master` with stage 01 landed.

## Step 1 — Worker pool and budget in `runEval`

**Goal.** `runEval` runs cases in parallel with the same results and stops on errors or budget (D22, D26).

**Files.** `apps/server/src/modules/triage/eval.ts`, `eval.test.ts`, `apps/server/src/modules/triage/eval-pool.ts` (new). `eval.ts` is 557 lines (over the 400-line rule, plan fact F20, D38): the pool, the start rule and the stop rules go into `eval-pool.ts`; `runEval` stays in `eval.ts` (its input gains the two optional fields below) and calls the pool. The tests below stay in `eval.test.ts` and go through `runEval`.

**Interfaces.**

```ts
// runEval input gains:
concurrency?: number;            // default 1 (the old behaviour)
budget?: {
  capUsd: number;                // the run cap after the month rule (the CLI computes it)
  callCostUsd(usage: CaseUsage, at: Date): number | null; // costPerMail(usage.model, …); null = unknown price
  firstEstimateUsd: number;      // the price of 2,000 in + 300 out tokens of the run's model
};
// CasesEvalReport gains:
cost: { spentUsd: number; capUsd: number | null; stoppedByBudget: boolean } ;
```

Rules:

1. Results of `done` (the state) are taken as before; their cost counts in `spentUsd` (a resumed run continues the same cap).
2. A pool of `concurrency` workers takes the next not-done case in input order. Before a worker starts a new LLM case: if `errorsInRow ≥ STOP_AFTER_ERRORS` → stop issuing (`stoppedReason` as today); if `budget` and `spent + (inFlight + 1) × avg > capUsd` (`avg` = mean cost of the results so far in this run, else `firstEstimateUsd`; `spent` includes the cost of `done` results; compare with `> capUsd + 1e-12` so float sums like 0.0012 + 0.0003 do not stop early) → stop issuing, `stoppedReason = "budget cap reached: resume after the cap allows it"`, `cost.stoppedByBudget = true`. In-flight calls finish and their results count.
3. `errorsInRow` updates in finish order (an error +1, an LLM success resets, a rule result does not change it), as today.
4. `onResult` is called once per new result, in finish order (the state file is append-only, D22).
5. The report's `cases`, `predictions`, `injection.failedIds`, etc. are built after the pool ends, **in input order**, from the result map — so a report of a parallel run equals the report of the same results run one by one.
6. A judge pass is not part of this stage.

**Decisions.** D22, D26.

**Test** (unit, `eval.test.ts`, the existing fake LLM helpers; a fake `generate` that resolves after a delay from a fixed table so finish order ≠ input order):

1. 12 cases, concurrency 4 vs concurrency 1 with the same fake answers → `JSON.stringify(report.cases)` equal; at most 4 calls are in flight at any time (count in the fake).
2. Finish order differs from input order (assert on `onResult` order) but `report.cases.map(c => c.id)` equals the input order.
3. Fake returns a soft error for every call after case 5, retries 0, concurrency 2 → the run stops issuing after 3 errors in a row in finish order; `complete: false`; no call starts after the stop (count).
4. Budget: `capUsd: 0.001`, every call costs 0.0003 (fixed `callCostUsd`, `firstEstimateUsd: 0.0003`), concurrency 2 → calls 1 and 2 start (0 + 2 × 0.0003 ≤ 0.001); after call 1 ends, call 3 starts (0.0003 + 2 × 0.0003 = 0.0009); after call 2 ends, 0.0006 + 2 × 0.0003 = 0.0012 > 0.001 → stop. Exactly 3 calls, `spentUsd` 0.0009, `cost.stoppedByBudget: true`, `complete: false`.
5. Resume: `done` with 4 results costing 0.0003 each (spent 0.0012), cap 0.0015, concurrency 2 → exactly 1 more call starts (0.0012 + 1 × 0.0003 = 0.0015 ≤ cap; a second would need 0.0018).
6. The old sequential tests in `eval.test.ts` pass unchanged with no `concurrency` and no `budget`.

**Check.** `bun test apps/server/src/modules/triage/eval.test.ts`

**Done when.** Cases 1–6 pass.

**Out of scope.** The report text (stage 14).

## Step 2 — Spend ledger and the state lock

**Goal.** The month cap holds across runs on one machine; two runs never share a state file (D26, plan "Two runs at once").

**Files.** `apps/server/src/scripts/eval-ledger.ts` (new), `eval-ledger.test.ts` (new).

**Interfaces.**

```ts
export const MONTH_CAP_USD = 20;
export const RUN_CAP_USD = 1;
export function defaultLedgerPath(env: { XDG_STATE_HOME?: string; HOME?: string }): string; // <XDG_STATE_HOME or HOME/.local/state>/email-assistant/eval-spend.jsonl
export function monthSpend(ledgerText: string, month: string /* YYYY-MM (UTC) */): number; // sum of usd of lines whose `at` is in the month; bad lines skipped
export function runCap(input: { requested: number; monthSpent: number; monthCap: number }): number; // min(requested, monthCap − monthSpent), never below 0
export function ledgerLine(input: { runId: string; at: Date; usd: number; label: string }): string; // JSON + "\n"; label = "<scenario>-<part>-<model>"
export function acquireStateLock(stateFile: string, now: Date, opts: { fresh: boolean }): () => void; // O_EXCL create `<state>.lock` with the ISO time; a lock older than 6 h is removed only with fresh; returns release()
```

Reading `process.env` for `XDG_STATE_HOME`/`HOME` happens in `scripts/eval.ts`, which passes the values in.

**Decisions.** D26.

**Test.**

1. `monthSpend` of 3 lines (2026-11 $0.4, 2026-11 $0.5, 2026-10 $3) for `2026-11` → 0.9; a broken line is skipped.
2. `runCap({ requested: 1, monthSpent: 19.5, monthCap: 20 })` → 0.5; `monthSpent: 21` → 0.
3. `acquireStateLock` twice on the same file → the second throws an error whose message names the lock path (no other data); after `release()` it works again; a lock dated 7 h before `now` with `fresh: true` is taken over, with `fresh: false` it throws.
4. `defaultLedgerPath({ HOME: "/home/x" })` → `/home/x/.local/state/email-assistant/eval-spend.jsonl`.

**Check.** `bun test apps/server/src/scripts/eval-ledger.test.ts`

**Done when.** Cases 1–4 pass.

## Step 3 — The `--sim` mode of the CLI

**Goal.** `bun run eval --sim <scenario> --part <p>` loads the corpus, runs it with the pool and the caps, and writes state and ledger (D20, D21, D22, D26, D28).

**Files.** `apps/server/src/scripts/eval.ts`, `apps/server/src/scripts/eval-sim-load.ts` (new: corpus → `EvalCase[]`), `eval-sim-load.test.ts`, `evals/README.md` (a "Sim corpora" section with the flags), `docs/capabilities/triage.md` (PD-009, plan fact F19: rule 13 gains `bun run eval --sim <scenario> --part dev|holdout|week` with the worker pool, the $1 run cap and the $20 month cap; keep the "Checked against" line).

**Interfaces.**

```
bun run eval --sim <scenario> --part dev|holdout|week
             [--provider …] [--model …] [--reasoning-effort …] [--concurrency <n, default 8>] [--rpm <n, default 240>]
             [--budget-usd 1] [--spend-ledger <file>] [--fresh] [--fresh-lock] [--limit n] [--out <file.md>]
```

```ts
// eval-sim-load.ts
export async function loadSimCases(input: { root: string; scenario: string; part: SimPart; requireManifest: boolean }): Promise<{
  cases: EvalCase[]; version: string; manifestSha: string | null; audit: "pending" | "done" | "not frozen";
}>;
```

Rules:

1. `--sim` cannot be combined with `--real`, `--set`, `--per-category` (usage + exit 1).
2. `loadSimCases`: reads slots, texts and the manifest through `sim-files.ts`; skips `dropped` texts and week slots with `direction: "sent"`; joins with `toEvalCase` and `htmlBodyText` = `renderSeedMessage` + `bodyTextFromSource` (D21); a week slot with `parentId` gets its parent chain (up to 3 earlier slots of the thread with their texts, oldest first) as `parents` (stage 10). `--part holdout` requires a manifest (exit 1 `holdout needs a frozen corpus: run sim freeze`); dev and week run without one (`audit: "not frozen"`, `version: "draft"`).
3. Before any call: every model of the run (the classifier model) has a price in `llmPrices` (else exit 1 naming the model, D26); ledger month spend → `runCap`; cap 0 → exit 1 `month budget used`.
4. `--rpm <n>` overrides the classifier provider's `rpm` in the role table for this process only (build the table, then copy it with the new `providers[<id>].rpm`). Defaults for `--sim`: `SIM_DEFAULT_CONCURRENCY = 8`, `SIM_DEFAULT_RPM = 240` (so the bare command meets the "under 10 min" exit: 1,417 calls at 240 per minute ≈ 6 min; the account limit is plan N1). An explicit `--rpm` wins. The old `bun run eval` keeps the config rpm and concurrency 1.
5. State file: `evals/.runs/<evalStateFileName({ model, reasoningEffort, promptVersion, set: "sim-<scenario>-v<version>-<part>" })>`; lock it with `acquireStateLock`; release in `finally`.
6. After the run (also after a stop or an error): append one ledger line with the run's new spend (not the spend of `done` results).
7. The report is today's renderer for now (stage 14 extends it); a holdout run sets a flag `hideIds: true` on the report options that stage 14 uses (D28): pass it already.
8. Exit code: `evalExitCode` as today (2 when not complete).

**Decisions.** D20, D21, D22, D26, D28.

**Test** (unit, `eval-sim-load.test.ts`, the stage 11 fixture corpus with texts written by the helper):

1. `loadSimCases(part: "dev")` → one case per non-dropped dev text, ids in sorted order, each parses with `evalCaseSchema`, `sim.part: "dev"`.
2. `part: "holdout"` without a manifest → throws with the message `holdout needs a frozen corpus: run sim freeze`.
3. A week fixture with a `sent` slot → that slot is not in the cases; a week reply's case has the parent's subject in `thread[0]`.
4. An html slot → `body` contains the text of its `<p>` (real `bodyTextFromSource`).

CLI args (extend the existing arg tests if any, else in `eval-sim-load.test.ts` through the exported parser): `--sim lab-01 --real` → usage error; `--sim lab-01` without `--part` → usage error; `--sim lab-01 --part dev` → concurrency 8 and rpm 240; `--rpm 100` → 100; the old mode without `--sim` → concurrency 1 and no rpm override.

**Check.** `bun test apps/server/src/scripts/eval-sim-load.test.ts apps/server/src/scripts/eval-ledger.test.ts apps/server/src/modules/triage/eval.test.ts`

**Done when.** All cases pass. No real LLM call in this stage.

**Out of scope.** The report sections, the gate file, the judge (stages 14, 16).
