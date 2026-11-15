# F117 stage 09 review (Opus): result PASS, test gaps fixed, notes kept

Source: `.limen/jobs/2026-11-15-f117-review-s09-opus-oauth-callb-74ff6a6c/result`. Reviewed commit 83592168. No blocking finding.

## Fixed in the fix job

- N1: merge with master. Conflict in `openapi-routes.test.ts` (keep `const extras`, add `sendScope: { kind: "off" }`); `extrasOf` in `mail-oauth-connect.test.ts` got `sendScope`.
- TG1: test 17 asserts `login.imap` and `login.smtp` are empty. Reviewer mutation m1 (first provider check of Reconnect removed) now fails test 17 (`/tmp/f117-s09-fix/mut-m1.log`).
- TG2: tests 1 and 24 assert `cache-control: no-store` on the redirect. Mutation m3 fails both (`/tmp/f117-s09-fix/mut-m3.log`).
- N7: test 18 counts only the not-granted advisory lock with the key of its own mailbox (`classid`, `objid`, database), so another suite cannot end the wait early.
- N5, N6: carry-over written to `stages/stage-10-refresh.md`.

## Notes left open

- N2 Login CSRF is safe. The owner and suspended checks run before the state consume: the state row stays until it expires. Only the same user, organization and provider can redeem it; the code is single use and needs the PKCE verifier. Mutation m2 (checks after the consume) fails test 21.
- N3 Secrets: the canary test 28 holds. The request log uses the route pattern; `errorFields` logs name and code only.
- N4 Connect matches stage 09.2. N8 Sent switch follows `sent_sync` (tests 1, 1b). N9 Only GET is public (real `webDeps` test); route is in `PUBLIC_ROUTES`, `HIDDEN_ROUTES` and `tenant-scope-sites.test.ts`.
- N5 Reconnect: no `OAuthTokens` implementation exists yet (stage 10). No path changes `imap_host` or `smtp_host` after the insert.
- N10 Equivalent mutants accepted: `org_id` drop in `finishMailboxReconnect` and `lockMailbox`; a single drop of the provider check under the lock. A single drop of the first check was NOT equivalent (side effect: a login at the wrong hosts): TG1.
- Unverified: a crash between the redeem and the commit (no test); "drop after the commit" (no test can tell it from "inside the transaction").

## Owner steps carried

- U1: Microsoft may return no `id_token` when the redeem sends `scope` without `openid` (rows M2, M12, stage 21).
- U2: stage 21 runs the real provider smoke with the owner's test accounts (browser sign-in).
