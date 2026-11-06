# LLM provider: add OpenAI next to Gemini (overview)

Status 2026-11-06: overview only. The plan is in `tasks/planned/llm-provider-switch.md`. It has the checked OpenAI facts (prices, strict schema rules, data terms) with sources; they replace the facts from memory below.

## Short answer

- Yes, the LLM part is mostly isolated. Only `apps/server/src/platform/llm.ts` imports the Gemini SDK (ADR 0007).
- `llm.ts` already has a seam: `GenerateFn` (one function: request in, text + token counts out).
  An OpenAI version is one new `GenerateFn` plus its error mapping. Retry, timeout, rate limiter, Zod check and pause logic stay.
- But some Gemini facts leak outside `llm.ts`. These also change (list below). The change is small, not one-file.

## What changes outside `llm.ts`

| Place | Gemini fact in it | Change |
| --- | --- | --- |
| `platform/config.ts` | `GEMINI_API_KEY`, `GEMINI_MODEL*`, `GEMINI_RPM`, `GEMINI_TIMEOUT_MS`, key check | Add `LLM_PROVIDER` (`gemini` \| `openai`), `OPENAI_API_KEY`, model per provider. Key check per provider. |
| `main.ts`, `scripts/eval.ts` | pass Gemini key and settings to `createLlmClient` | Pass the selected provider. Log text "sends mail to Gemini". |
| `modules/triage/pause.ts` | message names `GEMINI_API_KEY` and Google project | Provider-neutral text. |
| `packages/core/src/triage/cost.ts` | price table has only Gemini models | Add OpenAI model prices (source URL, date checked). |
| `packages/core/src/triage/quota-day.ts` | daily cap day = Pacific midnight (Gemini free tier) | OpenAI has no free daily quota like this. Keep the cap; the day can stay or move to UTC. |
| `scripts/gemini-check.ts` | Gemini smoke check | Add an OpenAI check (or one check per provider). |
| Docs | ADR 0007, 0012, 0013, `docs/architecture.md`, `.env.example` | New ADR "LLM provider switch"; amend 0007/0012. |
| Evals | results only for Gemini models | Run the 92-case eval with the OpenAI model before real mail. |

## OpenAI details that need care (inside `llm.ts`)

- Structured output: OpenAI strict JSON schema needs every field `required` and `additionalProperties: false`.
  Our triage schema uses `.nullable()`, not `.optional()`, so it fits. Some keywords (for example `maxLength`) may be ignored [not verified]; Zod checks the answer again anyway.
- Token count: OpenAI puts reasoning tokens inside output tokens. Do not add them twice (Gemini code adds `thoughtsTokens`).
- Errors: `429 insufficient_quota` (no money on the account) is a config error, not a soft retry. Normal 429 and 5xx stay soft.
- Refusal: OpenAI returns a `refusal` field. Map it to `LlmBlockedError`.
- Low reasoning effort for `classify` (same idea as the lowest Gemini thinking setting, ADR 0012).

## Data and privacy (verify before the plan; facts from memory, not checked)

- OpenAI API: data is not used for training by default. Abuse logs are kept up to 30 days.
- Zero data retention and EU data residency exist, but need approval or an eligible project.
- This affects ADR 0012: the "Vertex AI EU before the first customer" rule needs an OpenAI equivalent.

## Options and effort

1. **Switch to OpenAI only.** About 1–2 plan stages. Remove nothing from Gemini code yet.
2. **Both providers, one selected by config (`LLM_PROVIDER`).** Recommended. About 2–3 stages. Small extra cost over option 1.
   Lets the eval compare both on the same 92 cases. Lets you switch back with one env change.
3. **Both with automatic fallback** (Gemini 503 → OpenAI). More work: retry and pause rules, cost cap per provider, mixed results in `triage_results`.
   Not needed now.

## Is it worth it

- For: Gemini gave many `503 high demand` errors and slow eval runs (`notes/2026-11-05-gemini-free-tier-triage.md`).
  Real mail needs a paid tier anyway (ADR 0007 gate). You already have OpenAI billing.
- Against: prompts were tuned on Gemini; a new eval run and a cost compare are needed. The privacy text must change.
- Recommendation: option 2. The code seam exists, so the cost is low. Pick the default provider from the eval result.
