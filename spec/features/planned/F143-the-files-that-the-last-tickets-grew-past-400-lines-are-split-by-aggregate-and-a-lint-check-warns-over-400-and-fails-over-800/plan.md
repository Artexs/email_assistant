# F143 plan — split the grown files, and a size lint

> **Status 2026-11-20 — planned.** Plan base: 88c37ed3. No stage built.

## Input

Owner words (quality pass 2, `spec/quality/2026-11-20-pass-2.md` finding 3, fix): "One ticket with three moves, using the F091 scripts: `delegation/repo/{delegates,delegations}.ts` and `audit/repo/{audit,llm-calls}.ts` behind the same `index.ts`; `main.ts` start-up blocks into `apps/server/src/start/*.ts` (one per runtime, `main.ts` only calls them); text tables by group like `apps/web/src/i18n/texts/`. Add a lint check (warning over 400, error over 800 lines) so a ticket cannot grow a file silently." Finding 11: "Each `auth-*.ts` file exports `hooksOf(deps)` and `pluginsOf(deps)`; `createBetterAuth` only concatenates them."

Styleguide: "Files under about 400 lines and one aggregate". `docs/code-patterns.md` § Size and shape: split by moves, history merge, `same-bodies.ts` and `exports-of.ts`, never rebase.

### Decisions taken

- **D1 Size rule.** ESLint core `max-lines` at `warn` 400, and the same core rule registered a second time as `size/max-lines-hard` at `error` 800 (`builtinRules` from `eslint/use-at-your-own-risk`; scout 3 probe). Both count every line (blank and comment lines too), so the number equals `wc -l`. Rejected: a `bun test` scan (not in lint, no warning tier); `skipComments` (differs from the count that quality passes use).
- **D2 Covered files** (default, owner to confirm). Every file `eslint .` lints (`ts`, `tsx`, `astro`, `js`, `mjs`) except test code: `**/*.test.{ts,tsx}`, `**/*.spec.ts`, `**/*.test-helper.ts`, `apps/server/test/**`, `apps/*/e2e/**`, `tools/*/test/**`. Rejected: tests included (40 test files are over 800 lines; the test audit F125 owns test files).
- **D3 One limit** (default, owner to confirm). `apps/server/src/file-size.test.ts` (a hard 400 cap on 8 fixed groups from F131) becomes the test of the ESLint rule; its group list goes. Rejected: a strict 400 tier for split groups (two limits for one file, one list entry per split, lands conflict). Cost: those 8 groups now fail at 800, not 400; they keep the warning.
- **D4 Temporary exceptions.** Stage 01 puts each non-test file that is over 800 lines at its `HEAD` into `SIZE_EXCEPTIONS` in `eslint.config.js`, with the stage that removes it. Expected: `delegation/repo.ts` (stage 02), `scripts/e2e-seed-args.ts` (stage 10), `scripts/e2e-seed.ts` (stage 11). For them the error is off; the warning stays. The stage that splits a listed file deletes its entry; the stage that deletes the last entry deletes the constant and its config block. If stage 01 finds another file over 800, it stops and asks. Rejected: land the rule after all splits (the guard comes last).
- **D5 Move method.** The F091 tools (`spec/features/done/2026-11/F091-repo-split/tools.md`), copied to `/tmp/f143-sNN/`: one history merge for each new file, then the trim commit at once; the proof is `same-bodies.ts` (for a non-`repo/` target, adapt the `/tmp` copy to read the new files) and `exports-of.ts`. Never rebase or squash; merge `master`.
- **D6 Redo, do not hand-merge.** If `master` changes a file of the stage after the history merge, the worker resets to the new `master` and runs the split again. Reason: the moves are scripted; a hand merge into copies breaks the body proof.
- **D7 Same names, same paths.** Every export keeps its name and its import path: the old path stays as the index (`repo/index.ts`, or the old file that re-exports by name, nothing else). No importer and no test changes, except the text-reading tests a stage names.
- **D8 Table proof.** A table, map or registry split over files is assembled in its old file in the `HEAD` key order. Proof: a `/tmp` script dumps the assembled value at the base and at the head (a function as its source text, keys in order) and `diff` prints nothing.
- **D9 Start-up.** `main.ts` keeps its path and calls `start/<runtime>.ts` functions in the `HEAD` order; a run tracker replaces the 20 `let …Run` variables (stage 03).
- **D10 Web root.** `web.ts` stays the import path; its parts become root files `apps/server/src/web-<part>.ts` (already under the root lint globs).
- **D11 Auth.** One `before` and one `after` middleware stay; their bodies run an ordered list of parts that the `auth-*.ts` files export (stage 09).
- **D12 E2e seed.** Entry paths `scripts/e2e-seed.ts` and `scripts/e2e-seed-args.ts` stay; parts go to `apps/server/src/scripts/e2e-seed/` (`args-<area>.ts`, `seed-<area>.ts`).
- **D13 Docs.** Stage 01 adds the rule to `docs/code-patterns.md` § Size and shape. A stage that moves a path named in `docs/capabilities/` or `docs/modules.md` updates that page.
- **D14 Rest stays** (default). The other files between 400 and 800 lines keep their warning. The coordinator writes a follow-up ticket for them.
- **D15 Text tables by locale** (default, owner to confirm; stage 05). `<table>-en.ts` and `<table>-pl.ts`; a group split only for a locale file still over 400. Rejected: a group split first (nested tables with functions need `Pick<>` types per group).

