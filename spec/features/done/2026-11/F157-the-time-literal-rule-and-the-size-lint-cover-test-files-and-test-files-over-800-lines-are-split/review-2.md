PASS f50875d4df90fac59b78261db413dcd6b630f02a. This is the same verdict as my earlier report, with one check still open.

## Note check

- eslint.config.js has no ignore that hides test code from the size rule: proven. `eslint.config.js` has no `sizeIgnores`, and its size block lists only `files: sizeFiles`. The global ignores in that file are dist, .astro, schema.ts, .pi, .omp and the `.gitignore` file.
- apps/server/src/file-size.test.ts scope cases fail if an ignore returns: not proven. `apps/server/src/file-size.test.ts` has the 801-line cases for `.test.ts`, `apps/server/test` and the e2e spec, plus the 401-line test-helper case. I did not run it, because `bun test` stopped with `Cannot find module '@ea/core'` (no `node_modules` in the worktree). The gap: an installed checkout has to re-add an ignore and see the 801-line `.test.ts` case fail.
- The lab-executive split keeps the same cases and no weaker assertion: proven, with one limit. `/tmp/old-names` and `/tmp/new-names` hold the 14 case names before and after, and they are identical. `/tmp/oe` and `/tmp/ne` hold the 109 assertion lines before and after, and they are identical as sorted sets. The limit is that this compares names and line sets, not each case body.
- docs/code-patterns.md states the new size rule for test files: proven. `docs/code-patterns.md` § Size and shape now says the rule covers test code. It adds the split convention and a pointer to the F157 folder.

**Easy-to-miss rule** ("Run no suite, lint or typecheck."): followed. I ran only git, grep, wc and diff commands, plus one `bun test apps/server/src/file-size.test.ts`. That single-file run is the one the task allows, and it failed to start. I ran no lint and no typecheck.

**Project reminders:**
- One test file only, no `test:*` suites: followed. I ran the single file once and did not repeat it.
- `bun run check:job` as the last step: not applicable. This is a review job and I committed nothing.
- Review job runs no suite, lint or typecheck: followed (see the rule above).
- Never delete `node_modules/.cache/`: followed. I did not touch it.
- No `--no-verify` commit: followed. I made no commit.

**Remaining gap:** the file-size scope test has never been executed in this job. It stays unverified and not blocking. The worker's `check:job` line and CI should cover it. I did not install dependencies to clear it.
