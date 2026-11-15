# F111 stage 03 — Cost and gate evidence know the endpoint

Part of [`../plan.md`](../plan.md). Review before the land (money: every cost reader changes). Needs stage 02 (`LlmEndpointKind`, `LlmUsage.endpoint`).

## Step 1 — The audit row and the price table

**Goal.** Each LLM call is priced by its endpoint (D6, D7).

**Files.** `apps/server/src/modules/audit/repo.ts` (`recordLlmCall`, `sumLlmCallsByModelSince`), the triage service that records calls, `packages/core/src/triage/cost.ts`, `packages/core/src/metrics/m7.ts` and the repo that feeds it, `modules/operator/service.ts` (`llmToday`), `scripts/triage-cost.ts`.

**Interfaces.**
- `LlmCallRecord.endpoint: LlmEndpointKind`; `llm.call` data key `endpoint`, always written. No migration (the data column is JSON).
- `LlmPrice.endpoint?: "eu"`.
- `costPerMail(model: string, tokensIn: number, tokensOut: number, at: Date, endpoint: LlmEndpointKind = "standard"): number | null`.
- `sumLlmCallsByModelSince` groups by model and endpoint and returns `endpoint` (missing in data → `standard`).
- `LlmCallRow.endpoint: LlmEndpointKind` (m7); a reader maps a missing key to `standard`.
- EU price row for `gpt-6-luna`: `{ inputPerM: 0.11, outputPerM: 0.55, endpoint: "eu", source: <opsware URL, secondary>, checked: "2026-11-15" }`.

**Decisions.** D6, D7.

**Test.**
1. `costPerMail("gpt-6-luna", 1_000_000, 1_000_000, 2026-11-15)` = 0.6 (no endpoint argument: same as today).
2. Same with `"eu"` = 0.66 (compare with `toBeCloseTo`, 10 digits).
3. Same with `"own"` = 0; also `costPerMail("no-such-model", 10, 10, at, "own")` = 0.
4. `costPerMail("gemini-3.8-flash", 1, 1, at, "eu")` = `null` (no EU row).
5. A row with `from` and `endpoint: "eu"` is picked only for `eu` and only on or after `from`.
6. Integration: two `llm.call` rows of one org today, `gpt-6-luna`, 1,000 in / 1,000 out each, one `standard`, one `eu`; `llmToday` cost = 0.0006 + 0.00066; `unpricedCalls` 0.
7. Integration: a row written with the old shape (no `endpoint` key) is grouped as `standard`.
8. `unitCost` with one `own` row of 1,000,000 tokens: `llmUsdWeek` 0, `unpricedCalls` 0.
9. Tenant filter: an `eu` row of org B does not reach org A's `llmToday`.

**Done when.** Cases 1–9 pass; `triage:cost` prints the endpoint next to each model line.

## Step 2 — Eval runs and gate files

**Goal.** A holdout run against a non-standard endpoint writes its own evidence (D8), and a priced own model runs without a price row (D7).

**Files.** `apps/server/src/modules/triage/eval-sim-report.ts` (`gateFileSchema`, `buildGateFile`, `gateFileName`, the report header), `scripts/eval-sim.ts` (the run line, the price check, the cost), `modules/triage/eval.ts` and `eval-pool.ts` (cost callers), `evals/README.md`.

**Interfaces.**
- `gateFileSchema` gains `endpoint: z.enum(["standard", "eu", "own"]).default("standard")`.
- `gateFileName({ …, endpoint: LlmEndpointKind })`: unchanged string for `standard`; else `…-v<version>-<endpoint>.json`.
- The run line and the report header print `endpoint=<kind> host=<host>`.

**Decisions.** D7, D8, D10.

**Test.**
1. `gateFileName` with `standard` gives today's name for the stage 21 file: `classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json`.
2. With `eu` → `classifier-classifier-v2-gpt-6-luna-none-lab-01-v1-eu.json`; with `own` and model `SpeakLeash/bielik-11b-v3.1:Q4_K_M` → the `safe` form of the model and `-own.json`.
3. The committed gate file in `evals/results/gate/` (no `endpoint` key) parses and reads `standard`; `gate-evidence.test.ts` still passes.
4. The run refuses a model with no price row on `standard` (as today) and starts for the same model on `own` (first estimate 0).
5. A report built for an `own` run has the line `endpoint=own host=127.0.0.1` and no path or port.

**Done when.** Cases 1–5 pass; `evals/README.md` says how to run the holdout against `OPENAI_BASE_URL` (shell variable before `bun run eval`, plan F4) and that a gate file proves one model and endpoint.

## Step 3 — Seam lines

**Goal.** Readers built later match the endpoint (D8).

**Files.** `docs/capabilities/measurement.md` (cost by endpoint), `docs/capabilities/triage.md` (gate file per model and endpoint).

**Done when.** Both pages name the rule. The final message names the F110 seam: a reader of gate files matches `model` and `endpoint`.

## Proof

The Proof of `plan.md` with `NN` = `03`.
