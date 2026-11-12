# 0015 — LLM: Gemini and OpenAI behind one switch

- Status: accepted (user, 2026-11-06; default pick 2026-11-07)
- Date: 2026-11-06
- Amends: 0007, 0012, 0013

## Context

Gemini gave `http_503` and slow eval runs (`notes/2026-11-05-gemini-free-tier-triage.md`). The user asked on 2026-11-06 to keep both
providers, to switch between them, and to allow more providers later.

## Decision

- One global switch: `LLM_PROVIDER` (`gemini` | `openai`; code default `gemini`). A restart applies it. Both roles (`classifier`, `writer`) use it.
- Code: `apps/server/src/platform/llm/` holds the shared client (Zod check, timeout, rate limiter) and `providers/{gemini,openai}.ts`.
  `providers/index.ts` is the registry: one row per provider (id, `createGenerate`, `classifyError`, `configHint`). ESLint allows
  `@google/genai` only in `providers/gemini.ts` and `openai` only in `providers/openai.ts`.
- Keys stay separate per provider: `GEMINI_*` and `OPENAI_API_KEY`, `OPENAI_MODEL` (writer), `OPENAI_MODEL_CLASSIFIER` (default `gpt-6-luna`),
  `OPENAI_TIMEOUT_MS`, `OPENAI_RPM`, `OPENAI_REASONING_EFFORT`.
- OpenAI call: Responses API, strict JSON schema made from the Zod schema (root `$schema` removed; the adapter throws at build time on a loose object),
  `store: false`, `maxRetries: 0`, no tools. Zod checks every answer again.
- New error codes: `http_429_quota` (no money or budget spent), `http_400_schema` (OpenAI rejects the schema), `schema_not_strict` (our check).
  They are config errors: the LLM pause applies (ADR 0012).
- Eval: `bun run eval --provider <id> --model <id>`; `eval --real --model` filters by model. Check: `bun run llm:check --provider <id>`.
- Eval result (same 92 cases, prompt `classifier-v1`): no Gemini or `gpt-6-luna` run passes the 98% bar with 30 kept rows per category
  (`evals/results/2026-11-05-gemini-3.5-flash-lite.md`, `2026-11-06-gpt-6-luna-none.md`, `-low.md`). The user picked OpenAI `gpt-6-luna` as the default (2026-11-07).
  The VPS has run on it since 2026-11-06 21:48Z.
- Data rules per provider:
  - Gemini: as in ADR 0012 and 0013.
  - OpenAI, pilot: the paid API terms (no training on API data, abuse logs up to 30 days, no EU location). The user accepted this for their own mail on 2026-11-06.
  - Customers (S6): Vertex AI EU stays the planned path; an OpenAI EU project with zero data retention (needs OpenAI approval) is an open option in `tasks/planned/s6-pre-sale.md`.
- Budget: the user set a $3 per month budget for the OpenAI project (stage 0 of the task). The alert is a follow-up (`tasks/planned/openai-budget-alert.md`).

## Consequences

- A new provider = one adapter file, one registry row, one config block, price rows and one eval run.
- `triage_results.model` mixes models after a switch. Read real-mail results with `eval --real --model`.
- No automatic fallback from one provider to the other (`tasks/planned/llm-provider-fallback.md`).
- ADR 0007, 0012 and 0013 stay valid for Gemini; this ADR adds the second provider.
