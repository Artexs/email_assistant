FAIL 1f704492ea0060f3b1a67b9c1cba5a47ce370fa1

# F119 carry-over review (lock, reset, start-up wiring)

Candidate: branch `limen/2026-11-19-f119-carry-over-fixes-lock-reset-4961c82a`. `git rev-parse HEAD` = `1f704492ea0060f3b1a67b9c1cba5a47ce370fa1`, the same commit as the branch tip. Base: `ee67f9cd`. Scope: `stages/stage-15-vps.md` § "Carry-over from stage 10 review (N3, N4)", plan D16. `review-13.md` holds nothing on these three items.

Result: the code is correct. The lock claim holds, the race test is real, the reset rule is wired and tested, and the start-up test fails without the wiring. One blocking finding: three doc lines still say the opposite of the new reset rule, and the carry-over item asks to "say it in the docs".

## Blocking

**B1 (proven by grep): three doc lines contradict the new reset rule.** The carry-over item reads "Decide whether to refuse resets for SSO-only members and say it in the docs." The candidate changed `web-panel.md` rule 4 and ADR 0026 point 5. It left these three lines unchanged:
- `docs/capabilities/web-panel.md:143` (§ limits): "No password reset is refused for an SSO member (rule 4)." Rule 4 in the same file now says the opposite.
- `docs/capabilities/tenancy-and-plans.md:117`: "An SSO-only member can set a password through a reset link while the reset mail is on and the organization does not require SSO (no code refuses it; default, owner to confirm)."
- `docs/decisions/0026-identity-tier-1-oidc-totp.md:73` (Accepted gaps): "An SSO member can set a password through a reset link while the reset mail is on and the organization does not require SSO."

Fix: change the three lines so that they state the new rule (or remove the gap). The same ADR line also says "No test runs a full callback against a waiting CLI write". `web-sso-callback-lock.test.ts` now runs a real callback against `unlinkSso` and `removeSsoProvider`, the functions that the CLI calls. Correct that sentence in the same edit. For the coordinator: `docs/owner-decisions.md:397-398` ("the code does not refuse it", status `new`) is out of date too. Only the coordinator writes that file.

## Unverified

- U1: I did not measure the reset timing. The reasoning is in N6.
- U2: I did not trace the writes of `parseState` (the OAuth state check that runs before the callback transaction). It touches no provider, user, account or session row in the code paths that I read.
- U3: I did not run the full `bun run test:int:ci` or `test:unit:ci`. I ran only the target files, the mutations, eslint and the typecheck (see "Checks run").

## Notes (non-blocking)

**N1 (proven, source read and mutation): the callback locks the provider row before any user, account or session write.** In `node_modules/@better-auth/sso/dist/index.mjs` (1.7.18), the OIDC callback (lines ~3985-4040) runs `runWithTransaction(adapter, …)`. The first statement in the transaction is `lockSSOProviderForAccountLink` → `lockSSOProviderRow` (lines 2060-2071 and 2115-2129). That is an adapter `update` of `ssoProvider` with `WHERE id = <id> AND provider_id = <providerId>` and `SET provider_id = <same value>`. After it come `resolveOIDCProvider` with a reference check, `resolveUser`, and `handleOAuthUserInfo`, which writes the user, the account and the session in the same transaction. The early return `typeof provider.id !== "string"` does not apply here, because `resolveOIDCProvider` reads the row from the DB (no `defaultSSO`), so `id` is set. With `resolveUser` set, the plugin refuses an adapter that has no native transaction (`assertSSOUserResolutionNativeTransactionSupport`). Postgres takes a `FOR NO KEY UPDATE` row lock for this update. It conflicts with `FOR SHARE` and with `FOR UPDATE` in `lockSsoProvider` (`repo/sso-provider.ts:20-27`). So `unlinkSso`, `removeSsoProvider` and `setSsoProvider` wait for a callback that is in flight. A removal that commits first makes the update match 0 rows, and the plugin answers `SSO_PROVIDER_CHANGED`. A re-added provider has a new `id`, so it also matches 0 rows. A boundary change in place is caught by `ssoProviderAuthBoundaryChanged`. The stage-15 text "stronger than `FOR SHARE`" is correct. The `members.ts:98` comment ("a callback in flight finishes first") is correct now.

