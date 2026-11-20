# F152 stage 02 — F139-2 asserts pauses and probe order

Needs: no earlier stage. Reads `deploy/test/restore.test.ts` test F139-2 and its helpers `sleepCalls`, `dockerCalls`, `indexOfCall`, `PROBE` (written by F139 stage 01, in `master`). May run next to stage 01 (no shared file). A worker job.

Part of [`../plan.md`](../plan.md). Not `[risky]`. No migration, no `bun.lock` change.

## Step 1 — two asserts in F139-2

**Goal.** The new-host restore test proves the same wait shape as the drill test F139-1 (D8, the optional note of the F139 review).

**Files.** `deploy/test/restore.test.ts` only. No change to `deploy/restore.sh` or the stubs.

**Test.** F139-2 (`init-probes` = 3, `--target new-host --stdin`) keeps its current asserts and gains:

1. `sleepCalls()` equals `["sleep 1", "sleep 1", "sleep 1"]`.
2. Each of the 4 probe indexes is greater than the index of the `up -d --wait db` call in `dockerCalls()` (the same check as F139-1). If the new-host target writes the `up` call in another form (it uses `ea_compose_init`, not the drill `-p ea-drill` command), match the form the stub records; do not loosen F139-1.

Keep the test name, or extend it to say "with 3 pauses, after up". Use the existing helpers; add no new helper unless two tests use it.

**Break check.** Change `sleep 1` in `wait_db_tcp` of `deploy/restore.sh` to `sleep 2` in the work tree, run `bun test deploy/test/restore.test.ts`: F139-1 and F139-2 fail. Then restore the line (`git checkout deploy/restore.sh`). Commit nothing from that run. Write the command and the failing test names in the final message.

**Check.** `bun test deploy/test/restore.test.ts` passes.

**Out of scope.** Other tests, `deploy/restore.sh`, docs.

**Done when.** Both asserts are in F139-2; the break check failed as described; the last line of `bun run check:job` is `check:job PASS master=… tip=…`.
