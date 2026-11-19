---
opened: 2026-11-19
---

# F138 · The whole project calls only OpenAI: no Gemini code, key, config or doc remains, and the evals and the judge run on OpenAI models

## Outcome

Every LLM call of the product, the evals and the judge goes to OpenAI. The Gemini provider, its keys, its settings and its docs are gone. The owner needs one key, one quota and one bill, and no free-tier daily limit stops a lab run.

## Scope

- Starting seam: ADR 0015 (`LLM_PROVIDER` switch, `apps/server/src/platform/llm/providers/{gemini,openai}.ts`, `platform/config-llm.ts`, `settings.ts`, `outside-services.ts`).
- The product already runs on OpenAI `gpt-6-luna` (VPS `LLM_PROVIDER=openai`, since 2026-11-06). Find every remaining Gemini use: the E2a judge and the second-model runs of the evals (`GEMINI_MODEL_CLASSIFIER`, default `gemini-3.5-flash-lite`; the F115 judge ran on it), F115 stage 02 (real drafter run and injection grading), eval fixtures and result files that name a Gemini model, `llm:check`, the sub-processor registry and the privacy pages, the ESLint rule that confines `@google/genai`, the `@google/genai` dependency, CI and compose env, `.env.example`.
- Pick an OpenAI model for the judge that is not the model under test, and record why. Re-run any gate whose number changes (the drafter holdout, the judge agreement) on the new models; old result files stay as history.
- A new ADR that supersedes 0007 and amends 0015 and 0012. The sub-processor entry for Google is removed only when no code path can send data to it.
- Keep the provider registry shape if a later provider is wanted (owner, 2026-11-06: "allow more providers later"); the registry then has one row.

## Out of scope

- Vertex AI EU (F076), provider fallback (F072), the private model endpoint (F111). F076 and F072 become obsolete or stay parked; the plan decides and says so.
- A change of the production classifier model.

## Acceptance

- `grep -rniE "gemini|@google/genai|generativelanguage" apps packages docs evals deploy .env.example package.json bun.lock` finds only ADR history, old result files and changelog lines.
- `bun run llm:check` and `bun run eval --sim lab-01 --part holdout` run on OpenAI with no Gemini key in the env.
- The judge model differs from the model under test; the choice is in an ADR.
- A drafter holdout report and gate file exist on the new models (unblocks F115 stage 02).
- The privacy pages and the sub-processor registry name only the providers that receive data.
- Full proof chain passes; no migration unless a settings table holds a Gemini value.

## Slices

One worker job per stage, in order 01 → 02 → {03, 04 in parallel} → 05 → 06 (`plan.md` § Stages and § How to run). Stage 02 is the only `bun.lock` change; no migration. Owner step O1 (the OpenAI project limit) comes before stage 06. Risky: 01, 02, 06.

## Sequenced

- Plan after: the reply drafts ticket F115 (its stage 02 eval harness) and the private model ticket F111 (endpoint kinds). Both have `stages/`.
- Build after: F115 stage 02 landed (its eval harness and dev report; its holdout and injection runs move to stage 06 here). No ticket must be in `done/` first.
- Gate: O1 before stage 06. Plan base 6aecc639.

## Notes

- Owner request 2026-11-19: use only OpenAI. Reason: the Gemini free quota (500 calls a day) stopped the F115 stage 02 real run at 171 of 260 cases.
- Needs an OpenAI key for the judge and eval runs on the owner's account (the VPS key already exists; check whether the eval budget allows the extra calls before the first run).
- Plan first: run the planner job (`plan-task`). Order: before F115 stage 02 resumes, since it replaces the Gemini run.
- Plan: `plan.md`, `stages/`, defaults in `questions.md`, scout packets in `scouts.md`. F076, F072 and F023 become obsolete (plan D12).