**N2 (proven by mutation): the race test tests the race, not only the `org_features` lock.** The `org_features` lock only holds the callback in flight. The test proves the provider lock because the unlink or removal must become a second lock waiter (`waitForLockWaiters(2)`), and the mid-race counts must stay at 0. I set `lockSSOProviderForAccountLink` to `return;` in `node_modules`. Each of the three tests then failed when run alone:
- unlink: "no 2 lock waiters after 10 s"
- removal: "no 2 lock waiters after 10 s"
- callback against a held removal: "no 1 lock waiters after 10 s"

I restored the file (`cmp` showed no difference), and the three tests passed again. One limit: the third test uses raw SQL for the removal, not `removeSsoProvider`. Tests 1 and 2 cover the real functions.

**N3 (proven by reading `web.ts` and `sso-resolve.ts`): the resolver deadlock comment is correct.** `webDeps` passes `resolveSsoMember(db, identity)` with the global pool `db`, not the `database` of the plugin transaction. The resolver therefore reads on another connection. A `FOR SHARE` there would wait for the row lock of its own callback transaction, and that transaction waits for the resolver. Postgres cannot detect this wait across two connections, so the request would hang. The plain SELECT is right.

**N4 (proven, test run): test hygiene in `web-sso-callback-lock.test.ts`.** The test releases `holdFeaturesTable` only on success. In the mutation run, test 1 failed first, and tests 2 and 3 then failed after 35 s each, because the `ACCESS EXCLUSIVE` lock stayed. Each one failed fast when it ran alone. A `try/finally` around `hold.release()` would contain a failure. `waitForLockWaiters` counts every lock waiter in the database. That is safe in an own job DB, and `bun test` runs files one after another.

**N5 (proven, tests and mutation): reset rule and wiring.** `isSsoOnlyMember` (`repo/sso.ts:84-109`) returns true for a user with no `credential` account and at least one membership in an organization that has an `sso_providers` row. It runs as the app role with RLS (`testDb` uses the app-role URL). The production-wiring test (`webDeps` → `createApp`) shows token 0 for the SSO-only member and token 1 for a member who has a password. When I removed the `ssoOnlyMember` line from `web.ts`, that test failed (Expected 0, Received 1). I restored the file. An organization with no provider still gets the mail (test "no password account and no provider", which passed). `web:invite` uses `scripts/invite-delivery.ts`. Its `createAuth` passes neither `passwordSignInRefused` nor `ssoOnlyMember`, so the operator link still works, as the docs claim.

**N6 (reasoned, not measured): no account enumeration.** The refused path returns `RESET_REQUEST_ANSWER` with status 200. The test compares the body with the body for a member who has a password. The answer comes after the rate limiter of Better Auth and after `resetLimiter.take`, so the limits are the same. Timing: all three paths (refused, unknown, known) do a few DB round trips. The mail is queued (`mailTasks.start`), not sent inline, so the timing class is the same as the existing "SSO required" refusal. `||` skips `ssoOnlyMember` when `passwordSignInRefused` is true. That saves one query, inside the same class.

**N7 (proven by reading the allow-list): no bypass through another Better Auth route.** `AUTH_ALLOWED_PATHS` and `isAllowedAuthPath` (`auth.ts:112-142`) open only these auth paths: `/request-password-reset` (POST, only when mail is on), `/reset-password` and `GET /reset-password/:token`, `/change-password`, sign-in, sign-out, session, revoke, two-factor and the two SSO paths. `/forget-password`, `/change-email`, `/sign-up/*` and `/link-social` answer 404. `/change-password` needs the current password, and an SSO-only user has no credential account (`review-13.md` U3 still marks this as not traced in Better Auth).
- Remaining gap (plausible, low): a reset token that was made before the organization got its provider stays valid until `resetLinkTtlSeconds`. `org:sso` does not delete pending `auth_verifications` rows of the members. The docs could name this gap, or `setSsoProvider` (new provider) could drop such tokens.

