# F091 stage 01 — Split `actions/repo.ts` into `actions/repo/`

Part of [`../plan.md`](../plan.md). Scripts: [`../tools.md`](../tools.md). Decisions: D1, D6–D9, D11, D12, D21. Two steps. A pure move: no body, no SQL, no importer and no test changes.

Precondition: F086 is landed (`grep -c "openDelegationFilter\|delegation/repo" apps/server/src/modules/actions/repo.ts` prints `0`, and `grep -c "PayloadKeepRule" apps/server/src/modules/actions/repo.ts` prints at least `1`). If not, stop and report it.

## Step 1 — History merge, generated files, trim commit

**Goal.** `apps/server/src/modules/actions/repo.ts` becomes the folder `apps/server/src/modules/actions/repo/` with the files of D9 and an `index.ts`. Every new file except `index.ts` keeps the history of the old file under `git log --follow` (D7).

**Files.** Deleted: `apps/server/src/modules/actions/repo.ts`. New: `apps/server/src/modules/actions/repo/{shared,planned,reads,filters,claims,lifecycle,expiry,undo,sends,drafts,notify,approvals,retention,index}.ts`. No other file.

**Interfaces.** `repo/index.ts` exports exactly the names that `repo.ts` exported (values and types), each from its new file (D11). The 12 files in `actions/` that import `./repo` (`index.ts` and `scope.test.ts` included), `actions/index.ts`, `delegation`'s import of `PayloadKeepRule` through `../actions`, and the tests resolve to `repo/index.ts` without an edit (D6).

**Procedure.** Run from the worktree root, in this order. The tree must be clean before item 4.

1. `mkdir -p /tmp/f091-s01` and copy the four scripts and `actions-map.json` of `tools.md` into it, one file per block: `history-copies.sh`, `split-repo.ts`, `same-bodies.ts`, `exports-of.ts`, `actions-map.json`.
2. Save the old file and its export list (the scripts read these copies; the file is gone after item 3):

   ```
   git show HEAD:apps/server/src/modules/actions/repo.ts > /tmp/f091-s01/actions-repo.ts
   bun /tmp/f091-s01/exports-of.ts /tmp/f091-s01/actions-repo.ts > /tmp/f091-s01/exports-old.txt
   git rev-parse HEAD > /tmp/f091-s01/base.txt
   ```

3. Dry run of the generator into a scratch folder, so a map mismatch shows before any commit:

   ```
   mkdir -p /tmp/f091-s01/dry && bun /tmp/f091-s01/split-repo.ts /tmp/f091-s01/actions-repo.ts /tmp/f091-s01/dry /tmp/f091-s01/actions-map.json
   ```

   It prints `wrote 14 files to …`. If it stops with an error, fix the map in `/tmp/f091-s01/actions-map.json` by these rules, run the dry run again, and list every map change in the final message:
   - "not in the map: X" for a non-exported helper or constant: add X to the file of the function that uses it (`grep -n "X" /tmp/f091-s01/actions-repo.ts`). If two files use it, add it to the file that owns its table or topic (the D9 list); use `shared.ts` only for a helper with no topic, like `DbOrTrx`.
   - "not in the map: X" for an exported function or type: add it to the file of D9 whose functions share its table and status topic (for example a new claim query → `claims.ts`, a new send status setter → `sends.ts`, a new notice query → `notify.ts`). If no file fits, stop and ask.
   - "mapped but not in the file: X": remove X from the map.
   - "one statement, two files", "unsupported top-level statement", "aliased import", "namespace import", "side-effect import": stop and ask (the script cannot move it whole).
4. The history merge (D7). The names are the keys of the map, in map order:

   ```
   bash /tmp/f091-s01/history-copies.sh apps/server/src/modules/actions/repo.ts apps/server/src/modules/actions/repo shared planned reads filters claims lifecycle expiry undo sends drafts notify approvals retention
   ```

   It prints `history merge <sha> with 13 copies`. If you added a key to the map in item 3, add the same name here. Now `HEAD` is the merge commit; the folder holds 13 full copies of the old file.
5. Generate the real files over the copies, then format them:

   ```
   bun /tmp/f091-s01/split-repo.ts /tmp/f091-s01/actions-repo.ts apps/server/src/modules/actions /tmp/f091-s01/actions-map.json
   bunx eslint --fix apps/server/src/modules/actions/repo/*.ts
   bunx prettier --write apps/server/src/modules/actions/repo/*.ts
   ```

   `eslint --fix` sorts the import groups (`import/order`); Prettier wraps long lines. Neither changes a body. Do not edit a file by hand except an import line that `bun run typecheck` names. If anything in items 5–6 fails and you cannot fix it by an import line, go back to the base and start again at item 2: `git reset --hard "$(cat /tmp/f091-s01/base.txt)"` (plan.md § Rules).
