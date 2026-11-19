# F138 stage 02 — Remove the Gemini provider

Needs stage 01: `JUDGE_SAME_MODEL` and `DEFAULT_JUDGE_MODEL` (landed). Needs the board's `bun.lock` slot: no other `bun.lock` change builds next to it. Needs F115 stage 17: `TERMS_HISTORY` `2026-11-19-2`, row `openai` (landed).

Part of [`../plan.md`](../plan.md). `[risky]` (production config at start, legal text, `bun.lock`).

After this stage no code path can call Google for an LLM, and the legal registry says so. The only `bun.lock` change of F138.

## Step 1 — Provider, config and dependency

- **Goal:** `llmProviders` has one row, `openai` (D1). `LlmProviderId` is `"openai"`.
- **Files:** delete `apps/server/src/platform/llm/providers/gemini.ts` and its test. Change the registry, `config-llm.ts` (the `GEMINI_*` keys, `defaultGeminiRpm`, `providerBlocks.gemini`), `settings.ts` (`uniformRoleTable` gets one provider row; comments that name Gemini), `testing.ts` (default provider `openai`), `outside-services.ts` (`GEMINI_API_KEY` out). `bun remove @google/genai` in `apps/server`; never edit `bun.lock` by hand.
- **Decisions:** D1, D2, D15. Keep every provider-generic mechanism: `LLM_PROVIDER`, `LLM_<ROLE>_PROVIDER`, `providerBlocks`, the per-provider rate limiter, the null-effort rule. Tests of a mechanism that needs two providers (per-provider limiter, a role on another provider, null effort) use `twoProviderTable()`, moved from `client-roles.test.ts` and exported from `platform/llm/testing.ts`: a second row `other` (cast in test code only, no registry row). Tests that parse a second provider from env are deleted: the enum has one value. List each moved and each deleted test in the final message.
- **Test (unit):**
  1. Env `OPENAI_API_KEY=k` only → config parses; `LLM_PROVIDER` = `openai`.
  2. Env `LLM_PROVIDER=other` → `ConfigError`; the message holds `LLM_PROVIDER` and not `other`.
  3. Env `LLM_JUDGE_PROVIDER=other` → `ConfigError` naming `LLM_JUDGE_PROVIDER`.
  4. Env `OPENAI_API_KEY=k` plus `OLD_PROVIDER_API_KEY=x` → parses; no `OLD_PROVIDER_API_KEY` in the result (D2). No test names the removed vendor.
  5. `llmProviderIds` equals `["openai"]`.
  6. `twoProviderTable()`: two roles on `openai` and `other` get two provider limiters (the moved client test).
- **Done when:** tests 1–6 pass. A test that breaks on the type change is fixed here; one that only holds a Gemini string waits for stage 03.

## Step 2 — Prices, lint rule, scripts, env files

- **Goal:** nothing outside `evals/results/` can select or price Gemini.
- **Files and decisions:**
  - `packages/core/src/triage/cost.ts`: remove the two Gemini price rows and `PRICING_URL` (D7).
  - `eslint.config.js`: remove the `@google/genai` restriction and its exemptions; the `openai` confinement rule stays.
  - root `package.json`: remove `gemini:test`. `llm:check` stays.
  - `eval-args.ts` and `llm-check-args.ts`: usage text from `llmProviderIds` only; remove any branch for a provider without effort that names Gemini (`--reasoning-effort` stays valid on `openai`).
  - `.env.example`: remove the Gemini block; the `LLM_PROVIDER` comment says "only `openai`; empty = openai".
  - `deploy/sim.env.example`: remove `GEMINI_API_KEY` and the Gemini clause of the comment.
  - `deploy/compose.drill.yaml`: remove `GEMINI_API_KEY`; update `deploy/test/compose-drill.test.ts` and `restore.test.ts`.
- **Test (unit):**
  1. `costPerMail("gemini-3.8-flash", …)` is no longer tested; a test that needs an unpriced model uses `model-b` and gets `null`.
  2. `unitCost` with one row of model `model-b` → `unpricedCalls` 1 (moves the m7 case).
  3. `parseLlmCheckArgs(["--provider", "openai"])` succeeds; `["--provider", "other"]` → `null`.

## Step 3 — Sub-processor row and privacy sentence

- **Goal:** the legal pages name only providers that can receive data (D9).
- **Files:** `packages/core/src/legal/subprocessors.ts` (remove row `gemini`), `apps/web/src/legal/en/privacy.md` and `pl/privacy.md` § AI model, `packages/core/src/web/terms.ts` (`TERMS_HISTORY`).
- **Decisions:**
  - Delete only the sentence "An install can use Google Gemini instead." (en) and "Instalacja może zamiast tego używać Google Gemini." (pl). The next sentence about the "Used when" column stays.
  - Append one `TERMS_HISTORY` entry after the newest entry at build time (`2026-11-19-2` at refresh): version = the UTC date of the commit (add `-2`, `-3` when that date exists), the digest that `legal-version.test.ts` asks for, comment `// LLM sub-processor row removed (ADR 0037)` (no vendor name in `packages/`, N4). No other legal text changes.
  - Rows `google-oauth` and push services (Google FCM) stay.
  - `outside-services.test.ts` keeps both directions.
- **Test:** the legal tests (`legal-version`, `legal-privacy`, `legal-papers`, the registry tests) pass.

## Check

`bun test apps/server/src/platform apps/server/src/scripts apps/server/src/legal-papers.test.ts packages/core apps/web/src/lib deploy/test` and `bun run lint`.

## Done when

`git grep -niE "@google/genai|generativelanguage" -- apps packages package.json bun.lock eslint.config.js` finds nothing. The Proof (`sNN` = `s02`) prints `PROOF_OK`. The final message lists the env keys removed, for coordinator step C1.

## Out of scope

Test fixtures that only use the word Gemini (stage 03); docs (stages 04, 05); any VPS or `.env` edit (C1).
