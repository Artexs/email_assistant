# F090 · LLM roles: plan input

> Written 2026-11-13 from the architecture review §3.6. Input of the `plan-task` session. Ticket: [ticket.md](ticket.md). Runs after F086; no migration; safe next to any job except one that edits `platform/config.ts` at the same time (F087, F089 touch it: serialize the config stage).

## Facts (2026-11-13)

- `platform/llm/client.ts`: `LlmClient { classifierModel; classify<T>({ schema, system, prompt, model? }) }`; one rate limiter per client; `withTimeout`; `parseOutput` with Zod; errors through `provider.classifyError`.
- `platform/llm/providers/index.ts`: `llmProviders = { gemini, openai }` with `createGenerate({ apiKey, reasoningEffort })` and `classifyError`. ESLint keeps each SDK in its file.
- `platform/config.ts`: `LLM_PROVIDER`, per provider `*_API_KEY`, `*_MODEL`, `*_MODEL_CLASSIFIER`, `*_TIMEOUT_MS`, `*_RPM`, `OPENAI_REASONING_EFFORT`; `llmSettings(config)` picks one.
- `main.ts` builds one client and passes it to `createTriageJob`; `triage/classifier.ts` calls `llm.classify` and returns `promptVersion` from `prompts/classifier-v2.ts`.
- The `llm.call` audit row holds `reason_code` (outcome) and `data` (model, tokens, latency); `triage_results` holds `model`, `prompt_version`, tokens, latency.
- The daily cap counts `llm.call` rows per mailbox per quota day (`countLlmCallsSince`).

## Design decisions

- **D1 Roles.** `LlmRole = "classifier" | "judge" | "drafter" | "extractor" | "escalation"` in `packages/core/src/llm-roles.ts` (names only, no I/O). Unknown roles are a type error.
- **D2 Role table in config.** For each role, optional env keys `LLM_<ROLE>_PROVIDER`, `LLM_<ROLE>_MODEL`, `LLM_<ROLE>_TIMEOUT_MS`, `LLM_<ROLE>_RPM`, `LLM_<ROLE>_REASONING`; a missing key falls back to the classifier's (today's `LLM_PROVIDER` and `*_MODEL_CLASSIFIER`, which keep their names so the VPS `.env` does not change). `llmSettings(config)` returns `Record<LlmRole, RoleSettings>`. The key of the provider comes from the provider's own `*_API_KEY`.
- **D3 One client, many roles.** `createLlmClient({ roles })` builds one `generate` function and one rate limiter per provider (not per role: the provider's rate limit is shared), and exposes `generate<T>({ role, schema, system, prompt })` and `modelOf(role)`. `classify` becomes `generate` with `role: "classifier"`; keep a deprecated alias for one stage, then remove.
- **D4 Usage and audit.** `LlmUsage` gains `role` and `promptVersion`; the triage service writes both into the `llm.call` audit data; `triage_results.prompt_version` stays. The cap query stays per mailbox; a per-role count helper (`countLlmCallsSince(…, { role })`) exists for E6a's 80 % rule.
- **D5 Prompt registry.** `modules/triage/prompts/index.ts` (later `platform/llm/prompts/` when a second module has prompts): `prompts = { classifier: { version: "classifier-v2", buildSystem, buildUser } }`; a unit test checks that every role in use has an entry and that `PROMPT_VERSION` equals the file name.
- **D6 Tools.** `llm:check --role` (default `classifier`); `eval` passes the role and writes it in the report header.
- **D7 Standard.** `docs/code-patterns.md` § Side effects: "An LLM call names a role; the role table decides provider and model; the audit row carries role and prompt version; a prompt or model change of any role runs the eval gate of PD-025."

## Stages

1. **Roles and the client.** Files: `packages/core/src/llm-roles.ts`, `platform/llm/client.ts` (+ test), `platform/llm/index.ts`, `platform/config.ts` (`llmSettings` by role, `.env.example`), `main.ts`, `scripts/job-run.ts`. Tests: same request for the classifier; a second role on another provider with fakes.
2. **Usage, audit, tools.** Files: `triage/classifier.ts`, `triage/service.ts`, `audit` data shape, `scripts/llm-check.ts`, `triage/eval.ts`, `eval-report.ts`; integration test for the audit row fields.
3. **Prompt registry and docs.** Files: `triage/prompts/index.ts` (+ test), `docs/code-patterns.md`, `.agents/limen/styleguide.md`, `docs/architecture.md` §6.3, ADR 0015 (amended: roles).

Parallel: stage 1 first; stages 2 and 3 at once after it.

## Done when

- The five acceptance lines hold.
- `bun run eval --provider openai --model gpt-6-luna --per-category 3` (or the cheapest smoke the owner allows) runs through the new path and reports the role.