6. Commit at once (the merge commit does not build; the trim commit must follow it with nothing between):

   ```
   git add apps/server/src/modules/actions/repo
   git commit -m "F091 s01: actions repository split by aggregate (trim the history copies)"
   ```

**Decisions.** D1 (move, do not rewrite), D6 (no importer changes), D7 (history merge), D8 (generated), D9 (file names), D11 (`index.ts` lists names), D21 (post-F086 map).

**Test.** No new test. The existing tests prove the behaviour: `apps/server/test/integration/actions-*.test.ts` (claims, sends, drafts, expiry, undo, notify queries, retention) and `retention-clear.test.ts` run unchanged in the proof.

**Check.** Run each line; each must give the stated result.

1. `test ! -e apps/server/src/modules/actions/repo.ts && echo GONE` prints `GONE`.
2. `wc -l apps/server/src/modules/actions/repo/*.ts`: every file under 400 (largest about 281, `claims.ts`).
3. `bun /tmp/f091-s01/same-bodies.ts /tmp/f091-s01/actions-repo.ts apps/server/src/modules/actions` prints `SAME_BODIES <n>` (`n` = 92 at `37e7239`, plus any declaration that F086 added, minus `ExpireFilter`) and exits 0.
4. `bun /tmp/f091-s01/exports-of.ts apps/server/src/modules/actions/repo/index.ts > /tmp/f091-s01/exports-new.txt && diff /tmp/f091-s01/exports-old.txt /tmp/f091-s01/exports-new.txt && echo EXPORTS_SAME` prints `EXPORTS_SAME`.
5. `for f in apps/server/src/modules/actions/repo/*.ts; do [ "$(basename "$f")" = index.ts ] && continue; git log --format=%h --follow -- "$f" | grep -q '^cca481b' || echo "NO HISTORY $f"; done` prints nothing.
6. `git log --no-merges --name-only --format= HEAD ^master -- apps/server/test apps/server/src/scripts tools apps/server/src/modules/actions/index.ts apps/server/src/modules/mail apps/server/src/modules/delegation` prints nothing (only the branch's own commits count, also after a `git merge master`).
7. `bun run typecheck > /tmp/f091-s01/typecheck-step1.log 2>&1 && echo TYPECHECK_OK` prints `TYPECHECK_OK`.

**Done when.** Checks 1–7 hold; the branch has the history merge commit and the trim commit on top.

**Out of scope.** Any body change, renaming a function, fixing a comment code, `mail/repo.ts` (stage 02), the cycle `mail/repo ↔ sync-rules`.

## Step 2 — Two file names in `transitions.ts`

**Goal.** The data map names the file that now holds two helpers (D12).

**Files.** `apps/server/src/modules/actions/transitions.ts`.

**Interfaces.** In `PAIR_RULES`, the `enforcedBy` strings `"claimableWhere (repo.ts)"` and `"sendWaits (repo.ts)"` become `"claimableWhere (repo/claims.ts)"` and `"sendWaits (repo/claims.ts)"`. Nothing else in the file changes.

**Decisions.** D12.

**Test.** No test reads these strings (at `37e7239`, `grep -rn "repo\.ts" apps/server/src apps/server/test` printed only these two lines).

**Check.**

1. `grep -rn "repo\.ts" apps/server/src/modules/actions` prints nothing.
2. `bun test apps/server/src/modules/actions/transitions.test.ts` passes.
3. `bun run graph:modules && git status --short docs/diagrams` prints nothing (no module edge changed).

**Done when.** Checks 1–3 hold. Commit: `git add apps/server/src/modules/actions/transitions.ts && git commit -m "F091 s01: transitions names the claims file"`.

**Out of scope.** Other comments of `transitions.ts`; `ACTION_EDGES` callers (they name service files, which do not move).

## Stage done when

- Steps 1 and 2 are done, with their checks.
- The final message lists any change to the map (item 3 of step 1) and the outputs of checks 3–5 of step 1.
- The Proof of `plan.md` (stages 01–04 form, `NN` = `01`) prints `PROOF_OK`, run after the last commit with nothing after it.
