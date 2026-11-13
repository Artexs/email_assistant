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

## Slices

Six worker jobs, one per stage in `stages/`, run one after another: the role table; the role client beside the old one; every caller moves and the old client goes; the role in every `llm.call` row and the prompt registry; the tools; the standards. Stages 2, 3 and 4 get a review job. The coordinator stops after stage 5 (checkpoint 1: the owner runs `llm:check` and a small eval on the real provider) before the last stage. No migration, no `bun.lock` change. Commands: [plan.md](plan.md) § "How to run".

## Sequenced

- Plan after: none (the plan reads the module layer list of the border-lint ticket F086 and the config stages of the feature-flag ticket F087; it uses no interface of either).
- Build after: F086, the module borders lint (it changes the lint every later job runs), in `spec/features/done/`.
- Gate: the owner's go for the foundation group (`docs/product/stage-2/07-foundation-plan.md` §4 decision 1). Stages 1 and 5 edit `platform/config.ts`: not while the feature-flag stages 1 or 4 (F087) or the structured-log stage (F089) that edits `platform/config.ts` are in build. Stages 2 and 3 not while the F089 stage that converts `platform/` log calls is in build. Other shared files: [plan.md](plan.md) § How to run step 2.

## Notes

Design and stages: [plan.md](plan.md); open defaults: [questions.md](questions.md). "Pass unchanged" means the test cases and assertions; the test fakes change shape (plan D17). The `eval --real` report records the role; only the case-run report also has the prompt version (plan D24). Source: review §3.6; ADR 0015 (provider switch), PD-025, PD-026, PD-059.
