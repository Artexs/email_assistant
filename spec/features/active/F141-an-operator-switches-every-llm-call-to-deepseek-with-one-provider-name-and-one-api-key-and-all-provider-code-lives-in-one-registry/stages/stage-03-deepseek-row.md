# F141 stage 03 — the DeepSeek row and the server registry on core ids `[risky]`

Needs stage 02: `llmProviderCatalog`, `LlmProviderId`, `llmProviderIds`, `tierModel` in `packages/core/src/llm-providers.ts`. Needs stage 01: `ALLOWED_SITES`.

Part of [`../plan.md`](../plan.md). Decisions: P4, D2, D3, D4, D5. Risky: a key or an identity header can reach the wrong host; real mail can reach an unlisted processor. Review job before the land.

## Step 1 — the server registry uses the core ids

- **Goal:** `LlmProviderId` and `llmProviderIds` come from core; the server registry is `satisfies Record<LlmProviderId, LlmProvider>`, so a core row without a server row fails typecheck.
- **Interface (stage 04 extends it):** `LlmProvider` gets two fields: `envPrefix: string` (`"OPENAI"`, `"GEMINI"`, `"DEEPSEEK"`) and `defaults: { timeoutMs: number; rpm: number }` (D5). `label` comes from the catalog row only.
- **Config:** the `<P>_API_KEY`, `<P>_TIMEOUT_MS`, `<P>_RPM` keys of `llmShape` are built from the rows (prefix + suffix), with the row defaults. Openai and gemini keep their key names and defaults. `providerBlocks` gets a deepseek block; its model for now is `tierModel("deepseek", "light")` and its `reasoningEffort` is `"none"` for every role (stage 04 replaces models and efforts with tiers). Known gap until stage 04: the judge on deepseek still gets `DEFAULT_JUDGE_MODEL` (an OpenAI model); only tools see it, and R1 checks the classifier only.
- `uniformRoleTable` and every other `{ gemini: …, openai: … }` record build from `llmProviderIds`.

## Step 2 — the deepseek adapter

- **Files:** `apps/server/src/platform/llm/providers/deepseek.ts`. It imports the OpenAI adapter functions from `./openai`, not the `openai` SDK (ESLint keeps the SDK in `openai*.ts`).
- **Behaviour (D3, D4):** base URL fixed `https://api.deepseek.com`; endpoint kind `standard`; `classifyOpenAiError`; the effort of the role row goes into `reasoning.effort` as is.
- **No OpenAI identity on another host:** today `openAiClientOptions` sets `organization` and `project` to null only for `own`. Make that rule "every host that is not OpenAI" (own and deepseek). `defaultHeaders` already drops `OPENAI_CUSTOM_HEADERS`. The deepseek client gets `DEEPSEEK_API_KEY`, never `OPENAI_API_KEY`.
- Settings row: `apiKeyName: "DEEPSEEK_API_KEY"`, `baseUrl: "https://api.deepseek.com"`, `endpoint: "standard"`.
- `parseLlmBaseUrl` does not change: `OPENAI_BASE_URL=https://api.deepseek.com` without `OPENAI_ENDPOINT_KIND=own` is still refused.

## Step 3 — the privacy guard and the outside-service key

- **P4:** `checkLlm` adds an issue on `LLM_PROVIDER` when the provider is `deepseek`, `TRIAGE_LLM_SCOPE` is `all` and `LAB_STACK` is not `SIM_STACK_NAME` (`@ea/core`, `ea-sim`: the live lab, generated mail only). Message: `"deepseek is for dev, tests and evals: no sub-processor row, so TRIAGE_LLM_SCOPE=all is refused outside the sim stack"`. Put the rule in the registry row as a flag (`realMail: false`), so config names no provider. Config reads `LAB_STACK` as an optional string.
- **`outside-services.ts`:** `DEEPSEEK_API_KEY: { exempt: "dev, tests and evals only; config refuses LLM_PROVIDER=deepseek with TRIAGE_LLM_SCOPE=all (F141 P4)" }`. Do not add a sub-processor row (owner, 2026-11-19).
- **Docs:** `docs/capabilities/triage.md` rule 6: `LLM_PROVIDER` takes `deepseek`; the guard; the key. `.env.example`: `DEEPSEEK_API_KEY=`, `DEEPSEEK_TIMEOUT_MS`, `DEEPSEEK_RPM` with comments (dev, tests, evals only).

## Test

1. Config with `LLM_PROVIDER=deepseek`, `DEEPSEEK_API_KEY=k`, `TRIAGE_LLM_SCOPE=synthetic` loads; the classifier row is `deepseek` / `deepseek-flash`; the provider row has `rpm: 60`, `timeoutMs: 30000`, host `api.deepseek.com`.
2. The same with `TRIAGE_LLM_SCOPE=all` fails; the error keys name `LLM_PROVIDER`; the message holds no value of any key. With `LAB_STACK=ea-sim` added it loads; with `LAB_STACK=ea-prod` it fails.
3. `LLM_PROVIDER=deepseek`, scope `synthetic`, no `DEEPSEEK_API_KEY`: fails, the error names `DEEPSEEK_API_KEY`.
4. A fake OpenAI client of the deepseek adapter, with `process.env.OPENAI_ORG_ID=org-x`, `OPENAI_PROJECT_ID=p-x`, `OPENAI_API_KEY=sk-x` set in the test: the client options hold `organization: null`, `project: null`, `apiKey` = the DeepSeek key, `baseURL: "https://api.deepseek.com"`.
5. The request of a classifier call (effort `none`) holds `reasoning: { effort: "none" }`, `text.format.type: "json_schema"`, `strict: true`, `store: false`.
6. `classifyError` of an error with status 402 is a config error `http_402`; 429 without quota code is soft `http_429`; 422 is hard `http_422`.
7. The outside-services test passes with the new key.
8. The openai and gemini config tests pass unchanged (same keys, same defaults).

## Check

`bun test apps/server/src/platform`

## Done when

- Tests 1–8 pass. The stage-01 allowlist has no entry for a file that lost its site.
- The Proof command of `plan.md` prints `PROOF_OK` after the last commit.

## Out of scope

Tiers for the roles, removed keys, the judge default (stage 04). A sub-processor row or legal text.
