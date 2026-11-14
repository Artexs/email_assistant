PASS 7b05dc37d6dcf74072215234015aad0872c20c46

Blocking: 0. Non-blocking: 10 notes and 3 unverified items.

HEAD is 7b05dc37d6dcf74072215234015aad0872c20c46, the same as the candidate. `scripts/plan-drift.sh … 163c7b2` reported "named paths: 73; changed since base: 0; no drift". The plan breaks no acceptance bullet of ticket.md. All 12 "Done when" checks map to stage tests that the plugin code supports.

## Unverified (not blocking)
- U1. F11 `uqr` 0.1.3 (the API, the size 53, MIT). There was no network, and the package is in neither `bun.lock` nor the bun cache. Stage 09 checks it.
- U2. Stage 12 depends on the F099 registry facts (`listSecurityLog` reads `data.locked_until`; the entry shape). `packages/core/src/security-log.ts` is not on HEAD. The plan already makes stage 12 wait for F099.
- U3. I did not run probe P5 again (`tsc --strict` on the plugin options and the trailing plugin type).

## Notes
- N1. Plausible security gap; the mechanism is proven by reading the code. When TOTP is turned on, the user's other sessions stay alive. These sessions never passed a second factor.
  - At enrolment, `node_modules/better-auth/dist/plugins/two-factor/totp/index.mjs` (verify-totp, the `twoFactor.verified !== true` branch) replaces only `activeSession`. D9 (stage 03 rule 1) deletes only `verification` rows.
  - After enrolment, `getSession` returns `twoFactorEnabled: true` for all of the user's sessions. The D10 guard (stage 04, `requireOperator` at `apps/server/src/platform/http.ts:266` and the page guard at `:389`) then admits an old password-only operator session to the console.
  - Root cause: D10 checks the user's TOTP state, not whether this session passed the factor. A later path that makes a session outside the plugin's `signInPaths` would also pass. Examples: `/verify-email` autoSignIn (`api/routes/email-verification.mjs:292`) and the F119 SSO callbacks.
  - Fix: in stage 03 rule 1, also delete the user's other `auth_sessions` rows (all except `newSession.session.id`). Add a test: a second session from before enrolment gives `get-session` null afterwards. Add a D27 line for F119.
- N2. Proven by reading the code: F7 (plan.md "Facts checked") is wrong. `/two-factor/disable` does not need a fresh session.
  - It uses `sensitiveSessionMiddleware` (`api/routes/session.mjs:304-311`). That middleware only checks for an authoritative session.
  - `SESSION_NOT_FRESH` comes only from `freshSessionMiddleware` (`:337-340`).
  - Effects: a stolen old session plus the password can turn TOTP off. The stage 09 `accountTwoFactorError` row `SESSION_NOT_FRESH` and the key `tf_error_not_fresh` are dead. Stage 13 must not copy F7 into the docs.
- N3. Proven by reading the code; the impact is plausible. A backup code can be used with no audit row.
  - `/two-factor/verify-backup-code` accepts `disableSession: true` (`plugins/two-factor/backup-codes/index.mjs:58-70`, and the `if (!ctx.body.disableSession) return valid(ctx)` branch). On the sign-in path this uses up a code and makes no session.
  - On the session path, a signed-in user also uses up a code.
  - Stage 03 rule 2 reports `backup_code_used` only when `requestSession` is null and `newSession` is set, so both cases write no row. This leaves a hole in Done-when 6.
  - Fix: report on every successful verify-backup-code, or refuse `disableSession` in `hooks.before`.
- N4. Plan shape. The rule is "1 `[risky]` step or 2–4 normal steps, about 300 lines" (`~/.pi/agent/skills/plan-task/SKILL.md:50`). plan.md "Differences" item 1 claims the plan keeps it.
  - Stages 04, 05 and 06 are `[risky]` with 2–3 steps each.
  - Stage 05 has three steps in about 300 lines (data, the auth refusal, the CLI). Split 05.2 into its own stage.
  - Plausible: stage 02 (one step: 17 integration cases plus a cookie-jar harness and the plugin) will go over 300 lines.
