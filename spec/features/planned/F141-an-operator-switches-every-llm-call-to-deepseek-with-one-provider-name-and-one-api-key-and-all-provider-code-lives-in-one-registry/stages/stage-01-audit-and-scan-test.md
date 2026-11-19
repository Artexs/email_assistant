# F141 stage 01 — audit report and the provider scan test

Needs: nothing. May run first; every later stage edits the allowlist that this stage writes.

Part of [`../plan.md`](../plan.md). Decisions: D2, D11.

No product code changes in this stage. It writes one report and one test.

## Step 1 — the audit report

- **Goal:** one list of every provider-specific code site before the change. Acceptance item 5 ("the audit report lists every provider-specific code site before").
- **Files:** `audit.md` in this ticket folder. Start from scout 1 and scout 2 in `../scouts.md`; they are leads, not facts. Re-run the search yourself at `HEAD`.
- **What counts as a site:** in a non-test `.ts` file, a provider id as a string literal (`"openai"`, `"gemini"`, `"deepseek"`), a model id (`gpt-…`, `gemini-…`, `deepseek-…`), a provider env key name (`OPENAI_…`, `GEMINI_…`, `DEEPSEEK_…`), a branch on a provider id or on the endpoint kind `own`, and a list that repeats registry data (key names, default models, rates, timeouts, efforts, price rows). Also list, as a second table, the non-code places that name a provider key or model: `.env.example`, `deploy/*.env.example`, `deploy/*.yaml`, `package.json` scripts, `docs/capabilities/*`, `docs/own-model.md`, `evals/README.md`, `deploy/README.md`.
- **Shape:** one table row per site: path, symbol, what it names, and the stage of this plan that moves or removes it, or `stays: <reason>`. Expected `stays` sites: `packages/core/src/legal/subprocessors.ts` (owner: no legal change), `apps/server/src/platform/outside-services.ts` (a hand list by design: each outside key is a decision), the web legal texts.
- **Out of scope:** test files and fixtures (about 110 files name `gpt-6-luna` or `gemini-*`; count them, do not list them), gate JSON files, `.ai/`, `tasks/`, `spec/`.

## Step 2 — the scan test with a baseline allowlist

- **Goal:** a test that fails on a new provider-specific site outside the registry, from now on. Stage 07 shrinks its list to the permanent exceptions.
- **Files:** a new unit test in `apps/server/src/platform/llm/` (name: `provider-scan.test.ts`). It reads files with `Bun.Glob` from the repo root.
- **Interface (later stages edit this):** two exported-in-file constants:
  - `REGISTRY_PATHS`: path prefixes that may name providers: `apps/server/src/platform/llm/providers/`, `packages/core/src/llm-providers.ts` (created in stage 02; a missing file is fine).
  - `ALLOWED_SITES: Record<string, string>`: file path → reason. Baseline: each file of the audit table with a site, reason `"old site: stage NN"` or `"stays: <reason>"`.
- **Scan rule:** non-test `.ts` files (`*.test.ts`, `test/`, `e2e/`, `fixtures`, `testing.ts` skipped) under `apps/server/src`, `packages/core/src`, `apps/web/src`, `tools/`. Patterns: `/["'`](openai|gemini|deepseek)["'`]/`, `/\b(gpt|gemini|deepseek)-[a-z0-9.]/`, `/\b(OPENAI|GEMINI|DEEPSEEK)_[A-Z]/`, an unquoted list in usage text `/\b(openai|gemini|deepseek)\s*\|\s*(openai|gemini|deepseek)\b/i`, and a host literal `/\b(openai|deepseek)\.com\b|generativelanguage\.googleapis/`. Review 1 found `eval-args.ts` lists (`gemini|openai`) and `endpoint.ts` hosts that the first three patterns miss. Comments count too (a comment that names a model is stale data); an exception needs a reason.
- **The test also fails** for an `ALLOWED_SITES` entry whose file no longer has a match: a removed site must leave the list, so stage 07 ends with only the true exceptions.

## Test

1. The scan passes at `HEAD` with the baseline list.
2. A fixture string `const m = "gpt-6-luna";` in a temp file under a scanned path that is not listed fails (test the matcher function on a string; do not write into `src`).
3. A listed file with no match fails the stale-entry check (matcher on an empty string).
3a. `"--provider gemini|openai"` and `"api.openai.com"` match (the matcher on these strings).
4. A test file that names `gpt-6-luna` is not scanned.

## Check

`bun test apps/server/src/platform/llm/provider-scan.test.ts`

## Done when

- `audit.md` holds both tables, and each row names its stage or a `stays` reason.
- The scan test passes, and cases 2–4 fail for the right reason when the matcher is fed the bad input.
- The Proof command of `plan.md` prints `PROOF_OK` after the last commit.

## Out of scope

Any change to product code, config or docs.
