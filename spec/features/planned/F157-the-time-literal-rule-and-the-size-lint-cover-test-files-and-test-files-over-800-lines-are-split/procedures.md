# F157 procedures — probe, time fix, split

Part of [`plan.md`](plan.md). Stages 01–04 use § Probe and § Time fix; stages 06–20 use § Split.

## Probe

Lists the `ea/no-time-literals` hits in any files, before the config covers them. Write the config to `/tmp/f157-sNN/` (never into the worktree: `bun run lint` lints every file in it).

```bash
mkdir -p /tmp/f157-sNN
cat > /tmp/f157-sNN/probe.config.js <<EOF
import tseslint from "$PWD/node_modules/typescript-eslint/dist/index.js";
import ea from "$PWD/tools/eslint-rules/index.js";
export default [{ files: ["**/*.{ts,tsx,js,mjs}"], languageOptions: { parser: tseslint.parser },
  plugins: { ea }, rules: { "ea/no-time-literals": "error" } }];
EOF
bunx eslint --no-config-lookup -c /tmp/f157-sNN/probe.config.js <files>
```

If the import path of `typescript-eslint` fails, use the path that `node_modules/typescript-eslint/package.json` names. Ignore "Unused eslint-disable directive" lines: the probe has no other rules.

## Time fix

Plan D3. For each hit:

1. Replace the number or chain with the core name, same value, largest whole unit: `5 * 60_000` → `5 * MINUTE_MS`; `24 * 60 * 60 * 1000` → `DAY_MS`; `120 * 60_000` → `2 * HOUR_MS`.
2. Import the names from `@ea/core` (or the path the file already uses for core imports; `packages/core` files import from `../time` or `./time`).
3. A local copy (`const MINUTE = 60_000`, `const HOUR = 60 * MINUTE`) goes; rename its uses.
4. A value that is not a time (a count, a byte size, a port) gets a disable comment with the reason.
5. Never change an expected value, a timeout value or a case. A `test(…, 60_000)` timeout becomes `MINUTE_MS`.

The probe on the stage's files prints nothing at the end. Typecheck passes.

## Split

Plan D5–D11, D14, D15. For each file of the stage, one at a time:

1. **Measure.** `wc -l <file>`. At or under 800: skip it, write that in the log (D11).
2. **Before.** At the stage base (before the history merge) run the old file to JUnit: `bun test --reporter=junit --reporter-outfile=/tmp/f157-sNN/<base>.before.xml <file>`. An int file needs `EA_TEST_WORKER_DB=1` and `--timeout=30000` (the int line of `scripts/check-job.sh`). A failing case is rerun once; a second failure is a stop: report it, do not split around it.
3. **Setup list.** List every top-level statement of the old file that is not a `describe` or `test` call and not an import: hooks (`beforeAll`, `beforeEach`, `afterEach`, `afterAll`), `mock.module`, `setSystemTime`, `let` and `const`, helper functions. The log names, for each, the parts (or the helpers file) that hold it after the trim.
4. **Plan the parts.** Read the top-level `describe` blocks. Choose the topics: each part at most 600 lines, shared state kept together (D7). Shared helpers go to one helpers file (D8).
5. **Name check.** No part path and no new helpers path may exist. For each: `test ! -e <path> && ! git ls-files --error-unmatch <path> 2>/dev/null` (both must hold). The script overwrites an existing file with no warning. A name that exists takes another topic. Siblings that exist at ea317d34 (a natural topic would hit them): `actions-send-{limit,logs,started}`, `actions-committer-logs`, `actions-follow-up-concurrency`, `follow-up-cards-{races,refused}`, `mail-history-backfill-race`, `mail-sync-capture`, `replies-sweep-committed`, `privacy-dsr-erase-outbox`, `retention-clear-sent-concurrent`, `trust-regate-tripwire-race`, `trust-history-job-race`, `web-two-factor-{reset-cli,status}`. After the history merge, `git diff --name-status <base commit> HEAD` shows `D` for the old file and `A` for each part, never `M`.
6. **History merge.** Copy `history-copies.sh` from `spec/features/done/2026-11/F091-repo-split/tools.md` to `/tmp/f157-sNN/`. Run `bash /tmp/f157-sNN/history-copies.sh <old file> <dir> <base>-<topic>.test …` with a clean tree (the script adds `.ts`).
7. **Trim.** In the next commit, each copy keeps only its part, its imports and the setup of step 3 that its cases use; the helpers file is created. Do not leave a copy untrimmed: the duplicate cases fail the proof.
8. **After.** Run each part in its own `bun test` call (its own process), same env as step 2, each to `/tmp/f157-sNN/<part>.after.xml`. One call for all parts can hide a missing hook or mock behind a sibling part.
9. **Proof.** `bun scripts/test-audit/split-proof.ts --before <before.xml> --after <part 1 xml> --after <part 2 xml> …`. It must print `split-proof PASS cases=<n>`. Each `assertions` line is a stop unless the log names its cause (a poll loop, `waitFor`, a retry loop in the case). A lost hook is not a cause: fix the part.
10. **References (D14).** `git grep -n -F <old file name>` (the base name, with and without the folder). Repoint each hit to the part that holds the cited cases, in the same branch: `docs/capabilities/*.md`, `docs/code-patterns.md`, `docs/legal/*.md`, `apps/docs/src/security/claims.ts`, `scripts/test-audit/README.md`, comments and `test:` strings in product code, the `FIXTURE_LABELS` map of `apps/server/src/bare-codes.test.ts` (D15). Do not edit `spec/`, `notes/`, `docs/owner-decisions.md`, `docs/decisions/` or `docs/product/`: they are history. Then `git grep -n -F <old path>` outside those folders prints nothing.
11. **Reference checks.** `bun test apps/server/src/capability-map.test.ts apps/server/src/legal-papers.test.ts apps/server/src/bare-codes.test.ts apps/docs/src/security/claims.test.ts apps/server/src/modules/actions/transitions.test.ts` passes. `check:job` does not run them: they import no changed file.
12. **History.** `git log --follow --oneline <one part> | tail -1` shows a commit of the old file.
13. **Log.** Add the file to `split-log/stage-NN.md` (D10): old lines, parts with lines, the PASS line, the setup list of step 3, the assertion lines with their cause, the repointed references.

Then `bun run check:job`.

**Master moved (D5).** The branch stays unpushed until the land, so a reset rewrites no pushed history. If `master` changed an old file of the stage after the history merge:

1. **Port first.** Merge `master`; on the modify/delete conflict keep the delete. Port `git diff <merge base> master -- <old file>` into the part that holds the changed cases. For a new before XML, write `git show master:<old file>` to the old path, run step 2, delete the file again. Run steps 8–11 again.
2. **Restart.** If the port does not give `split-proof PASS`, reset the branch to the new `master` and split that file again.
3. **Cap.** At most two restarts per stage. A third need is a stop: report the file and the master commits.

Never rebase or squash the branch.

Topic names are short and plain: `mail-sync-idle.test.ts`, not `mail-sync-part-2.test.ts`.
