# F103 stage 04 — CLI output in the other scripts; scripts at lint error

Part of [`../plan.md`](../plan.md). Needs stage 03 landed.

Two steps.

## Step 1 — Convert 14 scripts (102 calls)

**Goal.** No old-form log line is left in `apps/server/src/scripts/`.

**Files** (`apps/server/src/scripts/`, old-form calls at `560e74e7`): `db-worktree.ts` 15, `eval.ts` 9, `eval-sim.ts` 15, `org-create.ts` 5, `org-flag.ts` 10, `org-plan.ts` 9, `org-status.ts` 5, `rules.ts` 5, `telegram-check.ts` 6, `telegram-unlink.ts` 4, `testmail-target.ts` 2, `testmail.ts` 8, `triage-cost.ts` 3, `triage-label.ts` 6. Also every other old-form line that the lint finds in `scripts/` at your base (D16): convert it the same way and list it.

**How to convert.** The rules of stage 02 step 2. Also:

- `testmail.ts`, `testmail-target.ts`, `eval.ts`, `eval-sim.ts` and `triage-label.ts` keep each `error.message` print they have today (D4, D23); add no new one. `telegram-check.ts` prints Telegram errors only through `telegramErrorLabel`.
- `org-create.ts` prints `created org <id> user <id> …`; `tenancy.test.ts` matches it with a regex. The text stays.
- Event-form lines and `process.stdout.write` output stay (D26): `org-delete.ts`, `org-export.ts`, `org-dsr.ts`, `org-break-glass.ts`, `web-two-factor-reset.ts`, `stats-week.ts` and the event lines of `eval-sim.ts`, if any, keep `createLog`. A script whose last old-form line moves drops its `createLog` import only if no event line is left.

**Decisions.** D3, D4, D16, D23, D26.

**Test.** These tests pass unchanged: `org-cli.test.ts`, `org-flag-cli.test.ts`, `rules-cli.test.ts`, `tenancy.test.ts`, `testmail-cli.test.ts`, `testmail-remote.test.ts`, `testmail-target.test.ts`, `telegram-api-root.test.ts`, `org-delete-cli.test.ts`, `org-export-cli.test.ts`, the unit tests `scripts/mail-hosts-configured.test.ts`, `scripts/eval-sim.test.ts`, `scripts/eval-sim-gate.test.ts`, and every other test that names one of these scripts.

**Done when.** `bun run lint` shows no `no-restricted-syntax` message in `scripts/`; the tests pass.

## Step 2 — `scripts/` at lint error

**Goal.** A new old-form line in a script fails the lint (D8).

**Files.**

- `eslint.config.js`: add `"apps/server/src/scripts/**/*.ts"` to the `files` of the `error` block (comment "Converted to events (F089)"). New comment: "Converted to events: an old-form log line here fails the lint. Each F103 conversion stage adds its folders."
- `platform/log-lint.test.ts`, "converted files fail": ``log.info(`x ${y}`);`` at `apps/server/src/scripts/__log-fixture.ts` (import `"../platform/log"`) gives `[2]`.
- `docs/code-patterns.md` § Logs: extend the CLI bullet of stage 02: "`scripts/` is at lint error for old-form lines. A script may log a failure as an event line (`org_delete_refused`); free text goes through `createCliOutput`."

**Decisions.** D8, D26.

**Test.** The new case gives `[2]`; the warn cases (virtual folder `lint-fixture/`) still give `[1]`.

**Done when.** The case passes; the Proof (`/tmp/f103-s04`) prints `PROOF_OK`; the final message gives the warning count (416 − 228 = 188 at `560e74e7`).

**Out of scope.** Module code (conversion stages). Moving event lines or `process.stdout.write` to `out` (D26).