- N5. Contract drift, proven by reading the doc. `docs/code-patterns.md:123` says that no repository function touches the Better Auth columns of `users`.
  - Stage 05 adds `users.two_factor_enabled` to `getUserAuthProfile` (tenancy repo), and the `org:break-glass` list reads it through that function.
  - Stage 13 adds only `resetTwoFactorRows` as an exception. It must also name this read.
- N6. Plausible. Stage 03 rule 1 (`deleteMany` of the trust rows, then the report) has no try/catch.
  - A throw there turns a committed enrolment into a 500. TOTP is then on, but stage 10 does not reach the codes view.
  - A retry works through the session path, but then the D9 purge never runs.
  - Fail-closed is acceptable. Write it down, or make the retry purge as well.
- N7. Plausible. In the mixed state D22(a), the user flag is true and the row is unverified. In that state, an operator passes the D10 guard and a user passes the `no_two_factor` check of `setBreakGlassOwner`, but TOTP codes cannot work.
- N8. Small drift, proven. D11 gives `clearBreakGlassOwner` → `{cleared}|{none}`, and stage 05 adds `{ kind: "not_found" }`. Make D11 match stage 05.
- N9. Plausible flake. Stage 02 test 17 and stage 03 test 9 search the log lines for every typed code as a substring. A 6-digit TOTP code can match digits in unrelated numbers. Match whole tokens, or leave out the numeric codes.
- N10. Board drift; report only. `spec/build.md:42` still says F105 "needs plan". Row 11 of `docs/product/stage-2/05-execution-plan.md:44` still says "≈ 4" stages and not 14. §2.3 steps 1 and 3 are not in this candidate; the coordinator updates them at the land.

## Checked and holds
- **Hook order** (`api/dispatch.mjs:139-168`): the user `hooks.after` runs first, then the plugin after-hooks in plugin order. After-hooks also run on an APIError (`:236-247`). So F3, D5, D6 and the trailing plugin are correct.
- **Allow-list** (`apps/server/src/platform/auth.ts:54`, 7 paths; `isAllowedAuthPath`): the match is exact. The paths `get-totp-uri`, `send-otp` and `verify-otp` stay 404. `viewBackupCodes` and `generateTOTP` are `serverOnly`.
- **Sign-in paths:** `/reset-password` makes no session (`api/routes/password.mjs`). Server code calls no `signInEmail` or `createSession` outside tests. `databaseHooks.session` (`auth.ts:422-431`) is the login report that stage 02 removes.
- **Trusted-device cookie:** the cookie is HMAC-signed, the row is checked by user id and expiry, and each use renews it (`plugins/two-factor/index.mjs` `readSignInTwoFactorState` and the after hook). Disable deletes only this device's row. Sign-out keeps the cookie (`cookies/index.mjs:244-258`). The D9 purge and the D13 delete by `value` close it.
- **Backup codes:** single use with an optimistic `incrementOne` guard. 10 codes in the form `xxxxx-xxxxx`, stored encrypted.
- **Code limits** (`verify-two-factor.mjs`): 5 per challenge; 10 per account, then a 900 s lock with 429 also for a right code; 3 requests per 10 s on `/two-factor/*`. D8's "the request whose failure reached 10 sees 10" matches the atomic increment.
- **Lock-out and recovery:**
  - An operator without TOTP is sent to the settings page and can enrol there.
  - An operator who loses the phone has the backup codes, or `web:two-factor-reset` over ssh. An operator always has a membership, because `requireTenant` runs before `requireOperator` (`http.ts:366-368`).
  - The break-glass owner cannot turn TOTP off, but the reset clears the mark.
  - A new `WEB_AUTH_SECRET` needs a reset for each user (D25).
  - On rollback, TOTP users sign in with the password only. Stage 14 says this.
- **Leak pre-mortem:**
  - `errorFields` logs only the error name and code (`platform/errors.ts:28`).
  - `onAuthError` drops 4xx errors (`auth.ts:133`).
  - The Better Auth logger maps messages to fixed reason codes.
  - The plugin fields are `returned: false`.
  - The status route returns a count only.
