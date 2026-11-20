# F143 plan — split the grown files, and a size lint

> **Status 2026-11-20 — planned.** Plan base: 88c37ed3. No stage built.

## Input

Owner words (quality pass 2, `spec/quality/2026-11-20-pass-2.md` finding 3, fix): "One ticket with three moves, using the F091 scripts: `delegation/repo/{delegates,delegations}.ts` and `audit/repo/{audit,llm-calls}.ts` behind the same `index.ts`; `main.ts` start-up blocks into `apps/server/src/start/*.ts` (one per runtime, `main.ts` only calls them); text tables by group like `apps/web/src/i18n/texts/`. Add a lint check (warning over 400, error over 800 lines) so a ticket cannot grow a file silently." Finding 11: "Each `auth-*.ts` file exports `hooksOf(deps)` and `pluginsOf(deps)`; `createBetterAuth` only concatenates them."

### Decisions taken

- **D1 Size rule.** Core `max-lines` at `warn` 400, and the same core rule registered again as `size/max-lines-hard` at `error` 800 (`builtinRules`, `eslint/use-at-your-own-risk`). Both count every line, as `wc -l` does. Rejected: a `bun test` scan (no warning tier); `skipComments` (differs from the quality-pass count).
- **D2 Covered files** (default, owner to confirm). Every file `eslint .` lints (`ts`, `tsx`, `astro`, `js`, `mjs`) except test code: `**/*.test.{ts,tsx}`, `**/*.spec.ts`, `**/*.test-helper.ts`, `apps/server/test/**`, `apps/*/e2e/**`, `tools/*/test/**`. Rejected: tests included (40 test files are over 800 lines; the test audit F125 owns them).
- **D3 One limit** (default, owner to confirm). `apps/server/src/file-size.test.ts` (a hard 400 cap on 8 fixed groups from F131) becomes the test of the ESLint rule; its group list goes. Rejected: a strict 400 tier for split groups (two limits, one list entry per split). Cost: those groups fail at 800, not 400.
- **D4 Temporary exceptions.** Stage 01 lists each non-test file over 800 lines at its `HEAD` (built again after its final merge) in `size-exceptions.json`; one config block turns the error off for them. Expected: `delegation/repo.ts` (stage 02), `scripts/e2e-seed-args.ts` (10), `scripts/e2e-seed.ts` (11). The stage that splits a listed file deletes its entry; the stage that deletes the last entry deletes the file, its read and the block. Stage 01 test case 9 fails on a stale, foreign or empty list. Rejected: land the rule after all splits (the guard comes last).
- **D5 Move method.** The F091 tools (`spec/features/done/2026-11/F091-repo-split/tools.md`), copied to `/tmp/f143-sNN/`: one history merge for the new files, then the trim commit at once. Proof: `same-bodies.ts` (for a non-`repo/` target, adapt the `/tmp` copy to read the new files), `exports-of.ts`, and an import check: each import of a new file names a module that the old file imported, or a sibling of the split. Never rebase or squash; merge `master`.
- **D6 Redo, do not hand-merge.** If `master` changes a file of the stage after the history merge, reset to the new `master` and split again (a hand merge into copies breaks the body proof).
- **D7 Same names, same paths.** Every export keeps its name and import path: the old path stays as the index (`repo/index.ts`, or the old file re-exporting by name). No importer changes. A test that reads a moved file as text changes only the file it reads; each stage names the ones known and greps for more. Asserts change in meaning only where stages 03 and 12 say.
- **D8 Table proof.** A split table, map or registry is assembled in its old file in the `HEAD` key order. A `/tmp` script dumps it before the first change and after the trim (functions as source text, whitespace collapsed); `diff` prints nothing.
- **D9 Start-up.** Stage 03 puts a run tracker and a shutdown unit under test inside the old file; stage 12 then moves the blocks to `start/<runtime>.ts`. `main.ts` keeps its path and the `HEAD` block order.
- **D10 Web root.** `web.ts` stays the import path; parts become `apps/server/src/web-<part>.ts`.
- **D11 Auth.** One `before` and one `after` middleware stay; they run an ordered list of parts from the `auth-*.ts` files, built from one part context per auth instance (stage 09).
- **D12 E2e seed.** Entry paths stay; parts go to `apps/server/src/scripts/e2e-seed/`.
- **D13 Docs.** Stage 01 adds the rule to `docs/code-patterns.md`; a stage that moves a path named in `docs/` updates it.
- **D14 Rest stays** (default). Other files of 400–800 lines keep a warning; a follow-up ticket splits them.
- **D15 Text tables by locale** (default, owner to confirm; stage 05). Rejected: a group split first (nested tables with functions need `Pick<>` types per group).
- **D16 No value import cycle.** A value that two files of a split need goes to a leaf file; a part never imports a value from the file that re-exports it (a review repro failed at load).
- **D17 Export map by key range.** The owners of `EXPORT_MAP` keys interleave, and the export order is the key order; slices are consecutive key ranges (stage 07). Rejected: slices by owner (reorders the export).

