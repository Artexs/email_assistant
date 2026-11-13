# F091 stage 02 — Split `mail/repo.ts` into `mail/repo/`

Part of [`../plan.md`](../plan.md). Scripts: [`../tools.md`](../tools.md). Decisions: D1, D6–D8, D10, D11. One step. A pure move: no body, no SQL, no importer and no test changes. It may run at the same time as stage 01 (no shared file).

## Step 1 — History merge, generated files, trim commit

**Goal.** `apps/server/src/modules/mail/repo.ts` becomes the folder `apps/server/src/modules/mail/repo/` with the files of D10 and an `index.ts`. Every new file except `index.ts` keeps the history of the old file under `git log --follow` (D7).

**Files.** Deleted: `apps/server/src/modules/mail/repo.ts`. New: `apps/server/src/modules/mail/repo/{shared,mailboxes,folders,credentials,copies,emails,targets,claims,lookup,retention,index}.ts`. No other file.

**Interfaces.** `repo/index.ts` exports exactly the names that `repo.ts` exported (values and types), each from its new file (D11). These keep their imports and resolve to `repo/index.ts` (D6): the 12 files in `mail/` that import `./repo` (`check.ts`, `connect.ts`, `folders.ts`, `index.ts`, `jobs.ts`, `open.ts`, `remove.ts`, `status.ts`, `sync-rules.ts`, `sync.ts`, `tools.ts`, `views.ts`) and `sync-rules.test.ts`, the two e2e seed scripts (`apps/server/src/scripts/e2e-seed.ts`, `e2e-activity-rows.ts`, named in `rootDeepImportExceptions` of `apps/server/src/modules/layers.json`), and the integration tests that import `…/modules/mail/repo`. `copies.ts` imports `../sync-rules`, and `sync-rules.ts` keeps `import type { MovedRow } from "./repo"`: the type-only cycle stays as it is today (plan.md Facts, madge).

**Procedure.** Run from the worktree root, in this order. The tree must be clean before item 4.

1. `mkdir -p /tmp/f091-s02` and copy the four scripts and `mail-map.json` of `tools.md` into it, one file per block: `history-copies.sh`, `split-repo.ts`, `same-bodies.ts`, `exports-of.ts`, `mail-map.json`.
2. Save the old file and its export list:

   ```
   git show HEAD:apps/server/src/modules/mail/repo.ts > /tmp/f091-s02/mail-repo.ts
   bun /tmp/f091-s02/exports-of.ts /tmp/f091-s02/mail-repo.ts > /tmp/f091-s02/exports-old.txt
   git rev-parse HEAD > /tmp/f091-s02/base.txt
   ```

3. Dry run:

   ```
   mkdir -p /tmp/f091-s02/dry && bun /tmp/f091-s02/split-repo.ts /tmp/f091-s02/mail-repo.ts /tmp/f091-s02/dry /tmp/f091-s02/mail-map.json
   ```

   It prints `wrote 11 files to …`. On an error, fix the map by the rules of stage 01 step 1 item 3, with the D10 topics: a mailbox row, status or summary query → `mailboxes.ts`; a folder or cursor query → `folders.ts`; a credentials query → `credentials.ts`; a copy or location identity query → `copies.ts`; an `emails` row write or read by id → `emails.ts`; a cross-organization target list → `targets.ts`; a triage claim or queue query → `claims.ts`; a thread or Message-ID lookup → `lookup.ts`; a retention clear → `retention.ts`. List every map change in the final message.
4. The history merge (keys of the map, in map order):

   ```
   bash /tmp/f091-s02/history-copies.sh apps/server/src/modules/mail/repo.ts apps/server/src/modules/mail/repo shared mailboxes folders credentials copies emails targets claims lookup retention
   ```

   It prints `history merge <sha> with 10 copies`.
5. Generate and format:

   ```
   bun /tmp/f091-s02/split-repo.ts /tmp/f091-s02/mail-repo.ts apps/server/src/modules/mail /tmp/f091-s02/mail-map.json
   bunx eslint --fix apps/server/src/modules/mail/repo/*.ts
   bunx prettier --write apps/server/src/modules/mail/repo/*.ts
   ```

6. Commit at once:

   ```
   git add apps/server/src/modules/mail/repo
   git commit -m "F091 s02: mail repository split by aggregate (trim the history copies)"
   ```

**Decisions.** D1, D6, D7, D8, D10, D11.

**Test.** No new test. The existing tests prove the behaviour: `apps/server/test/integration/mail-*.test.ts`, `imap-*`, `actions-*` (they seed mailboxes and read email locations through these queries), `channels-*`, `retention-*`, `delete-mailbox.test.ts`, the contract suite in `apps/server/test/contract/`, and `mail/sync-rules.test.ts`, all unchanged in the proof.

**Check.**

1. `test ! -e apps/server/src/modules/mail/repo.ts && echo GONE` prints `GONE`.
2. `wc -l apps/server/src/modules/mail/repo/*.ts`: every file under 400 (largest about 257, `folders.ts`).
3. `bun /tmp/f091-s02/same-bodies.ts /tmp/f091-s02/mail-repo.ts apps/server/src/modules/mail` prints `SAME_BODIES <n>` (`n` = 77 at `37e7239`) and exits 0.
4. `bun /tmp/f091-s02/exports-of.ts apps/server/src/modules/mail/repo/index.ts > /tmp/f091-s02/exports-new.txt && diff /tmp/f091-s02/exports-old.txt /tmp/f091-s02/exports-new.txt && echo EXPORTS_SAME` prints `EXPORTS_SAME`.
5. `for f in apps/server/src/modules/mail/repo/*.ts; do [ "$(basename "$f")" = index.ts ] && continue; git log --format=%h --follow -- "$f" | grep -q '^b786f27' || echo "NO HISTORY $f"; done` prints nothing.
6. `git diff --stat "$(cat /tmp/f091-s02/base.txt)" HEAD -- apps/server/test apps/server/src/scripts apps/server/src/modules/mail/index.ts apps/server/src/modules/mail/sync-rules.ts apps/server/src/modules/actions` prints nothing.
7. `bun run graph:modules && git status --short docs/diagrams` prints nothing.

**Done when.** Checks 1–7 hold; the branch has the history merge commit and the trim commit on top. The final message lists any map change and the outputs of checks 3–5.

**Out of scope.** Any body change; the type-only cycle `mail/repo ↔ sync-rules`; `mail/sync.ts` (609 lines, D20); `actions/repo.ts` (stage 01).

## Stage done when

- Step 1 is done, with its checks.
- The Proof of `plan.md` (stages 01–04 form, `NN` = `02`) prints `PROOF_OK`, run after the last commit with nothing after it.
