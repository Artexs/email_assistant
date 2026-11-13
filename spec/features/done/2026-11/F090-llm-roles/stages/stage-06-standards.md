# F090 stage 06 — Standards and docs

Part of [`../plan.md`](../plan.md). Normal stage, docs only. Starts after the owner's go at checkpoint 1. Its land closes the ticket.

After this stage every planning session and worker reads the role rule and the registry rule (D7, D22), and the docs describe the role table instead of the old writer role.

## Step 1 — `docs/code-patterns.md`

**Goal.** The full rule set (D7 of the plan input, D19–D22).

**Files.** `docs/code-patterns.md`.

**Interfaces.** In § Side effects, after the bullet "The LLM returns data that a Zod schema checks. …", add:

- An LLM call names a role: `llm.generate({ role, promptVersion, schema, system, prompt })`. The role table (`llmRoleTable`, `platform/config.ts`) decides provider, model, timeout, rate and effort; code never picks a model. A new role is a row: a name in `packages/core/src/llm-roles.ts`, its `LLM_<ROLE>_*` keys, a prompt entry.
- Every role returns data that a Zod schema checks, also a free-text role (its text is a schema field).
- Prompts live in the registry (`modules/triage/prompts/index.ts`, `prompts`): one entry per role with its version, and one file `<role>-v<n>.ts` per version whose `PROMPT_VERSION` equals the file name. A changed prompt text is a new file and a new version. A role without a prompt is in `rolesWithoutPrompt` with the epic that writes it. The registry test fails on a gap.
- Every LLM call in a job or a request writes one `llm.call` row through `recordLlmCall` (`modules/audit`) with `role` and `prompt_version`; the daily cap and the cost per role read these rows. `llm:check` and `eval` write none.
- A prompt or model change of any role runs the eval gate of PD-025 (`bun run eval`, the go/no-go table) before the merge.

In § Config and secrets add: `LLM_PROVIDER` and `*_MODEL_CLASSIFIER` set the classifier; `LLM_<ROLE>_PROVIDER`, `_MODEL`, `_TIMEOUT_MS`, `_RPM`, `_REASONING` set another role; an empty key falls back to the classifier (same provider) or to the provider's keys (`docs/architecture.md` §6.3).

**Decisions.** D7, D9, D10, D19–D22.

**Test.** Read the diff: every named function and file exists (`grep -n "export function recordLlmCall\|export function llmRoleTable\|export const prompts\|export const rolesWithoutPrompt" -r apps/server/src`).

**Check.** `bunx prettier --check docs/code-patterns.md`

**Done when.** The bullets are in place and every name in them exists in the code.

**Out of scope.** Rules of other foundation tickets.

## Step 2 — `.agents/limen/styleguide.md`

**Goal.** The short form that Limen injects into every turn.

**Files.** `.agents/limen/styleguide.md`.

**Interfaces.** In § Prefer, replace the line "A prompt or model change runs `bun run eval` and must pass the go/no-go table." with:

- An LLM call names a role (`llm.generate({ role, promptVersion, … })`); the role table in config picks provider and model; the prompt comes from the registry (`prompts`), one file per version; one `llm.call` row per call through `recordLlmCall`. A prompt or model change of any role runs `bun run eval` and must pass the go/no-go table.

**Decisions.** D7.

**Test.** —

**Check.** `bunx prettier --check .agents/limen/styleguide.md`; `wc -l .agents/limen/styleguide.md` stays under 1000.

**Done when.** The line is in place.

**Out of scope.** Other styleguide lines.

## Step 3 — Architecture, modules and ADR 0015

**Goal.** The docs describe what the code does now.

**Files.** `docs/architecture.md` §6.3, `docs/modules.md` (the `llm` row of the platform table, line 164; the `classifier` row, line 234; the `audit` paragraph, line 293), `docs/decisions/0015-llm-provider-switch.md`.

**Interfaces.**

- `docs/architecture.md` §6.3, first two bullets: replace "Two roles: `classifier` … and `writer`" and the writer keys (`OPENAI_MODEL` (writer), `GEMINI_MODEL` (writer role)) with the role table: five roles (`classifier`, `judge`, `drafter`, `extractor`, `escalation`); the classifier reads `LLM_PROVIDER` and `*_MODEL_CLASSIFIER`, `*_TIMEOUT_MS`, `*_RPM`, `OPENAI_REASONING_EFFORT`; the other roles read `LLM_<ROLE>_*` with the fallback rule (D10) and the start checks (D11); one rate limiter per provider plus one per role with `LLM_<ROLE>_RPM` (D12); the provider SDK client is built at the first call. Keep the sentence "The writer role is not used in S4: drafts are templates …" but say the drafter role replaces the writer. Add: the `llm.call` row carries `role` and `prompt_version`; `countLlmCallsSince` counts per role (rows without a role are classifier rows).
- `docs/modules.md`: the `llm` row says "Roles from the role table (`classifier`, `judge`, `drafter`, `extractor`, `escalation`), `generate` by role, structured output, timeout, provider and role rate limiters, soft-error rules"; the `classifier` row says "calls `llm.generate` with role `classifier` and the registry prompt"; the `audit` paragraph adds `recordLlmCall` and the per-role count.
- ADR 0015: add a section `## Amendment (2026-11, roles)`: "`LLM_PROVIDER` is the classifier's provider and the fallback of every other role. Each role (`judge`, `drafter`, `extractor`, `escalation`) may name its own provider and model with `LLM_<ROLE>_*` keys, so two providers can run at once (PD-026: the judge is another model family than the drafter). The writer keys `OPENAI_MODEL` and `GEMINI_MODEL` are removed; the drafter role replaces the writer. Still no automatic fallback between providers." Change "Both roles (`classifier`, `writer`) use it." in § Decision to "The classifier uses it; other roles fall back to it (see Amendment)."

**Decisions.** D9–D13, D25.

**Test.** `grep -n "writer" docs/architecture.md docs/modules.md` shows only the sentence that says the drafter replaces the writer.

**Check.** `bunx prettier --check docs/architecture.md docs/modules.md docs/decisions/0015-llm-provider-switch.md`

**Done when.** The three files describe the role table and no doc names `GEMINI_MODEL` or `OPENAI_MODEL` as a live key (`grep -rn "GEMINI_MODEL\b\|OPENAI_MODEL\b" docs/architecture.md docs/modules.md docs/code-patterns.md` prints nothing; history files such as `docs/roadmap.md` stay).

**Out of scope.** `docs/roadmap.md` and old ticket folders (history).

## Stage done when

- Steps 1–3 are done; only docs changed.
- The proof of `plan.md` for stage 6 passes: `mkdir -p /tmp/f090-s06 && bunx prettier --check docs/code-patterns.md .agents/limen/styleguide.md docs/architecture.md docs/modules.md docs/decisions/0015-llm-provider-switch.md > /tmp/f090-s06/prettier.log 2>&1 && bun run lint > /tmp/f090-s06/lint.log 2>&1 && bun run test:unit > /tmp/f090-s06/unit.log 2>&1 && echo PROOF_OK`
