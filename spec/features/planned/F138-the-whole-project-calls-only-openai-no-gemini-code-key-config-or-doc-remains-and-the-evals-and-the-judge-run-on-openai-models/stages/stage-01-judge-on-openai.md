# F138 stage 01 — Judge on OpenAI

Landed: 0d9edf6e, 334de262. A record; do not build it again.

Part of [`../plan.md`](../plan.md). `[risky]` (LLM evals).

The judge may share the provider of the model under test, never the model. Gemini still exists here; stage 02 removes it.

## Step 1 — Judge rule and default judge

- **Goal:** a `--judge` run (sim or `--drafter`) works with `gpt-6-luna` under test and judge `gpt-6.1-terra`, both on `openai`, with no judge flag or key.
- **Files:** `apps/server/src/scripts/eval-judge-setup.ts`; the judge row of `llmRoleTable` in `apps/server/src/platform/config-llm.ts`.
- **Interfaces:**
  - `JUDGE_SAME_MODEL = "judge model must differ from the model under test (ADR 0037)"` (exported). `JUDGE_SAME_PROVIDER` and `JUDGE_SAME_PROVIDER_DRAFTER` are removed.
  - `judgeSetupError(table, at, role: JudgedRole = "classifier")` keeps its signature. Order of checks: same model → key missing → no price.
  - `DEFAULT_JUDGE_MODEL = "gpt-6.1-terra"` (exported from `config-llm.ts`).
- **Decisions:** D3, D4. "Same model" = same provider and same model id string; effort does not count. The trigger of the default is only the model: when neither `LLM_JUDGE_MODEL` nor `--judge-model` is set, the model is `DEFAULT_JUDGE_MODEL`, whatever other judge key or flag is set (`_PROVIDER`, `_RPM`, `_REASONING`, `_TIMEOUT_MS`, `--judge-provider`). Effort: `LLM_JUDGE_REASONING`, else `none`. Provider: the judge key or flag, else the classifier's. `LLM_JUDGE_MODEL` without `LLM_JUDGE_PROVIDER` stays an error.
- **Text (N5):** every usage text and comment that says the judge needs another provider (`eval-args.ts`, `eval-drafter.ts`, `eval-sim.ts`) states the model rule.
- **Test (unit):**
  1. Classifier `openai/gpt-6-luna`, judge `openai/gpt-6.1-terra`, key set → `null`.
  2. Classifier `openai/gpt-6-luna` effort `none`, judge `openai/gpt-6-luna` effort `high` → `JUDGE_SAME_MODEL`.
  3. Role `drafter` `openai/gpt-6-luna`, judge `openai/gpt-6-luna` → `JUDGE_SAME_MODEL`, exit 1, no call (fake-LLM drafter harness).
  4. Judge `openai/gpt-6.1-terra` on an `eu` endpoint → the "no price" message (no `eu` row).
  5. Env with only `OPENAI_API_KEY` → judge `{ provider: "openai", model: "gpt-6.1-terra", reasoningEffort: "none", rpm: null }`; with `LLM_JUDGE_RPM=20` only → the same model, rpm 20.
  6. Env `LLM_JUDGE_PROVIDER=openai`, `LLM_JUDGE_MODEL=gpt-6-luna`, classifier `gpt-6-luna` → config parses; `JUDGE_SAME_MODEL`.
  7. Env `LLM_JUDGE_PROVIDER=openai` only → judge model `gpt-6.1-terra`. Drafter run args `--judge-provider openai` with no `--judge-model` → judge model `gpt-6.1-terra`.
  8. Drafter run args `--model gpt-6.1-terra --judge` → `JUDGE_SAME_MODEL`, exit 1, no call.
- **Done when:** tests 1–8 pass; the old "provider must differ" tests are rewritten to the model rule, not deleted.
- **Out of scope:** the Gemini adapter, the judge prompt (D14).

## Step 2 — Judge model in the state key

- **Goal:** a resumed judged run never reuses grades of another judge model (D5).
- **Files:** the state-name function in `apps/server/src/modules/triage/eval-results.ts` and its callers in the sim and drafter runs.
- **Decisions:** a run with `--judge` adds `-judge-<judge model>` (same character rule as the model part) before the endpoint suffix. A run without `--judge` keeps today's name, so no old classifier state changes name.
- **Test (unit):**
  1. Model `gpt-6-luna`, effort `low`, prompt `drafter-v1`, judge `gpt-6.1-terra` → the name holds `-judge-gpt-6.1-terra` and ends in `.jsonl`.
  2. The same options without a judge → today's name (a fixed string).
  3. Two names that differ only in the judge model are different.
  4. Drafter run (fake LLM): a state file under the old name (no judge part) with 1 graded case exists; a judged run grades that case again (2 judge calls for 2 cases, not 1).

## Step 3 — Rates on one provider

- **Goal:** D6. `--judge-rpm` limits only the judge role when the judge shares the provider of the model under test.
- **Files:** `simRoleTable` in `eval-judge-setup.ts`.
- **Decisions:** `--rpm n` sets `providers[<role provider>].rpm`. `--judge-rpm m` sets `roles.judge.rpm = m` and leaves every provider rate unchanged. Without `--judge-rpm`, the judge role keeps `LLM_JUDGE_RPM` or null.
- **Test (unit):**
  1. `{ rpm: 60, judge: true, judgeRpm: 8 }`, judge on `openai` → `providers.openai.rpm` 60, `roles.judge.rpm` 8, `roles.drafter.rpm` unchanged.
  2. `{ rpm: 60, judge: true }` with `judgeRoleRpm: 20` → `roles.judge.rpm` 20.
  3. `{ rpm: 60, judge: false, judgeRpm: 8 }` → no judge change.
- **Docs:** `evals/README.md` states the new judge rule and the `--judge-rpm` rule (ADR 0037 comes in stage 04).

## Check

`bun test apps/server/src/scripts apps/server/src/modules/triage apps/server/src/modules/replies apps/server/src/platform`

## Done when

All tests above pass, and the Proof (`plan.md` § Proof, `sNN` = `s01`) prints `PROOF_OK`.