Owner defaults: `questions.md`.

Conflicts on `eslint.config.js` or `layers.json`: merge `master`, re-prove.

## Facts checked

- `eslint .` exits 0 on warnings (11 now); CI and lint-staged pass no `--max-warnings`; the two-severity rule works on ESLint 9.23.0; `max-lines` counts like `wc -l` (scout 3, `plan-review-1.md`, 2026-11-20).
- Non-test files over 800 at base: the three in D4. `main.ts` registers 22 jobs and waits for 20; `web.ts` exports 19 names; the F091 scripts exist only as text (`scouts.md`).

## Not verified

- That the F091 scripts still run at `HEAD`. Every split stage runs them first in a dry run.
- The review found `/tmp` full (quota) on 2026-11-20. A worker that cannot write `/tmp/f143-sNN/` stops and reports; the coordinator frees space.

## Done when

`ticket.md` § Acceptance (5 items).

## Rules for every stage

- Moves, not rewrites (D5, D7, D16); every move stage runs the D5 import check too. A gap in a decision, or a deviation, is a question in the final message.
- Format only the files of the stage. Tool scripts and logs go to `/tmp/f143-sNN/`, never into the worktree.
- Run `bun run graph:modules` if the stage adds or removes an import between modules or roots; commit its output.
- A stage that splits a file in `size-exceptions.json` deletes its entry (D4).

## Proof

`mkdir -p /tmp/f143-sNN && bun run lint > /tmp/f143-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f143-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f143-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f143-sNN/int.log 2>&1 && echo PROOF_OK` (stage 11 adds the e2e run).

## User checkpoints and steps

None (no migration, no `bun.lock` change, no real system).

## Review

Stages 03, 09 and 12 (`[risky]`): Opus review before the land. Stage 01 (the guard): Sonnet review. The others land on the proof and the move logs.

## Stages

| # | Stage | Mark |
| --- | --- | --- |
| 01 | [Size lint rule and its test](stages/stage-01-size-lint.md) | |
| 02 | [Delegation, audit and push repositories](stages/stage-02-repo-splits.md) | |
| 03 | [Run tracker and shutdown of the start-up](stages/stage-03-runs-and-shutdown.md) | [risky] |
| 04 | [Web composition root by part](stages/stage-04-web-root.md) | |
| 05 | [Core text tables by locale](stages/stage-05-text-tables.md) | |
| 06 | [Core approval cards and notice views](stages/stage-06-cards-and-views.md) | |
| 07 | [Privacy export and address maps](stages/stage-07-privacy-maps.md) | |
| 08 | [Digest, commands and rule suggestions](stages/stage-08-server-parts.md) | |
| 09 | [Auth wiring by part](stages/stage-09-auth-parts.md) | [risky] |
| 10 | [E2e seed constants](stages/stage-10-e2e-args.md) | |
| 11 | [E2e seed steps](stages/stage-11-e2e-seed.md) | |
| 12 | [Start-up files by runtime](stages/stage-12-start-files.md) | [risky] |

Stage 12 needs stage 03. All other stages may run next to each other: no two split the same file.

## How to run (coordinator)

Move the ticket to `active/` and commit it. Spawn every stage whose Needs are met (board worker model, `--prepare 'bash scripts/limen-prepare.sh'`, text: `Implement F143 stage NN. Read ticket.md, plan.md and stages/stage-NN-<slug>.md. Final proof: the Proof of the stage file.`). File overlaps with other tickets are advisory (`spec/build.md`): start the stage; a land conflict is D6 for a split stage, "merge master, re-prove" for the rest. Overlaps: F142 stage 02 (stage 02), F062 stages 04–05 (07), F145 and F149 (08), F141 provider scan (10), F121 stage 09 and F151 (10, 11), F145 and F150 lint rules (01). Land a stage with a history merge with `git pull --no-rebase` (CLAUDE.md). Drop the job DB after each land.

## Planning progress

- Scouts: 4 (`scouts.md`).
- Files: `ticket.md`, `plan.md`, `questions.md`, stages 01–12 [written].
- Word counts (`wc -w`, after review 1): plan 1,495, stages 687 / 523 / 688 / 504 / 590 / 466 / 580 / 491 / 682 / 490 / 599 / 597.

## Cold review

Opus 5.5 (the plan has `[risky]` stages: start-up, auth). Verdict FAIL: 2 blocking, 15 notes (`plan-review-1.md`). All fixed, none rejected: B1 text-reading tests named per stage (D7); B2 history copy for `auth-password.ts`; N1 D16; N2 `size-exceptions.json` and case 9; N3 shutdown unit; N4 order fact; N5 part context; N6 fallback; N7 D17; N8–N11 stage 11, 01, proofs without a second worktree; N12 import check (D5); N13 advisory overlaps; N14 lint seams; N15 stage 03 split into 03 and 12.

## Log

- 2026-11-20: plan written at base 88c37ed3; review 1 fixed.
