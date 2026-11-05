# s1b-shadow-triage — Stage 9

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 9 — LLM config keys [risky]

- [x] **9.1 Config keys and the LLM switch**
  - Goal: the server reads the LLM keys and the real-mail switch from env, checked with Zod.
  - Files: change `apps/server/src/platform/config.ts`, `apps/server/src/platform/config.test.ts`, `.env.example`.
  - Interfaces (new keys in `configSchema`):
    - `GEMINI_API_KEY`: optional (empty string → undefined).
    - `GEMINI_MODEL`: string, default `gemini-3.8-flash` (writer role and fallback).
    - `GEMINI_MODEL_CLASSIFIER`: string, default `gemini-3.5-flash-lite` (empty string → the default). Export `classifierModel(config): string` (returns `GEMINI_MODEL_CLASSIFIER`).
    - `GEMINI_TIMEOUT_MS`: int, default 30000.
    - `GEMINI_RPM`: int > 0, default from step 0.2 (else 10).
    - `LLM_DAILY_CAP`: int > 0, default from step 0.2 (else 300): LLM call attempts per mailbox per America/Los_Angeles day (stage 24).
    - `TRIAGE_LLM_SCOPE`: `z.enum(["off", "synthetic", "all"]).default("off")`.
    - A `superRefine`: `TRIAGE_LLM_SCOPE` other than `off` needs `GEMINI_API_KEY` (issue path `GEMINI_API_KEY`); `TRIAGE_LLM_SCOPE=all` also needs `TEST_MAILBOX_ADDRESS` (issue path `TEST_MAILBOX_ADDRESS`). `ConfigError` names the key.
  - Decisions: all config from env, checked at start; a missing key stops the start (code-patterns). The VPS `.env` has an empty `GEMINI_API_KEY` and no `TRIAGE_LLM_SCOPE`: with these defaults the server still starts, and no mail goes to the LLM. `off` = the triage worker does not run. `synthetic` = it takes only synthetic mail, in every mailbox. `all` = real mail too, but only in the mailbox whose address equals `TEST_MAILBOX_ADDRESS`, until a paid-tier key exists (main-session decision 2026-11-04, ADR 0013). Timeout 30 s, daily cap 300 (ADR 0012).
    - Classifier model (user answer 2, 2026-11-04): default `gemini-3.5-flash-lite` (837 ms on the free tier, not a preview model). `GEMINI_MODEL` (writer, S4) stays `gemini-3.8-flash`.
    - Limits: read the numbers under "Input" → "Real limits for this project" (step 0.2). `GEMINI_RPM` default = classifier RPM × 0.8, rounded down, min 1. `LLM_DAILY_CAP` default = 300 when 300 ≤ classifier RPD − 100, else classifier RPD − 100 (100 calls per day stay free for eval runs: the worker and the eval runner share one project quota). No numbers there yet → `GEMINI_RPM` 10 and `LLM_DAILY_CAP` 300, and write a log line. Third-party figure: about 500 RPD for `gemini-3.5-flash-lite` [not verified].
    - `.env.example` lists every key with a comment. Put `TRIAGE_LLM_SCOPE=off` with the comment "all = real mail of the TEST_MAILBOX_ADDRESS mailbox goes to Gemini. Free tier: only the temporary pilot mailbox (ADR 0013). Any other person's mail: Cloud Billing first (ADR 0007/0012/0013). synthetic is not a security boundary." Put `GEMINI_MODEL_CLASSIFIER=gemini-3.5-flash-lite`.
  - Test: defaults with only the S1a keys (scope `off`, classifier `gemini-3.5-flash-lite`, writer `gemini-3.8-flash`, cap and RPM defaults); `TRIAGE_LLM_SCOPE=synthetic` without a key → `ConfigError` with `GEMINI_API_KEY`; with a key it passes; `TRIAGE_LLM_SCOPE=all` with a key and without `TEST_MAILBOX_ADDRESS` → `ConfigError` with `TEST_MAILBOX_ADDRESS`; with both it passes; a bad scope value fails; an empty `GEMINI_MODEL_CLASSIFIER` gives the default; `classifierModel` returns the set value.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass; `main.test.ts` still passes.
  - Out of scope: `gemini-check.ts` (it keeps reading `process.env`).