**N8 (plausible, availability, not security): the rule for a member of several organizations, and for a provider that does not work yet.** The rule refuses the reset when any one membership is in an organization with a provider. The resolver accepts SSO only when the provider's organization is the oldest membership (`sso-resolve.ts:38,51`). So a user with no password whose oldest membership is in an organization without a provider, and who is also a member of an organization with a provider, can use neither SSO nor the reset. The same holds for a provider whose domain is not proved yet, or whose organization has `sso_sign_in` off (default off). In these cases only `web:invite --user-id` helps. `org:member --add` refuses an address that any user already has (`email_taken`), so several memberships are rare. The docs say "a membership in an organization that has an SSO provider row", so code and docs agree. To make the rule exact, the check could ask whether the oldest membership is the provider's organization.

**N9 (proven by mutation and 3 runs): `main-sso-kill.test.ts` fails without the wiring and was stable here.** When I replaced the `log.warn("sso_flag_killed_with_sso_required", …)` line in `main.ts`, test 1 failed (Expected length 1, Received 0) and test 2 passed. I restored the file. Three runs passed in a row, each in about 0.6 s per test. The spawned process is killed (SIGTERM, then SIGKILL in `finally`), and `afterEach` deletes the organization and the user. The test follows `main-start-log.test.ts`. Plausible fragility: every output line goes through `JSON.parse`, so one non-JSON line on stderr would throw. Also, `main.ts` runs `regateAll` and schedules jobs against the shared test DB during about 0.6 s.

**N10 (proven by diff read): ADR 0026 point 5 and `web-panel.md` rule 4 match the code.** These are the generic answer, no mail, no token, the log line `reset_request_refused_sso`, the `isSsoOnlyMember` rule, the exception for an organization with no provider, and `web:invite --user-id`. One small point: rule 4 says "A password comes only from the operator's `web:invite --user-id` link". That is correct for an SSO member. (`org:invite` makes a new owner, not a member.)

**N11: the stage-15 "Done" paragraph matches the code.** The paragraph says "`UPDATE sso_providers SET provider_id = provider_id`". The real statement sets `provider_id` to its literal value with `WHERE id AND provider_id`. The effect is the same.

## Checks run (all at HEAD 1f704492, Bun 1.4.4 = `.bun-version`, own job DB from `scripts/limen-prepare.sh`)

- `bun install --frozen-lockfile`: OK.
- `bun test apps/server/test/integration/web-sso-callback-lock.test.ts`: 3 pass.
- `bun test apps/server/test/integration/web-reset-request.test.ts apps/server/test/integration/main-sso-kill.test.ts`: 16 pass, 0 fail.
- Mutation, `web.ts` without the `ssoOnlyMember` line: the production-wiring reset test fails (Expected 0, Received 1). Restored with `git checkout`.
- Mutation, `main.ts` without the kill log line: main-sso-kill test 1 fails, test 2 passes. Restored.
- Mutation, plugin `lockSSOProviderForAccountLink` → `return;`: the 3 lock tests fail (together, and each one alone). Restored from a backup (`cmp` equal).
- Lock and kill tests, 3 runs in a row: 5 pass each time.
- `bunx eslint` on the 6 changed TS files: exit 0.
- `apps/server` `bun run typecheck` (`tsc --noEmit`): exit 0.
- `bunx prettier --check` on the changed files: only `docs/capabilities/web-panel.md` warns, and the base `ee67f9cd` warns the same (old formatting, not a finding).
- `git status` after the review: only this file is new.
