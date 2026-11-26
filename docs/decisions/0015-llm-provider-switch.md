# 0015 — LLM: Gemini and OpenAI behind one switch

- Status: accepted (user, 2026-11-06; default pick 2026-11-07)
- Date: 2026-11-06
- Amends: 0007, 0012, 0013

## Context

Gemini gave `http_503` and slow eval runs (`notes/2026-11-05-gemini-free-tier-triage.md`). The user asked on 2026-11-06 to keep both
providers, to switch between them, and to allow more providers later.

## Decision

- One global switch: `LLM_PROVIDER` (`gemini` | `openai`; code default `gemini`). A restart applies it. The classifier uses it; other roles fall back to it (see Amendment).
- Code: `apps/server/src/platform/llm/` holds the shared client (Zod check, timeout, rate limiter) and `providers/{gemini,openai}.ts`.
  `providers/index.ts` is the registry: one row per provider (id, `createGenerate`, `classifyError`). ESLint allows
  `@google/genai` only in `providers/gemini.ts` and `openai` only in `providers/openai.ts`.
- Keys stay separate per provider: `GEMINI_*` and `OPENAI_API_KEY`, `OPENAI_MODEL_CLASSIFIER` (default `gpt-6-luna`),
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
- Budget: the user set a $3 per month budget for the OpenAI project (stage 0 of the task). The alert is a follow-up (`spec/features/planned/F073-openai-budget-alert/plan.md`).

## Consequences

- A new provider = one adapter file, one registry row, one config block, price rows and one eval run.
- `triage_results.model` mixes models after a switch. Read real-mail results with `eval --real --model`.
- No automatic fallback from one provider to the other (`spec/features/planned/F072-llm-provider-fallback/plan.md`).
- ADR 0007, 0012 and 0013 stay valid for Gemini; this ADR adds the second provider.

## Amendment (2026-11, roles)

`LLM_PROVIDER` is the classifier's provider and the fallback of every other role. Each role (`judge`, `drafter`, `extractor`) may name its own provider and model with `LLM_<ROLE>_*` keys, so two providers can run at once (PD-026: the judge is another model family than the drafter). The writer keys `OPENAI_MODEL` and `GEMINI_MODEL` are removed; the drafter role replaces the writer. Still no automatic fallback between providers.

## Amendment (2026-11-20, one provider switch with tiers)

Ticket folder: [`spec/features/active/F141-an-operator-switches-every-llm-call-to-deepseek-with-one-provider-name-and-one-api-key-and-all-provider-code-lives-in-one-registry/`](../../spec/features/active/F141-an-operator-switches-every-llm-call-to-deepseek-with-one-provider-name-and-one-api-key-and-all-provider-code-lives-in-one-registry/ticket.md). This amendment replaces the per-role amendment above.

- One `LLM_PROVIDER` runs every role. A role names a tier (`light` or `strong`) and an effort level in the core catalog; each provider row maps the tier to a model. The `LLM_<ROLE>_PROVIDER`, `LLM_<ROLE>_MODEL`, `LLM_<ROLE>_REASONING`, `OPENAI_MODEL_CLASSIFIER`, `GEMINI_MODEL_CLASSIFIER` and `OPENAI_REASONING_EFFORT` keys are removed (12 keys, `removedEnvKeys`). A non-empty value stops config. Eval and `llm:check` tools pin one run with `--provider`, `--model` and `--reasoning-effort`.
- A third row, `deepseek` (`DEEPSEEK_API_KEY`, fixed host). Production use is allowed since the amendment of 2026-11-26 below. `OPENAI_BASE_URL` still refuses the DeepSeek host.
- `OPENAI_OWN_MODEL` names the one model of an own endpoint (`OPENAI_ENDPOINT_KIND=own`); every role on openai uses it.
- A provider is one core catalog row plus one server row. The server row owns its extra env keys (`envShape`), its always-run checks (`check`) and its settings (`settings`). `config-llm.ts` names no provider; `platform/llm/provider-scan.test.ts` enforces it.

## Amendment (2026-11-26, DeepSeek for production)

The owner decided on 2026-11-26 that DeepSeek may serve production mail. This amendment replaces the sentence of the 2026-11-20 amendment that keeps `deepseek` out of production.

- `LLM_PROVIDER=deepseek` with `DEEPSEEK_API_KEY` starts in production, also with `TRIAGE_LLM_SCOPE=all` and no `LAB_STACK`. The sub-processor registry has a `deepseek` row (purpose and data as the row `openai`, location People's Republic of China as DeepSeek lists it), and `deepseekProvider.realMail` is `true`. `checkRealMail` stays for a future provider that has no row.
- `OPENAI_BASE_URL` still refuses the DeepSeek host: the `deepseek` row owns the host, the key and the price rows, and the OpenAI identity headers must not reach it.
- The in-app privacy page names the possible providers (OpenAI, DeepSeek, Gemini). The DPA, the records of processing and the DPIA (risk R11) name DeepSeek. The papers do not say whether DeepSeek uses or keeps API data; they hold a visible placeholder until the owner reads its terms. One new terms version makes every member accept again at the next sign-in.
- The public security page describes the default setup (the owner rule of 2026-11-20): it lists no `deepseek` row and says in "What this product does not promise" what DeepSeek states and what this project did not check.
- The gate result per role on DeepSeek is a record (`evals/results/deepseek-gate-lab-01.md`), not code. A role that fails its bar keeps its owner switch off. An install moves to DeepSeek only when its classifier gate file has no errors and its `go` set holds the `go` set of the file of the running provider.
- No other change: one `LLM_PROVIDER` still runs every role, and OpenAI and Gemini stay.
