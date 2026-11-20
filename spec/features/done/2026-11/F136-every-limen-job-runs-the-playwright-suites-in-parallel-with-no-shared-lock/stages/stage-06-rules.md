# F136 stage 06 — The lock leaves the rules

Needs stage 05: `proof-parallel.md` (the `PARALLEL_OK` summary and the memory figure). Needs stage 04: the script name `db:migrate:e2e`. Last stage: land without `--keep-open`.

Part of [`../plan.md`](../plan.md). Decisions D9, D10, D12. Proves ticket Acceptance line 6.

## Step 1 — Rule texts in the repo

**Goal.** No rule tells an agent to take the shared lock for `test:e2e`, `docs:test` or `docs:shots`, and the rules say what a job has instead.

**Edits (the worker writes the text in ASD-STE style, short).**
- `CLAUDE.md` § Rules, the "Shared runtime" bullet. Replace the e2e lock sentence with these points:
  - Each Limen job gets its own e2e DB, its own ports for both Playwright suites and its own GreenMail addresses from `scripts/limen-prepare.sh`, so `test:e2e`, `docs:test` and `docs:shots` run with no lock.
  - The main checkout keeps 8081, 8092 and 8093.
  - A Playwright run takes about <figure from proof-parallel.md> of memory. No cap exists; Limen's memory gate acts only at job start (D9).
  - One panel-suite run at a time per worktree: `test:e2e`, `docs:shots` and `demo:record` share its ports, e2e DB and `test-results` (D12).
  - A job prepared before this change runs `bash scripts/limen-prepare.sh` again (D10).
  - After a migration (own or merged), run `bun run db:migrate` and `bun run db:migrate:e2e`.
  Keep the other sentences of the bullet: one migration or `bun.lock` change at a time, and the `:ci` scripts.
- `.agents/limen/styleguide.md`, the line "Checks before a commit": drop "`test:e2e` runs under `flock …`"; say that every job runs it with no lock.
- `docs/code-patterns.md` § Docs site: the `docs:test` and `docs:shots` lines lose "run it under flock …" and say "port from `DOCS_TEST_PORT` (default 8093)" and "the e2e ports from `E2E_PORT` and `E2E_TELEGRAM_PORT`".
- `docs/architecture.md`, the e2e paragraph that names `E2E_DATABASE_URL`: add the port keys, the mail tag and "prepare sets them per job". Grep `docs/` for `8081`, `8092` and `8093` and fix any text that calls them fixed.
- `apps/web/e2e/docs-shots.config.ts`: the lock comment says "ports come from `env.ts`".
- Do not edit `apps/docs/scripts/shot-run.test.ts`. Its comment names the lock, but it is a test file that F125 may still cut before its G1. It goes to the coordinator list below.

**Test.**
1. `grep -rn email-assistant-shared-tests.lock CLAUDE.md .agents docs` finds nothing, exit 1. This is the acceptance itself (D12: the one lock left lives in an F121 stage file, not in these paths).
2. `grep -rn 'flock' CLAUDE.md .agents/limen/styleguide.md docs/code-patterns.md` shows no Playwright command.

## Step 2 — The coordinator list (edits that other tickets and the board own)

**Goal.** The coordinator gets one exact list. The worker writes it into the final message and into `coordinator-edits.md` in this ticket folder. It checks each item at HEAD, because F121 stages may have landed since the plan.

The list, as of the plan:
- `spec/features/active/F121-e10b-public-pages-and-demo/plan.md`, the line "Lock rule until F136 lands …": it becomes "`test:e2e`, `docs:shots` and `docs:test` run with no lock (F136). `demo:record` keeps `flock /tmp/email-assistant-shared-tests.lock`, because it uses the shared demo DB of the main `.env`."
- F121 stages 02, 03, 04, 05 (Check lines), 07 (extra proof link, `docs:shots`), 11 and 12 (extra proof link, `docs:test`): remove `flock /tmp/email-assistant-shared-tests.lock` and the phrase "lock rule until F136 lands". Skip a stage that is already in `done/` or that has landed.
- F121 stage 10: keep the flock on `demo:record` (D12). Drop the sentence "F136 should land first …".
- `spec/build.md` TRACK "Now" bullet and the owner rule 2026-11-20 paragraph: remove "the Playwright lock (`flock …`) until F136 lands" from the list of limits. Also remove the F136 line from NEXT.
- `spec/features/active/F124-…/plan.md`, the line "`test:e2e` only under `flock …`": drop the clause.
- `apps/docs/scripts/shot-run.test.ts`, the comment line about the lock: change it after F125 G1, unless the G1 cut list removes the file.
- The coordinator's drop step: `db:worktree <name> --drop` now drops `<name>-e2e` too, so no new step is needed.

**Test.**
3. `coordinator-edits.md` names each item with its path and the text to remove, and marks items that are already gone as `none at HEAD`.

## Done when

Tests 1–3 pass and `coordinator-edits.md` is committed. Proof links after `test:int:ci`: `! grep -rn email-assistant-shared-tests.lock CLAUDE.md .agents docs > /tmp/f136-s06/grep.log 2>&1`.
