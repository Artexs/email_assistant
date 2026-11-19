# F141 stage 04 — the role table from tiers, removed keys refused `[risky]`

Needs stage 03: the server registry rows (`envPrefix`, `defaults`) and the deepseek block in `config-llm.ts`. Needs step C-env (`plan.md`): the main `.env` holds no removed key with a value, else this stage's own `test:int:ci` fails. Needs stage 02: `llmRoleModels`, `tierModel`, `providerEffort`, `llmEffortLevels`.

Part of [`../plan.md`](../plan.md). Decisions: P1, P5, P6, D6, D7. Risky: config, LLM spend, production models. Review job before the land; owner checkpoint after it. Its release needs owner step O1 before the deploy.

## Step 1 — one provider, tiers, role efforts

- **`llmRoleTable(config, overrides)`:** keep its signature and `LlmRoleOverride` (`provider?`, `model?`, `reasoningEffort?`); stage 05 changes the callers.
  - Provider of each role: `overrides[role].provider ?? LLM_PROVIDER`.
  - Model: `overrides[role].model ??` the own model (step 2) `??` `tierModel(provider, llmRoleModels[role].tier)`.
  - Effort: `overrides[role].reasoningEffort ?? providerEffort(provider, llmRoleModels[role].effort)`; an own endpoint gets `null`; an override effort on a provider with effort `"none"` throws `ConfigError(["reasoningEffort"])`.
  - Timeout: `LLM_<ROLE>_TIMEOUT_MS ?? <P>_TIMEOUT_MS`. Rate: `LLM_<ROLE>_RPM ?? null`. The classifier has no role keys. Role keys apply also after an override moves the role.
- **Judge (D7):** remove `DEFAULT_JUDGE_MODEL` and its special case; the judge is the `strong` tier. Keep `JUDGE_SAME_MODEL` and `judgeSetupError`. Fix the tests that import the constant.
- `openAiReasoningEfforts` goes; callers use `llmEffortLevels`.

## Step 2 — the own endpoint model (P6)

- New key `OPENAI_OWN_MODEL` (optional string, empty = unset). It is read only when the openai endpoint is `own`; then every role on openai uses it. When `LLM_PROVIDER=openai`, the endpoint is own and the key is unset: a config issue on `OPENAI_OWN_MODEL`, `"needed for an own endpoint"`. A tool override to openai on an own endpoint without it throws `ConfigError(["OPENAI_OWN_MODEL"])`.
- `docs/own-model.md` § 4, `.env.example`: `OPENAI_OWN_MODEL` replaces `OPENAI_MODEL_CLASSIFIER`.

## Step 3 — removed keys (D6, P5)

- The keys of D6. The provider ones are listed in their registry row (`removedEnvKeys`), the role ones in config.
- They stay in the schema as optional strings so Zod does not drop them. A non-empty value adds an issue on the key: `"removed: every role uses the tiers of LLM_PROVIDER (F141); delete this line"`. An empty value passes.
- `.env.example`: remove these lines (three hold values at the base) and the role-key comment block; keep `LLM_<ROLE>_TIMEOUT_MS`, `LLM_<ROLE>_RPM`.
- **E2E pin** (`E2E_LLM_PIN` in `e2e-seed-args.ts`): it sets every D6 key and `OPENAI_OWN_MODEL` to `""`, so a developer `.env` cannot reach the e2e server with a removed key. Update `e2e-gate-fixture.test.ts` with it.

## Test

1. Env with only `LLM_PROVIDER=openai`, `OPENAI_API_KEY=k`, `TRIAGE_LLM_SCOPE=synthetic` (plus the non-LLM keys the config tests already set): classifier `gpt-6-luna`/`none`, drafter `gpt-6-luna`/`low`, extractor `gpt-6-luna`/`none`, judge `gpt-6.1-terra`/`none`; all timeouts 30000; rates null.
2. The same for `gemini` with `GEMINI_API_KEY`: three roles `gemini-3.5-flash-lite`, judge `gemini-3.8-flash`, every effort `null`.
3. The same for `deepseek`: `deepseek-flash` with `none`/`low`/`none`, judge `deepseek-v4-pro`/`none`.
4. Table-driven, one case per removed key: value `"x"` fails, the error keys hold that key, the message does not hold `"x"`.
5. `OPENAI_MODEL_CLASSIFIER=""` and `LLM_JUDGE_MODEL=""`: config loads. The config built from the e2e pin over an env with `OPENAI_MODEL_CLASSIFIER=gpt-6-luna` loads.
6. `OPENAI_BASE_URL=http://127.0.0.1:11434/v1`, `OPENAI_OWN_MODEL=gemma3:12b`: four roles `gemma3:12b`, effort `null`. Without `OPENAI_OWN_MODEL`: fails on `OPENAI_OWN_MODEL`.
7. `LLM_JUDGE_RPM=5`, `LLM_DRAFTER_TIMEOUT_MS=90000`: judge rate 5, drafter timeout 90000.
8. Override `{ drafter: { provider: "gemini" } }` with `LLM_PROVIDER=openai` and both keys: drafter `gemini-3.5-flash-lite`, effort `null`.
9. Override `{ judge: { reasoningEffort: "low" } }` on gemini throws `ConfigError`.
10. `judgeSetupError` on the table of case 1: null. With override `{ classifier: { model: "gpt-6.1-terra" } }`: `JUDGE_SAME_MODEL`. On the own table of case 6: `JUDGE_SAME_MODEL`.
11. The evidence key and Telegram status line tests pass unchanged.

## Check

`bun test apps/server/src/platform apps/server/src/scripts apps/server/src/modules/triage`

## Done when

- Tests 1–11 pass; test fixtures that set a removed key now set none.
- `docs/capabilities/triage.md`, `reply-drafts.md` (the drafter model is the `light` tier with `low`, no `LLM_DRAFTER_*`) and `open-loops.md` name the tiers.
- The stage-01 allowlist lost the entries of the sites this stage removed.
- The Proof command of `plan.md` prints `PROOF_OK` after the last commit.

## Out of scope

Flag meaning of the eval and `llm:check` tools (stage 05). Moving the openai endpoint keys into the row (stage 07). The `provider` field of call rows (stage 06).
