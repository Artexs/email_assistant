# F086 · Plan review 1

> Review job `2026-11-13-f086-plan-review-726bb593` (Opus 5.5, thinking high) at commit `548904d`. Its final message points to the message before it for the full result, so both are filed whole below, in order.

## Review message (full result)

PASS 548904d755a2af7e7bab30699af42e9e4ff7541a

The plan holds. I applied the stage code of stages 01–04 in a scratch copy (`/tmp/f086-review/.dot/repo`; the worktree is untouched), and lint, typecheck, unit tests and madge pass. I found no major findings. The notes below are all minor.

## Blocking findings
None.

## Unverified
- **Stage 02 integration tests not run.** This covers `retention-clear.test.ts` and `retention-job.test.ts`. This worktree has no `.env` and no job DB.
  - The behaviour is still shown another way. The new `where((eb) => eb.not(isOpenDelegationDraft(eb, ctx)))` compiles to the same SQL as today's inline block: `not exists (select "delegations"."id" … "draft_action_id" = "actions"."id" and "org_id" = $1 and (status in ('drafted','sent') or (status = 'overdue' and reminders_sent < 2)))`. I compiled it with Kysely `DummyDriver`.
  - The test helpers that the new tests use exist with the stated signatures: `fixtures.ts:290,310,361`, `newOrg(trx, days)` at `retention-job.test.ts:60`, and `over90`. In the new test 2, `draftOf("sent", 0)` seeds one applied draft and one `awaiting_approval` send. So the expected return `1` is correct.
- **ESLint under Bun 1.3.14 (CI) not checked.** All runs used Bun 1.4.4. The plan already lists this (`plan.md:108`).

## Focus checks (verdicts)
- **Stage 02 keeps the open-delegation retention behaviour.** The `keep` rule is required, so typecheck stops any caller that forgets it. The full typecheck passes with stages 01 and 02 applied, including a probe call `keep: (eb) => eb.lit(false)`. After the change, `grep -rn "clearActionPayloads("` shows no call without `keep:`. madge finds 9 cycles and 0 cross-module cycles.
- **Stage 03 zones and fixture test work.**
  - With stages 01–03 applied, `bun run lint` exits 0 with 0 errors in 13.9 s.
  - The 14 fixtures, built from the table at `stage-03:171-186`, all pass. Each failing case gives exactly one `import/no-restricted-paths` message with the stated text.
  - They also pass under a path with dot folders, like the Limen worktree paths.
  - Mutation `actions → triage` in `sameLayerEdges` makes case 4 fail.
  - A `zz-probe` module folder with no layer makes ESLint stop.
- **Stage 04 graph builder and freshness test work.**
  - `bun run graph:modules` prints `[module-graph] module graph: 10 modules, 34 edges`.
  - A second run changes nothing, and `prettier --check` passes on both generated files.
  - My version of the 11 `layers.test.ts` cases passes.
  - Mutation A fails tests 7 and 8 only; they pass again after regeneration.
  - Mutation B fails test 5 only.
  - madge: 9 cycles, all inside one module (`/tmp/f086-review/madge.log`).

