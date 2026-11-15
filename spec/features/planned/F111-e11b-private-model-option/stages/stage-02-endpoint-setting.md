# F111 stage 02 — `OPENAI_BASE_URL` selects the OpenAI endpoint

Part of [`../plan.md`](../plan.md). Security review before the land (operator config that decides where mail text goes).

## Step 1 — Config key, check and endpoint kind

**Goal.** One validated setting picks the endpoint of the `openai` provider (P1, P2, D2, D3).

**Files.** `apps/server/src/platform/config.ts`; a new pure module `apps/server/src/platform/llm/endpoint.ts`; `LlmEndpointKind` in `packages/core/src/triage/cost.ts` (stage 03 prices by it; core cannot import the server).

**Interfaces.**
- `export type LlmEndpointKind = "standard" | "eu" | "own";` (core, exported from `@ea/core`).
- `parseLlmBaseUrl(raw: string): { url: string; host: string; endpoint: LlmEndpointKind } | { error: string }` — `url` without a trailing `/`; `error` never holds the raw value.
- `LlmProviderSettings` gains `baseUrl: string | null` (null for Gemini) and `endpoint: LlmEndpointKind` (Gemini: `standard`). `uniformRoleTable` sets them.
- Config key `OPENAI_BASE_URL`, default `https://api.openai.com/v1`; empty means the default.

**Decisions.** P1, P2, D2, D3.

**Test** (`endpoint.test.ts`, unit; `config.test.ts` for the start check):
1. `https://api.openai.com/v1` → `standard`, host `api.openai.com`.
2. `https://us.api.openai.com/v1/` → `standard`, url without the trailing `/`.
3. `https://eu.api.openai.com/v1` → `eu`.
4. `https://jp.api.openai.com/v1` → error (region not supported).
5. `http://127.0.0.1:11434/v1`, `http://localhost:11434/v1`, `http://[::1]:11434/v1`, `http://ollama:11434/v1` → `own`.
6. `http://192.168.1.10:11434/v1` and `http://llm.example.com/v1` → error (http needs a loopback or one-label host).
7. `https://user:pw@llm.example.com/v1` → error; the error text does not contain `pw`.
8. `https://llm.example.com/v1?token=abc` and `…/v1#x` → error; the text does not contain `abc`.
9. `not a url` → error.
10. Config with `OPENAI_BASE_URL=http://10.0.0.5/v1` and `TRIAGE_LLM_SCOPE=off` still fails the start (the check does not depend on the scope).
11. Config without the key → provider row `openai` has `baseUrl` `https://api.openai.com/v1`, `endpoint` `standard`.

**Done when.** Cases 1–11 pass.

## Step 2 — The adapter uses it

**Goal.** Every OpenAI client gets the configured URL explicitly (D1); an own endpoint gets no `reasoning` field (D4).

**Files.** `apps/server/src/platform/llm/providers/openai.ts`, `providers/index.ts`, `platform/llm/client.ts`.

**Interfaces.**
- `LlmProvider.createGenerate(opts: { apiKey: string; reasoningEffort: string | null; baseUrl: string | null; endpoint: LlmEndpointKind }): GenerateFn`.
- `openAiClientOptions(apiKey: string, baseUrl: string) → { apiKey, baseURL, maxRetries: 0 }`.
- `LlmUsage` gains `endpoint: LlmEndpointKind` (the provider row's kind at call time; stage 03 writes it to the audit row).

**Decisions.** D1, D4, D6.

**Test** (`openai.test.ts`, `client.test.ts`):
1. `openAiClientOptions("k", "https://eu.api.openai.com/v1")` equals `{ apiKey: "k", baseURL: "https://eu.api.openai.com/v1", maxRetries: 0 }`.
2. A real SDK client against a `Bun.serve` fake on port 0, with `process.env.OPENAI_BASE_URL` set to `http://127.0.0.1:1/never` in the test (restore it after): the call reaches the fake at `/v1/responses` (plan F2).
3. `endpoint: "own"`, `reasoningEffort: "none"` → the params have no `reasoning` key; `endpoint: "eu"` with `"low"` → `reasoning.effort` `low`.
4. `generate` returns `usage.endpoint` `own` for a table whose openai row is `own`; Gemini row → `standard`.

**Done when.** Cases 1–4 pass; existing adapter tests pass unchanged except the new option field.

## Step 3 — Logs, check script, docs

**Goal.** The operator sees which endpoint runs, and nothing private leaks (D5).

**Files.** `apps/server/src/main.ts` (`llm_settings`), `scripts/llm-check.ts`, the OpenAI `configHint`, `.env.example`, `docs/capabilities/triage.md`, `docs/architecture.md` §6.3, `deploy/README.md` (the env list).

**Decisions.** D5, D12, D13.

**Rules.**
- `llm_settings` adds `endpoint` and `host`; with `own`, it also logs `reasoning_ignored: true` when an effort is set.
- `llm:check` prints `endpoint=<kind> host=<host>` next to provider and model.
- `.env.example`: the key, its default, the EU value, an Ollama example, and "the API key must belong to the project of that region".
- D12: if `OUTSIDE_SERVICE_KEYS` exists at `HEAD` (F107 landed), map `OPENAI_BASE_URL` to the `openai` row; else write the seam in the final message.

**Test.**
1. A unit test of the start log fields (or of the function that builds them): `{ provider: "openai", model: "gpt-6-luna", endpoint: "own", host: "127.0.0.1" }`; no field holds a path or a port.

**Done when.** The test passes; the capability page states rules D1–D5 in plain words.

## Proof

The Proof of `plan.md` with `NN` = `02`.
