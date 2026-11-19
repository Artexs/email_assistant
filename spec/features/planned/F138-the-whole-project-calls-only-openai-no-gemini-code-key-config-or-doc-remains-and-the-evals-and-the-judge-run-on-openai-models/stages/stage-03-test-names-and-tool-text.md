# F138 stage 03 — Neutral test names and tool text

Part of [`../plan.md`](../plan.md). Needs stage 02 landed.

May run next to stage 04 (it changes only `docs/decisions`, `docs/legal`, `docs/product*`). This stage changes only `apps/`, `packages/`, `deploy/` and `evals/README.md`. Stage 05 runs after both.

## Step 1 — Test fixtures and comments

- **Goal:** no file under `apps/` or `packages/` names Gemini (at base about 60 files, mostly tests and comments).
- **Decisions:**
  - D8: a test that needs "another provider" uses `other`; "another model" uses `model-b` (a third: `model-c`). The meaning of each test stays: a test that checks that a grant on another provider does not match keeps that check with `provider: "other"`.
  - A test whose only purpose was Gemini behaviour (for example the 503 or quota mapping of the deleted adapter, or "Gemini has no effort") is deleted when stage 02 left it without a subject; list each deleted test name in the final message with one reason.
  - A comment that explains a Gemini case is removed or made provider-neutral. Code behaviour does not change in this stage. If a test needs a code change to pass, stop and report it.
  - Integration fixtures (`apps/server/test/integration`, the `trust-*` helpers, `triage-eval-real.test.ts`) follow the same names. A fixture row of `triage_results.model` uses `model-b` where it stood for an old Gemini model.
- **Test:** no new test. The renamed tests pass with the same count as before, minus the listed deletions. Compare the count of `bun test` cases per changed file before and after, and give the numbers in the final message.

## Step 2 — Tool and deploy text

- **Goal:** the run books describe only OpenAI.
- **Files and decisions:**
  - `evals/README.md`: remove § "Quota (Gemini)" and every option text that lists `gemini`; the judge text already follows stage 01. Keep the list of old result files: a line that names an old Gemini result file is history and stays (allowed hit).
  - `deploy/README.md`: the sim env step copies `^(OPENAI_|LLM_PROVIDER=)` only (no `GEMINI_` in the `sed` or `grep` pattern). Any other Gemini text in the run book goes.
  - A help or usage text under `apps/server/src/scripts` that still names Gemini follows `llmProviderIds`.
- **Test:** the existing tests of `deploy/test` and `apps/server/src/scripts` pass.

## Check

`bun test apps/server/src packages/core deploy/test` while you work; the Proof at the end.

## Done when

- `git grep -niE "gemini|@google/genai|generativelanguage" -- apps packages deploy .env.example package.json bun.lock` finds nothing.
- `git grep -niE "gemini" -- evals ':!evals/results'` finds only lines in `evals/README.md` that name an old result file.
- The Proof (`sNN` = `s03`) prints `PROOF_OK`.

## Out of scope

`docs/`, `README.md`, `CLAUDE.md` (stages 04 and 05); any behaviour change.
