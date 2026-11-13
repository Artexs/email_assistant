---
opened: 2026-11-13
---

# F090 · LLM calls name a role; provider, model, cap share and prompt version follow the role

## Outcome

Code calls `llm.generate({ role, schema, system, prompt })` and the role decides the provider, the model, the timeout, the rate and the reasoning setting from one table in the config. Usage and the `llm.call` audit row carry the role and the prompt version, so cost per role (M7) and the eval gate per prompt (PD-025) have their data. The classifier is the first role; the judge (E2a), the drafter (E6a), the extractor (E5b) and the escalation model (E3b) are rows in the table, not new clients.

## Scope

- Starting seam: `apps/server/src/platform/llm/{client,index}.ts`, `platform/config.ts` (`llmSettings`), `modules/triage/{classifier,service}.ts`, `modules/triage/prompts/`, `scripts/llm-check.ts`, the eval runner.
- Role table in config with env keys per role and a fallback to the classifier's provider and model.
- A prompt registry: one entry per role and version with its builder, so the version that was used is recorded with every call.
- Cap accounting per role in the `llm.call` audit row (the share rule itself, "drafts stop at 80 %", is E6a's).

## Out of scope

- New providers (Vertex AI, local models: F076, E11). The judge, drafter and extractor prompts themselves (their epics).
- A change of the classifier prompt or model (needs the eval gate).

## Acceptance

- `generate` for `classifier` produces the same request and the same `triage_results` rows as `classify` did (the classifier unit tests and `triage-service` integration tests pass unchanged; `classify` is removed or is a one-line alias).
- A second role configured with another provider in a test uses that provider's `createGenerate` and its own rate limiter and timeout (unit test with fakes).
- Every `llm.call` audit row and every `LlmUsage` carries `role` and `prompt_version` (integration test).
- `bun run llm:check --role <role>` sends that role's schema to its provider; `bun run eval` records the role and prompt version in its report.
- The SDK-import lint still holds; `docs/code-patterns.md` has the standard "an LLM call names a role" and the prompt-registry rule.

## Notes

Design and stages: [plan.md](plan.md). Source: review §3.6; ADR 0015 (provider switch), PD-025, PD-026, PD-059.