## Notes (all minor)
1. **The lint does not catch a cycle that `sameLayerEdges` permits** (conflict with the ticket's acceptance wording). `ticket.md:27` says "`bun run lint` fails on a cycle between two modules". If `sameLayerEdges` lists both directions, the zones permit both imports and lint passes. Only `layers.test.ts` test 3 or 6 catches it. I proved this with the `actions → triage` mutation: borders case 4 then reports no lint error, and only layers test 3 fails. D9 (`plan.md:69`) accepts this. The ticket line should say "lint or `test:unit`".
2. **Gap: a new permitted edge makes the graph stale, but the standards do not say so.** `stage-05:36` and `stage-05:84` say to run `bun run graph:modules` only for a new module. A new edge to a lower layer (the common case) also makes tests 7 and 8 fail. Only the failure message tells the worker what to do.
   - `plan.md:177` (How to run, step 4) warns open branches only at the stage 03 land. Branches that are open at the stage 04 land will fail `test:unit` after rebase.
   - Parallel branches will also conflict in `docs/diagrams/module-graph.{md,json}`.
3. **Two rules conflict: temporary files.** `plan.md:125` says "No temporary files inside the worktree". But `stage-03:134-135` (probe import, the `zz-probe` folder), `stage-03:194` and `stage-04:252-253` (mutations) edit or create files in the worktree for a short time. Add "except the named probe edits, reverted".
4. **Two rules conflict: the CLI standard.** `stage-05:45` says a CLI "loads config and calls a service function of a module index". The stage 04 CLI `apps/server/src/scripts/module-graph.ts` (`stage-04:184`) does neither. Name dev tools as an exception, or put the script outside `apps/server/src/scripts/`.
5. **Stage 03 check fails if the log folder is missing.** At `stage-03:137`, `bun run lint > /tmp/f086-s03/lint.log` runs before anything creates `/tmp/f086-s03` (only the Proof chain makes it). The shell redirect fails and `echo $?` prints 1. Add `mkdir -p /tmp/f086-s03`.
6. **Stage 02 comment instruction is unclear.** `stage-02:109` says "Replace the bare codes `(A23)` in the two comments you touch". The new `PayloadKeepRule` comment has no `A23`. The clearActionPayloads comment has `A23` at `actions/repo.ts:1685`, and `actions/repo.ts:1681` has it too but is not touched. The worker must guess which two comments.
7. **Stage 04 code is not Prettier-formatted.** At `stage-04:122`, the `$comment:` line is longer than 120 characters. Pasted as given, `bun run lint` gives a `prettier/prettier` error (I saw it at `module-graph-build.ts:105` in the copy). The general rule `plan.md:124` (run `bunx prettier --write`) fixes it. The sentence "probe P7 … prettier --check passed" is about the output files, not this source.
8. **Graph builder skips non-relative imports (plausible, not tested).** `stage-04:70` (`if (!fileName.startsWith(".")) continue;`) ignores them, so an import through `@ea/server/...` would not appear in the graph. The lint may still catch it through the resolver. No such import exists today.
9. **Board drift.** `docs/product/stage-2/07-foundation-plan.md:10` still says F086 has 4 stages. D17 (`plan.md:77`) records the change to 5 but names no one to update the table.
10. **Stage size is fine.** Each stage fits one job: 01 and 02 are one step each, 03 and 04 are three steps, 05 is two docs steps.

## Checks run
- `git rev-parse HEAD`: `548904d755a2af7e7bab30699af42e9e4ff7541a` (matches). `git status --short` at the end: empty.
- `bun install --frozen-lockfile`: 967 packages installed.
- In the scratch copy, with the code from stages 01–04 applied:
  - `bun run typecheck`: exit 0 (`/tmp/f086-review/tc.log`). `tsc --noEmit` in `apps/server` with stage 04 applied: exit 0.
  - `bun run lint` after stages 01–03: exit 0, 0 errors and 16 warnings (`lint.log`).
  - `bun run lint` with stage 04 added: 2 errors (`lint2.log`). One is the unformatted stage 04 line (note 7). The other is in my own test file (`no-non-null-assertion`), not the plan's code.
  - `bun test borders.test.ts`: 14 pass. `bun test layers.test.ts`: 11 pass. Both together under a dot-folder path: 25 pass.
  - `bun run test:unit`: 1898 pass, 0 fail (`unit.log`).
  - `bunx madge@8.0.0 --circular …`: exit 1, 9 cycles, cross-module awk count 0 (`madge.log`).
  - Mutations: stage 03 case 4, stage 04 A and B, and the `zz-probe` folder all failed as the stages say.
- `bun run test:int`: not run (no DB).

## Final message

PASS 548904d755a2af7e7bab30699af42e9e4ff7541a

The plan has no blocking finding. My review message above holds the full result: the verdicts on the three focus points, nine minor notes, and every check I ran. One check stays unverified: the stage 02 integration tests did not run, because this worktree has no `.env` and no job DB.

## Note check
- **HEAD is the candidate 548904d7:** proven. `git rev-parse HEAD` printed `548904d755a2af7e7bab30699af42e9e4ff7541a`.
- **Each finding quotes file:line, is marked major or minor, and the five asked categories are checked:** not proven. The evidence is my review message above, and no file holds it until the coordinator files it as `review-<n>.md`.
- **The three focus points each get a verdict backed by the code they name:** proven. The logs are saved in `/tmp/f086-review/`:
  - `tc.log`: typecheck passes with stages 01 and 02 applied.
  - `lint.log`: lint is clean with stages 01–03 applied.
  - `unit.log`: 1898 unit tests pass, including `borders.test.ts` and `layers.test.ts`.
  - `madge.log`: 9 cycles, none across modules.
  - `lint2.log`: lint with stage 04 added. It shows two errors: the unformatted stage 04 line (note 7) and one in my own probe test file, not in the plan's code.
  - A gap remains for stage 02: the integration tests did not run, so that verdict rests on the SQL compare and the typecheck only.
- **Easy-to-miss rule "Do not edit files":** followed. `git status --short --untracked-files=all` printed nothing. I made all stage edits in a scratch copy at `/tmp/f086-review/.dot/repo`. Before any git command there, I removed the copy's `.git` pointer file, so the copy could not touch this worktree's index.
