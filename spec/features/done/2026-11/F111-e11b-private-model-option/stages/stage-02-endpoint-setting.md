# F111 stage 02 — `OPENAI_BASE_URL` selects the OpenAI endpoint

Part of [`../plan.md`](../plan.md). Security review before the land (it decides where mail text goes).

## Step 1 — Config key, check and endpoint kind

**Goal.** One validated setting picks the endpoint of the `openai` provider (P1, P2, D2, D3).

**Files.** Config, the eval CLI (case 12); new pure module `apps/server/src/platform/llm/endpoint.ts`; `LlmEndpointKind` in `packages/core/src/triage/cost.ts` (core cannot import the server).

**Interfaces.**
- `export type LlmEndpointKind = "standard" | "eu" | "own";` (core, exported from `@ea/core`).
- `parseLlmBaseUrl(raw: string): { url: string; host: string; endpoint: LlmEndpointKind } | { error: string }` — `url` has no trailing `/`; `error` never holds the raw value.
- `LlmProviderSettings` gains `baseUrl: string | null` (null for Gemini) and `endpoint: LlmEndpointKind` (Gemini: `standard`). `uniformRoleTable` sets them.
- Config key `OPENAI_BASE_URL`, default `https://api.openai.com/v1`; empty means the default. Optional `OPENAI_ENDPOINT_KIND=own` (only value; D3).

**Decisions.** P1, P2, D2, D3.

**Test** (`endpoint.test.ts`, unit; `config.test.ts` for the start check):
1. `https://api.openai.com/v1/` → `standard`, host `api.openai.com`, url without the trailing `/`.
2. `https://eu.api.openai.com/v1` and `https://EU.api.openai.com./v1` → `eu`.
3. `https://us.api.openai.com/v1` and `https://jp.api.openai.com/v1` → error (no such region).
4. `http://127.0.0.1:11434/v1`, `http://127.1.2.3:11434/v1`, `http://localhost:11434/v1`, `http://[::1]:11434/v1`, `http://ollama:11434/v1` → `own`.
5. `http://[::ffff:127.0.0.1]/v1`, `http://192.168.1.10:11434/v1`, `http://llm.example.com/v1` → error (http needs a loopback or one-label host).
6. `https://llm.example.com/v1` → error ("hosted OpenAI-compatible API not supported; set OPENAI_ENDPOINT_KIND=own only for a server you run"); the same with `OPENAI_ENDPOINT_KIND=own` → `own`.
7. `https://res.openai.azure.com/openai/v1` and `https://openrouter.ai/api/v1` without the kind → error.
8. `OPENAI_ENDPOINT_KIND=own` with `https://eu.api.openai.com/v1` → error (the kind cannot relabel OpenAI).
9. `https://user:pw@llm.example.com/v1` → error without `pw` in the text; `…/v1?token=abc` and `…/v1#x` → error without `abc`; `not a url` → error.
10. `OPENAI_BASE_URL=http://10.0.0.5/v1` with `TRIAGE_LLM_SCOPE=off` still fails the start.
11. No key → the `openai` provider row has `baseUrl` `https://api.openai.com/v1`, `endpoint` `standard`; with an `own` URL every `openai` role row has `reasoningEffort` `null` (D4), also with `OPENAI_REASONING_EFFORT=low` or `LLM_DRAFTER_REASONING=low`.
12. `runSim`, `runClassifier` and `runReal` catch the `ConfigError` of `loadConfig`, print `config error: <keys>`, exit 1. Test (all other keys valid): `http://10.0.0.5/v1` → the key printed, not the value. `--real` stops too (intended, case 10); `--suspicious` runs.

**Done when.** Cases 1–12 pass.

## Step 2 — The adapter uses it

**Goal.** Every OpenAI client gets the configured URL explicitly (D1); an own endpoint gets no `reasoning` field (D4).

**Files.** `apps/server/src/platform/llm/providers/openai.ts`, `providers/index.ts`, `platform/llm/client.ts`.

**Interfaces.**
- `LlmProvider.createGenerate(opts: { apiKey: string; reasoningEffort: string | null; baseUrl: string | null; endpoint: LlmEndpointKind }): GenerateFn`.
- `openAiClientOptions(apiKey: string, baseUrl: string) → { apiKey, baseURL, maxRetries: 0 }`.
- `LlmUsage` gains `endpoint: LlmEndpointKind`, and `LlmClient` gains `endpointOf(role: LlmRole): LlmEndpointKind` (for the error branch, which has no usage; stage 03 writes both to the audit row).

**Decisions.** D1, D4, D6.

**Test** (`openai.test.ts`, `client.test.ts`):
1. `openAiClientOptions("k", "https://eu.api.openai.com/v1")` equals `{ apiKey: "k", baseURL: "https://eu.api.openai.com/v1", maxRetries: 0 }`.
2. A real SDK client against a `Bun.serve` fake (port 0), with `process.env.OPENAI_BASE_URL` = `http://127.0.0.1:1/never`, restored: the call reaches the fake at `/v1/responses` (plan F2).
3. An `own` row (effort `null`) → the params have no `reasoning` key; `eu` with `"low"` → `reasoning.effort` `low`.
4. `generate` returns `usage.endpoint` `own` and `endpointOf("classifier")` is `own` for a table whose openai row is `own`; a Gemini row → `standard`.

**Done when.** Cases 1–4 pass; old adapter tests change only by the new option field.

## Step 3 — Logs, check script, docs

**Goal.** The operator sees the endpoint; nothing private leaks (D5).

**Files.** The start log, `llm:check`, the OpenAI `configHint`, `.env.example`, the triage capability page, `docs/architecture.md` §6.3, the env list of `deploy/README.md`.

**Decisions.** D5, D14, D15.

**Rules.**
- `llm_settings` adds `endpoint` and `host`. The OpenAI `configHint` names `OPENAI_BASE_URL`.
- `llm:check` prints `endpoint=<kind> host=<host>` beside provider and model.
- `.env.example`: the key, its default, the EU value, an Ollama example, and "the API key must belong to the project of that region".
- D14: if `OUTSIDE_SERVICE_KEYS` exists at `HEAD` (F107 landed), map `OPENAI_BASE_URL` and `OPENAI_ENDPOINT_KIND` to the `openai` row; else write the seam in the final message.

**Test.**
1. A unit test of the start log fields: `{ provider: "openai", model: "gpt-6-luna", endpoint: "own", host: "127.0.0.1" }`; no path or port.

**Done when.** The test passes; the capability page states D1–D5 plainly, also "a hosted compatible API is not supported".

## Proof

The Proof of `plan.md` with `NN` = `02`.
