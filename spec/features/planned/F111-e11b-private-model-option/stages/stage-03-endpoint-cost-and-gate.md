# F111 stage 03 — Cost and gate evidence know the endpoint

Part of [`../plan.md`](../plan.md). Review before the land (money: every cost reader changes). Needs stage 02 (`LlmEndpointKind`, `LlmUsage.endpoint`, `LlmClient.endpointOf`).

## Step 1 — The audit row and the price table

**Goal.** Each LLM call is priced by its endpoint (D6, D7).

**Files.** `modules/audit/repo.ts`, the triage service that records calls (success and error branch), `packages/core/src/triage/cost.ts`, `packages/core/src/metrics/m7.ts` and its repo, `modules/operator/service.ts` (`llmToday`), `scripts/triage-cost.ts`.

**Interfaces.**
- `LlmCallRecord.endpoint: LlmEndpointKind`; `llm.call` data key `endpoint`, always written: from `usage.endpoint`, or `endpointOf(role)` on the error branch. No migration (JSON data).
- `LlmPrice.endpoint?: "eu"`; `costPerMail(model, tokensIn, tokensOut, at, endpoint: LlmEndpointKind = "standard"): number | null`.
- `sumLlmCallsByModelSince` groups by model and endpoint and returns `endpoint`; `LlmCallRow.endpoint` (m7). A missing data key reads `standard`.
- EU row `gpt-6-luna`: `{ inputPerM: 0.11, outputPerM: 0.55, endpoint: "eu", source: "E11 discovery notes §6 (opsware.co 2026-10-16, secondary)", checked: "2026-11-13" }`.

**Test.**
1. `costPerMail("gpt-6-luna", 1e6, 1e6, 2026-11-15)` = 0.6 (no endpoint argument: as today); with `"eu"` = 0.66 (`toBeCloseTo`, 10 digits); with `"own"` = 0; `costPerMail("no-such-model", 10, 10, at, "own")` = 0.
2. `costPerMail("gemini-3.8-flash", 1, 1, at, "eu")` = `null`.
3. A row with `from` and `endpoint: "eu"` is picked only for `eu`, only on or after `from`.
4. Integration: an error-branch `llm.call` row of an `own` table has `endpoint` `own`.
5. Integration: two rows of one org today, `gpt-6-luna`, 1,000 in / 1,000 out, one `standard`, one `eu` → `llmToday` cost 0.0006 + 0.00066, `unpricedCalls` 0. An `eu` row of org B does not reach org A.
6. Integration: a row in the old shape (no `endpoint`) groups as `standard`.
7. `unitCost` with one `own` row of 1,000,000 tokens → `llmUsdWeek` 0, `unpricedCalls` 0.
8. `triage:cost` (its pure part) prices the two rows of case 5 at their own rates and prints the endpoint per line.

**Done when.** Cases 1–8 pass.

## Step 2 — Eval runs and gate files

**Goal.** A holdout run on a non-standard endpoint has its own state and evidence (D8), and an `own` run has no USD budget (D12).

**Files.** `modules/triage/eval-sim-report.ts`, `modules/triage/eval.ts` (`evalStateFileName`), `eval-pool.ts`, `eval-report.ts` (price line), `scripts/eval-sim.ts`, `gate-evidence.test.ts`, `evals/README.md`.

**Interfaces.**
- `gateFileSchema` gains `endpoint: z.enum(["standard", "eu", "own"]).default("standard")` and `host: z.string().nullable().default(null)`.
- `gateFileName({ …, endpoint })` and `evalStateFileName({ …, endpoint })`: unchanged for `standard`; else `-<endpoint>` before the extension.
- `own` run: no `EvalBudget` (no cap, no price check, ledger line $0). `firstEstimateUsd` keeps its "above zero" rule for `standard` and `eu`.
- The run line and the report header print `endpoint=<kind> host=<host>`; the report's price line shows the row of the run's endpoint, or "own endpoint: cost 0".

**Test.**
1. `gateFileName` for `standard` gives today's stage 21 name `classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json`; for `eu` the same with `-eu.json`; for `own`, model `SpeakLeash/bielik-11b-v3.1:Q4_K_M` and effort `null` → the `safe` model, `default`, and `-own.json`.
2. `evalStateFileName` for `standard` is unchanged; `eu` and `own` names differ from it.
3. The committed gate file (no `endpoint` key) parses as `standard`, `host` `null`.
4. `gate-evidence.test.ts` passes only with a `standard` file for the current prompt version: an `-own.json` file alone fails it (check with a temp folder).
5. A `standard` run of a model with no price row is refused (as today); an `own` run of the same model starts and charges 0.
6. A price of 0 on `standard` is still refused (the guard stays).
7. An `own` report has `endpoint=own host=127.0.0.1`, no path or port, and the "own endpoint: cost 0" price line; an `eu` report shows the EU row's source.

**Done when.** Cases 1–7 pass; `evals/README.md` says how to run against `OPENAI_BASE_URL` (shell variable before `bun run eval`, F4) and that a gate file proves one model on one endpoint.

## Step 3 — Seam lines

**Files.** `docs/capabilities/measurement.md` (cost by endpoint), `docs/capabilities/triage.md` (gate file per model and endpoint).

**Done when.** Both pages name the rule; the final message names the F110 seam: a gate-file reader matches `model` and `endpoint`, and re-gates `auto` on a switch (D13).

## Proof

The Proof of `plan.md` with `NN` = `03`.