Open defaults for the owner: `questions.md` (D2, D3, D14, D15).

Edge cases: two stages that edit `eslint.config.js` (01, 02, 03, 10, 11) or `layers.json` (03, 11) at once resolve by "merge master, re-prove". A split stage that lands before stage 01 finds no `SIZE_EXCEPTIONS`; it removes nothing, and stage 01 then lists only what is still over 800.

## Facts checked

- `eslint .` lints 2,359 files, prints 11 warnings now and exits 0 on warnings; CI runs `bun run lint` with no `--max-warnings`; lint-staged runs `eslint --fix` (scout 3, 2026-11-20).
- The two-severity probe works on ESLint 9.23.0 (scout 3).
- Non-test files over 800 at base: the three in D4 (`wc -l`, this job). Test file `apps/server/test/integration/fixtures.ts` is 805 (excluded by D2).
- `main.ts` exports nothing; `composition.test.ts` and three `*-docs.test.ts` files read its text and match `scheduler.add("<name>"`; it registers 22 jobs (scout 4, `grep`, this job).
- `web.ts` exports 19 names; about 30 integration tests import them from `./web` (scout 4).
- The F091 scripts exist only as text in `tools.md` (scout 1).

## Not verified

- That the F091 scripts still run at `HEAD` (scout 1 ran none). Every split stage runs them first in a dry run.
- The exact ESLint line count for a file without a final newline. Stage 01 test cases fix it.

## Done when

The ticket acceptance (`ticket.md` § Acceptance, 5 items).

## Rules for every stage

- Moves, not rewrites (D5, D7). A gap in a decision, or a deviation, is a question in the final message, not a choice.
- Format only the files of the stage. Keep tool scripts in `/tmp/f143-sNN/`, never in the worktree.
- Run `bun run graph:modules` if the stage adds or removes an import between modules or roots; commit its output.
- A stage that splits a file in `SIZE_EXCEPTIONS` deletes its entry (D4).
- Each stage ends with the move proof logs in `/tmp/f143-sNN/` and names them in the final message.

## Proof

Each stage file names its Proof. The default:

`mkdir -p /tmp/f143-sNN && bun run lint > /tmp/f143-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f143-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f143-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f143-sNN/int.log 2>&1 && echo PROOF_OK`

## User checkpoints and steps

None. No migration, no `bun.lock` change, no real system.

## Review

Stages 03 (start-up) and 09 (auth) are `[risky]` and get an Opus review before the land. Stage 01 gets a Sonnet review (it sets the guard). The others land on the worker's proof and move logs.

## Stages

| # | Stage | Mark |
| --- | --- | --- |
| 01 | [Size lint rule and its test](stages/stage-01-size-lint.md) | |
| 02 | [Delegation, audit and push repositories by aggregate](stages/stage-02-repo-splits.md) | |
| 03 | [Server start-up by runtime](stages/stage-03-start-up.md) | [risky] |
| 04 | [Web composition root by part](stages/stage-04-web-root.md) | |
| 05 | [Core text tables by locale](stages/stage-05-text-tables.md) | |
| 06 | [Core approval cards and notice views](stages/stage-06-cards-and-views.md) | |
| 07 | [Privacy export and address maps](stages/stage-07-privacy-maps.md) | |
| 08 | [Digest, commands and rule suggestions](stages/stage-08-server-parts.md) | |
| 09 | [Auth wiring by part](stages/stage-09-auth-parts.md) | [risky] |
| 10 | [E2e seed constants](stages/stage-10-e2e-args.md) | |
| 11 | [E2e seed steps](stages/stage-11-e2e-seed.md) | |

All stages may run next to each other: no two split the same file. Shared files: `eslint.config.js` (01, 02, 03, 10, 11) and `layers.json` (03, 11), small edits.

## How to run (coordinator)

Move the ticket to `active/` and commit it. Spawn every stage at once (or as slots allow), with the board's worker model, `--prepare 'bash scripts/limen-prepare.sh'` and the text: `Implement F143 stage NN. Read spec/features/active/F143-…/ticket.md, plan.md and stages/stage-NN-<slug>.md. Final proof: the Proof of the stage file. In the final message, list as proven only what a saved log shows.` Do not spawn stage 02 next to an open F142 stage 02, stage 07 next to an open F062 stage 04 or 05, or stages 10–11 next to an open F121 stage 09 or F151 stage. A land of a stage with a history merge: `git pull --no-rebase` (CLAUDE.md). Drop the job DB after each land.

## Planning progress

- Scouts: 4 (`scouts.md`).
- Files: `ticket.md`, `plan.md`, `questions.md`, stages 01–11 [written].
- Word counts (`wc -w`, before the review): plan 1,470, stages 603 / 535 / 692 / 426 / 606 / 444 / 568 / 463 / 650 / 465 / 564.

## Cold review

Not run yet.

## Log

- 2026-11-20: plan written at base 88c37ed3.
