# F111 plan refresh 1 (2026-11-15)

- Old base: `2e2451be` (2026-11-15 02:32).
- New base: `7f4cd964` (HEAD, 2026-11-15 03:05).

## Drift output

```
$ scripts/plan-drift.sh spec/features/planned/F111-e11b-private-model-option 2e2451be
plan base: 2e2451be 2026-11-15 02:32
HEAD:      7f4cd964 2026-11-15 03:05
named paths: 13; changed since base: 0; gone: 0
no drift
```

The script reads only full paths (`apps/…`, `scripts/…`). The stages name most eval files by short path (`scripts/eval-sim.ts`, `modules/triage/eval.ts`), so the script missed them. Manual check: `git diff 2e2451be HEAD -- apps/server/src/scripts apps/server/src/modules/triage bun.lock`. Changed paths that the plan uses:

- `apps/server/src/scripts/eval-args.ts`, `eval-sim.ts`, `eval.ts`, new `eval-extras.ts`: F109 stage 08 (`23470afb`) adds `--prompt-version` and `--prompt-parts`, `resolvePrompt`, the extras of v3; the state file name takes `promptLabel(options.prompt)`. F103 stage 04 (`c632f119`, `9a91121a`) moves the scripts from `createLog` to `createCliOutput` (`cli.print`, `cli.fail`) and adds `runClassifier(options, deps)` in `eval.ts`.
- `apps/server/src/modules/triage/eval-sim-report.ts`, `eval.ts`, `eval-report.ts`, `prompts/`: F109 stage 08 adds the optional `promptParts` field to `gateFileSchema` (`buildGateFile` writes it for v3), `promptLabel`, `productionClassifierChoice`, `classifierV3Parts`, `optionalParts` (it never lists `attachments`).
- `apps/server/src/scripts/triage-cost.ts`: F103 stage 04, `createCliOutput` only.
- `bun.lock`: F102 stage 01 (`fea716e8`) adds `hono-openapi` 1.6.0. `openai` stays 7.53.0.
- F109 stage 05 (`--suspicious`) and F112 stage 01 (server image, `803afd40`, `904d800b`) are in the old base already. They change no F111 path.

## Changes

- plan.md status line: new base, refreshed date.
- plan.md D8: the gate file holds `endpoint` and `host` next to F109's optional `promptParts`. The state file name keeps `promptLabel` and adds the endpoint. The gate file name keeps F109 stage 11 naming (prompt version, no parts) and adds the endpoint. Rejected: parts in the gate name (it renames the file that F109 stage 11 names). Why: F109 stage 08 changed both names and the schema after the base.
- plan.md F3: the eval flags at HEAD; `--suspicious` and `--gap` read no LLM config. Facts heading now names base `7f4cd964`. Why: the flags changed.
- plan.md: shorter wording in Not verified, Rules, Owner steps, Review, How to run. Why: plan.md stays at 1,500 words. No decision changed.
- Stage 02 case 12 (new; decision fixed after review 2): a bad `OPENAI_BASE_URL` stops `eval --sim` with the key name, not the value; `eval --suspicious` still runs. Why: `runSim` calls `loadConfig` outside its `try`, and `main` prints only the error name; `--suspicious` has no LLM.
- Stage 02: shorter wording (Files, cases 2, 3, Done when). Why: 700-word limit.
- Stage 03 Step 2 Files: `runClassifier` in `scripts/eval.ts` also names a state file and gets the endpoint; `--suspicious` and `--gap` get none. Why: F103 split `runClassifier` out of `main`.
- Stage 03 Interfaces: `gateFileName` (version, no parts) and `evalStateFileName` (`promptLabel`) add `-<endpoint>`; `promptParts` stays. Why: F109 stage 08.
- Stage 03 tests: case 2 adds a v3 label (`classifier-v3[history,urgency]` + `own`); new case 2a (a v3 `own` gate file with `promptParts` `["urgency"]`); case 4 says the gate-evidence test reads only files without an endpoint suffix. Why: same.
- Stage 05: no `--prompt-version` or `--prompt-parts`, so the gate file proves the production prompt; the report name uses the production `promptLabel`, not a fixed `classifier-v2`; test 1 checks `promptVersion` and `promptParts`; the baseline is the `standard` gate file of the same prompt version (stop if none). Why: F109 stage 11 may move production to v3 before stage 05 runs.
- Stage 07 A2: the same prompt rule and names as stage 05; the gate file name follows the production version. Why: same.

## Checked, no change needed

- `scripts/llm-check.ts`, `main.ts` `llm_settings`, `configHint`, `uniformRoleTable`, `LlmProviderSettings`, `createGenerate`, `openAiClientOptions`, `LlmUsage`, `LlmCallRecord`, `sumLlmCallsByModelSince`, `llmToday`, `unitCost`, `LlmCallRow`, `firstEstimateUsd`: present at HEAD, as the plan names them.
- `OUTSIDE_SERVICE_KEYS` and `endpointOf`: still absent (F107 not landed; stage 02 creates `endpointOf`). D14 stays a conditional seam.
- `evals/results/gate/` holds only `classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json`: stage 03 case 1 stays true.
- No landed ticket did a step of this plan. No migration and no `bun.lock` change are needed.
- Stages 01, 04, 06: no named path or interface changed (stage 06 got one review-2 line).

## Changes from cold review 2

Review job `2026-11-15-f111-plan-review-2-refresh-463fee8a` (Opus 5.5, high; candidate `1fed167c`): FAIL, 1 blocking, 4 notes. File: `plan-review-2.md`. All five fixed, none rejected.

- B1, stage 02 case 12: decision written. `runSim`, `runClassifier` and `runReal` catch the `ConfigError` of `loadConfig`, print `config error: <keys>`, exit 1. The test sets every other key valid, so only `OPENAI_BASE_URL` shows. The eval CLI is in the stage Files.
- N2, stage 05: before model two, the worker compares the production prompt label with model one's run; a change is a stop and a question. Stage 06 item 6: the guide names the prompt label of its numbers, and says when production moved since stage 05.
- N3, stage 03 Step 2 goal and Done when: an explicit `--state` path gets no endpoint suffix; `evals/README.md` states it.
- N4, stage 03 case 4: the gate-evidence test still parses every gate file; it counts only files without an endpoint suffix as evidence.
- N5, stage 02 case 12: a bad URL also stops `eval --real`; intended, as case 10.
- Process note: the word counts are back in plan.md § Planning progress. plan.md § Cold review now has the review-1 map as a commit pointer (`a3e382a7`) and a review-2 line.

## Words after the refresh

plan 1480; stages 657, 700, 700, 368, 694, 643, 700 (`wc -w`).

## Cold review

One review ran, because stage 03 states an interface in a new way (the gate and state names next to `promptParts`) and stage 05 has a new rule. Verdict FAIL, fixed above.
