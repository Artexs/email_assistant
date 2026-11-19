# F141 notes — map for the planner (facts at `c7b4f058`, 2026-11-20)

## Seams

- Registry: `apps/server/src/platform/llm/providers/index.ts`: `llmProviders = { gemini, openai }`, interface `LlmProvider { label, createGenerate({ apiKey, reasoningEffort, baseUrl, endpoint }), classifyError }`, `llmProviderIds` feeds the Zod enum of `LLM_PROVIDER`. F138 stage 02 removes the `gemini` row (`LlmProviderId` becomes `"openai"`); it keeps the registry shape for "a later provider" (owner, 2026-11-06).
- Config: `apps/server/src/platform/config-llm.ts`: `LLM_PROVIDER`, per-role `LLM_<ROLE>_PROVIDER`, `_MODEL`, `_TIMEOUT_MS`, `_RPM`, `_REASONING`; per-provider key blocks (`providerBlocks`). `settings.ts`: the role table. `client.ts`: one rate limiter per provider and per role.
- Endpoint: `apps/server/src/platform/llm/endpoint.ts` `parseLlmBaseUrl` refuses a hosted host that is not `api.openai.com` or `eu.api.openai.com` ("hosted OpenAI-compatible API not supported; set OPENAI_ENDPOINT_KIND=own only for a server you run"). Keep that refusal: DeepSeek gets its own row and key, not an `OPENAI_BASE_URL` value.
- Prices: `llmPrices` in `packages/core` (`packages/core/src/triage/cost.ts`, `metrics/m7.ts` read them). The judge rule `JUDGE_SAME_MODEL` (F138 stage 01) compares provider and model id.
- Evals and judge: `apps/server/src/scripts/eval-drafter.ts`, `eval-judge-setup.ts` and `modules/triage/eval-judge.ts` call `createLlmClient({ table })` with the role table: no own provider code found at a first grep. The audit stage confirms it for every script (`eval*.ts`, `llm-check`, `triage-cost`, `stats-week`, `lab`).
- Legal: `packages/core/src/legal/subprocessors.ts` (rows with `activeWhen: { kind: "llmProvider", provider }`), `apps/web/src/legal/*/privacy.md`, `packages/core/src/web/terms.ts` (`TERMS_HISTORY`), and the F121 security page claims (must stay true).

## Facts to check in the plan

- DeepSeek API: OpenAI-compatible chat completions at `https://api.deepseek.com`; no Responses API `[not verified in this session]`. The OpenAI adapter's request shape (Responses API, reasoning effort) may not fit: a `deepseek.ts` adapter or a shared chat-completions adapter (the F140 spike wrote one for LM Studio on branch `limen/2026-11-19-f111-s05-own-model-holdout-runs-4666fa9b`).
- Prices and context limits of the DeepSeek models at plan time, with the read date in the price row comment.
- Data location and retention terms for the sub-processor row.

## Not covered elsewhere

- Dropped: F072 (automatic provider fallback), F076 (Vertex AI EU), F023 (Gemini billing alert). Closed: F111 (own model endpoint; leftovers in F140). Owner-later item 2 (a DeepSeek key for the F115 run) was voided by F138 and is replaced by this ticket.
