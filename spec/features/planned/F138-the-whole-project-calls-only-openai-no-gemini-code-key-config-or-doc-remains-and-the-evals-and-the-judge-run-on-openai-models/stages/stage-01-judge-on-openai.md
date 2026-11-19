# F138 stage 01 — Judge on OpenAI

Part of [`../plan.md`](../plan.md). `[risky]` (LLM evals). Needs the F115 stage 02 branch landed on master.

The judge may run on the same provider as the model under test, but never on the same model. Gemini still exists in this stage; stage 02 removes it.

## Step 1 — Judge rule and default judge

- **Goal:** a `--judge` run (sim classifier run and `--drafter` run) works with drafter or classifier `gpt-6-luna` and judge `gpt-6.1-terra`, both on `openai`, with no `--judge-*` flag and no `LLM_JUDGE_*` key.
- **Files:** `apps/server/src/scripts/eval-judge-setup.ts`; the judge row of `llmRoleTable` in `apps/server/src/platform/config-llm.ts`.
- **Interfaces:**
  - `JUDGE_SAME_MODEL = "judge model must differ from the model under test (ADR 0037)"` (exported). `JUDGE_SAME_PROVIDER` and `JUDGE_SAME_PROVIDER_DRAFTER` are removed.
  - `judgeSetupError(table, at, role: JudgedRole = "classifier")` keeps its signature. Order of checks: same model → key missing → no price.
  - `DEFAULT_JUDGE_MODEL = "gpt-6.1-terra"` (exported from `config-llm.ts`).
- **Decisions:** D3, D4. "Same model" = same provider and same model id; the effort does not count. The default judge row applies only when no `LLM_JUDGE_*` key is set: provider = the classifier's provider, model `DEFAULT_JUDGE_MODEL`, effort `none`, timeout = the provider's, role rpm null. `LLM_JUDGE_MODEL` without `LLM_JUDGE_PROVIDER` stays an error (today's rule). `--judge-provider` and `--judge-model` still override per run.
- **Test (unit):**
  1. Classifier `openai/gpt-6-luna`, judge `openai/gpt-6.1-terra`, key set → `null`.
  2. Classifier `openai/gpt-6-luna` effort `none`, judge `openai/gpt-6-luna` effort `high` → `JUDGE_SAME_MODEL`.
  3. Role `drafter` `openai/gpt-6-luna`, judge `openai/gpt-6-luna` → `JUDGE_SAME_MODEL`, and no call runs (the existing fake-LLM harness test of the drafter run, exit 1).
  4. Judge `openai/gpt-6.1-terra` on an `eu` endpoint → the "no price" message (no `eu` row).
  5. Env with only `OPENAI_API_KEY` set → `table.roles.judge` = `{ provider: "openai", model: "gpt-6.1-terra", reasoningEffort: "none", rpm: null }`.
  6. Env `LLM_JUDGE_PROVIDER=openai`, `LLM_JUDGE_MODEL=gpt-6-luna` with the classifier on `gpt-6-luna` → config parses; `judgeSetupError` gives `JUDGE_SAME_MODEL`.
- **Done when:** tests 1–6 pass; the old "provider must differ" tests are rewritten to the model rule, not deleted.
- **Out of scope:** the Gemini adapter, the judge prompt (D14).

## Step 2 — Judge model in the state key

- **Goal:** a resumed judged run never reuses grades of another judge model (D5).
- **Files:** the state-name function in `apps/server/src/modules/triage/eval-results.ts` and its callers in the sim and drafter runs.
- **Decisions:** a run with `--judge` adds `-judge-<judge model>` (same character rule as the model part) before the endpoint suffix. A run without `--judge` keeps today's name, so no old classifier state changes name.
- **Test (unit):**
  1. Model `gpt-6-luna`, effort `low`, prompt `drafter-v1`, judge `gpt-6.1-terra` → the name holds `-judge-gpt-6.1-terra` and ends in `.jsonl`.
  2. The same options without a judge → today's name (compare with a fixed string from the current code).
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
- **Docs:** `evals/README.md` lines on `--judge`, `--judge-provider`, `--judge-rpm` and the judge rule say the new rule (no ADR link check: ADR 0037 comes in stage 05).

## Check

`bun test apps/server/src/scripts apps/server/src/modules/triage apps/server/src/modules/replies apps/server/src/platform`

## Done when

All tests above pass, and the Proof (`plan.md` § Proof, `sNN` = `s01`) prints `PROOF_OK`.
