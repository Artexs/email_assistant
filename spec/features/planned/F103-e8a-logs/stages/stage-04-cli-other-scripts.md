# F103 stage 04 — CLI output in the other scripts; scripts at lint error

Part of [`../plan.md`](../plan.md). Needs stage 03 landed.

Two steps.

## Step 1 — Convert 13 scripts (86 calls)

**Goal.** Every script prints through `createCliOutput`; no script imports `createLog`.

**Files** (`apps/server/src/scripts/`, old-form calls at `0a5c2ee`): `db-worktree.ts` 15, `eval.ts` 8, `org-create.ts` 5, `org-flag.ts` 10, `org-plan.ts` 9, `org-status.ts` 5, `rules.ts` 5, `telegram-check.ts` 6, `telegram-unlink.ts` 4, `testmail-target.ts` 2, `testmail.ts` 8, `triage-cost.ts` 3, `triage-label.ts` 6. Also any script that exists at your base commit and still imports `createLog` (another ticket may have added one, D16): convert it the same way and list it.

**How to convert.** The rules of stage 02 step 2. Also:
- `testmail.ts` and `testmail-target.ts` may keep `error.message` where they print it today (D4). `telegram-check.ts` prints Telegram errors only through `telegramErrorLabel` (D4).
- `org-create.ts:70` prints `created org <id> user <id> plan … trial_ends_at …`; `tenancy.test.ts:191` matches it with `/\[org-create\] created org (\S+) user (\S+)/`. The text stays.

**Decisions.** D3, D4, D16, D23.

**Test.** These integration tests pass unchanged: `org-cli.test.ts`, `org-flag-cli.test.ts`, `rules-cli.test.ts`, `tenancy.test.ts`, `testmail-cli.test.ts`, `testmail-remote.test.ts`, `testmail-target.test.ts`, `telegram-api-root.test.ts`, and the unit test `apps/server/src/scripts/mail-hosts-configured.test.ts`, plus every test that a grep for the script names in `apps/server/test` and `apps/server/src` lists.

**Check.** `grep -rln "createLog" apps/server/src/scripts` prints nothing. Run the tests above.

**Done when.** No script imports `createLog`; the tests pass.

**Out of scope.** Module code (conversion stages).

## Step 2 — `scripts/` at lint error

**Goal.** A new script line in the old log form fails the lint (D8).

**Files.**
- `eslint.config.js`: add `"apps/server/src/scripts/**/*.ts"` to the `files` of the `error` block (the block with the comment "Converted to events (F089)"). Change its comment to: "Converted to events: an old-form log line here fails the lint. Each F103 conversion stage adds its folders."
- `apps/server/src/platform/log-lint.test.ts`: one case in "log lint: converted files fail": `log.info(\`x ${y}\`);` in `apps/server/src/scripts/__log-fixture.ts` (import path `"../platform/log"`) gives `[2]`.
- `docs/code-patterns.md` § Logs: extend the CLI bullet of stage 02 with "Scripts never import `createLog`; `scripts/` is at lint error."

**Decisions.** D8.

**Test.** The new lint case gives `[2]`; the warn cases (virtual folder `lint-fixture/`) still give `[1]`.

**Check.** `bun test apps/server/src/platform/log-lint.test.ts`.

**Done when.** The case passes; the Proof of `plan.md` (`/tmp/f103-s04`) prints `PROOF_OK`; the final message gives the `no-restricted-syntax` warning count (at `0a5c2ee` minus 211: 184).

**Out of scope.** The other folders.
