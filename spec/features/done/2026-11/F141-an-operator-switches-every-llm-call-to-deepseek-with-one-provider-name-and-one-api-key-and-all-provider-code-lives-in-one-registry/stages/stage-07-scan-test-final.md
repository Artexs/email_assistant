# F141 stage 07 — openai endpoint keys into the row, scan test final

Needs stage 05: the tools on the new flags. Needs stage 06: `providerOf` (its sites leave the allowlist). Needs stage 01: `provider-scan.test.ts`.

Part of [`../plan.md`](../plan.md). Decisions: D2, D11.

## Step 1 — the openai row owns its endpoint keys

- **Goal:** `config-llm.ts` names no provider. A new provider is one core catalog row plus one server row.
- **Interface:** the server row gets
  - `envShape`: the extra env keys of the provider (openai: `OPENAI_BASE_URL`, `OPENAI_ENDPOINT_KIND`, `OPENAI_OWN_API_KEY`, `OPENAI_OWN_MODEL`; others: none). Config spreads the shapes of all rows.
  - `check(config, ctx)`: the always-run checks of the row (openai: the base URL check, also with scope `off`; the own-model rule of stage 04).
  - `settings(config)`: the `LlmProviderSettings` of the row (key name and key, rate, timeout, base URL, endpoint kind, own model or null).
  - `removedEnvKeys` (from stage 04) stays on the row.
- `platform/llm/endpoint.ts` moves into `providers/` (it is OpenAI host logic). Its rules and messages do not change.
- No behaviour change: the config tests of stages 03 and 04 pass as they are.

## Step 2 — the scan test final

- `ALLOWED_SITES` holds only the permanent exceptions, each with its reason. Expected, exactly: `packages/core/src/legal/subprocessors.ts` (legal rows, owner: no change), `apps/server/src/platform/outside-services.ts` (a hand list: each outside key is a decision), `e2e-seed-args.ts` (the e2e pin of empty removed keys), `packages/core/src/metrics/cost-model.ts` (`pilotCost.models`, measured record). The web legal texts are `.md` and are not scanned. A comment-only match (at the base: `platform/llm/settings.ts`, `scripts/eval-config.ts`) is reworded to name the registry, not listed. Any other exception needs its reason in the final message.
- Add a registry test: for each id of `llmProviderIds`, the config shape has `<P>_API_KEY`, `<P>_TIMEOUT_MS`, `<P>_RPM`, and the server row exists.

## Step 3 — the decision record

- `docs/decisions/0015-llm-provider-switch.md`: an amendment dated the day of the land: one `LLM_PROVIDER` for every role, tiers per provider row, the DeepSeek row (dev, tests, evals; refused with `TRIAGE_LLM_SCOPE=all`), the removed keys, `OPENAI_OWN_MODEL`. Link this ticket folder.
- `docs/code-patterns.md`: the LLM line says a role names a tier and `LLM_PROVIDER` picks the provider row.
- `audit.md` (this ticket folder): an "After" section with the scan result and the exception list.

## Test

1. The scan test passes; no `ALLOWED_SITES` reason starts with `old site`.
2. The registry test of step 2 passes for `openai`, `gemini`, `deepseek`.
3. `OPENAI_BASE_URL=https://api.deepseek.com` without `OPENAI_ENDPOINT_KIND=own` still fails with the old message.
4. The config, endpoint and role-table tests of stages 03–04 pass unchanged.

## Check

`bun test apps/server/src/platform`

## Done when

- Tests 1–4 pass. `config-llm.ts` has no scan match (the scan test is the acceptance).
- The Proof command of `plan.md` prints `PROOF_OK` after the last commit.

## Out of scope

Legal texts and sub-processor rows. The own-model rules of F140.