- **Code facts F12:** `web.ts:345`, `web-helpers.ts:40`, `web-http.test.ts:63,65,195`, `http.test.ts:261,323,367,398`. The e2e address blocks 10, 40, 60, 70, 80, 90, 100 (+100) are in use, and 50 and 150 are free. The only `updateTable("memberships")` is `repo.ts:284` (`setDigestTimes`). The 9 callers that stage 07 lists are all of them. The newest migration is `20261114100002_rls_tenant_policies.sql`.
- **RLS:** `memberships` has RLS, but `isBreakGlassOwner` runs from `/api/auth/*` and the CLIs with no tenant scope. Not a problem today.

## Checks run
- `bun install --frozen-lockfile` → 967 packages; better-auth 1.7.18 and @better-auth/utils 0.5.1 are installed.
- `bash scripts/plan-drift.sh …F105… 163c7b2` → "no drift", exit 0.
- Scratch cluster: `initdb` and PostgreSQL 18.6 on a private socket in `/tmp/f105-review`.
  - Applied `db/roles.sql` and the up parts of all repo migrations as `migrator`.
  - Stage 01 SQL went up, down, then up again: all three passed.
  - Grants: `app` has SELECT, INSERT, UPDATE and DELETE on `auth_two_factors`. RLS is on for `memberships` and off for `auth_two_factors`.
  - Constraint probes as `app`:
    - A second break-glass in one org gives a unique violation on `memberships_break_glass_one`.
    - Changing the role of a break-glass owner to assistant gives a violation of `memberships_break_glass_owner_check`.
    - A new 2FA row gets the defaults `verified=f`, `count=0`, `locked_until` null.
    - A second row for one user gives a violation of `auth_two_factors_user_id_key`.
    - Deleting a user cascades to the memberships.
  - The cluster is stopped.
- `bunx prettier --check` on the plan folder warns on 13 files. The F099 plan folder gives the same result, so this is the normal state of plan files, not a finding.
- I did not run lint, typecheck or the test suites: the candidate changes only docs.

## Note check
- Code facts checked against HEAD 7b05dc37: proven. Evidence: the cited files `apps/server/src/platform/auth.ts`, `apps/server/src/platform/http.ts`, `apps/server/src/web.ts`, `apps/server/test/integration/web-helpers.ts`, `apps/server/src/modules/tenancy/repo.ts`, `apps/web/e2e/helpers.ts`, each read in this session. The plan-drift run was in a call that also used `;` and `|`, so by the Limen rule it gives no extra proof.
- Better Auth plugin facts against the pinned version: proven. Evidence: the files `node_modules/better-auth/dist/plugins/two-factor/index.mjs`, `node_modules/better-auth/dist/plugins/two-factor/verify-two-factor.mjs`, `node_modules/better-auth/dist/plugins/two-factor/totp/index.mjs`, `node_modules/better-auth/dist/plugins/two-factor/backup-codes/index.mjs`, `node_modules/better-auth/dist/api/routes/session.mjs` and `node_modules/better-auth/dist/api/dispatch.mjs`, installed by `bun install --frozen-lockfile` (better-auth 1.7.18).
- Each topic judged (break-glass, operator TOTP, lock-out and recovery, trust cookie, backup codes, migration down path, stage size, pre-mortem): not proven for the migration down path, proven for the rest.
  - The rest: judged from the plugin and repo files above. The verdict is in this message, which is not yet a file.
  - Migration down path: the up/down/up run was in a call with `;` and a line break, and no pass log was saved. `/tmp/f105-review/s01.sql`, `/tmp/f105-review/s01down.sql` and `/tmp/f105-review/pg.log` exist but do not show the pass.
- Final message format (first line `PASS <sha>`, then counts, then a list with file:line): not proven. This message is the only evidence, and no file exists until the coordinator files it as `review-<n>.md`.
- Easy-to-miss rule (DB writes only in a scratch cluster, no .env, no VPS, no push, no limen wait, no tool call over 120 s): followed.
  - All DB writes went to the scratch cluster in `/tmp/f105-review` (socket port 55439; `/tmp/f105-review/pg.log`), and the cluster is stopped.
  - No call read `.env`. No ssh, no push, no `limen wait`.
  - Each bash call had a timeout of 120 s or less.
  - Gap: no separate audit log of the commands exists apart from this session.
