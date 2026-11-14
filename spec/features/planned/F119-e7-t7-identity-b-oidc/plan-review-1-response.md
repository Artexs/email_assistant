# F119 cold review 1 — what changed

Review: [plan-review-1.md](plan-review-1.md) (job `2026-11-14-f119-plan-review-6d37b00a`, `claude-opus-5-5`, candidate `9e2a28b5`). Verdict FAIL, 2 blocking, 16 notes. The planner checked B1, B2, N2 and N6 in the `@better-auth/sso` 1.7.18 tarball and `better-auth` 1.7.18 before the fix.

| Finding | Disposition | Where |
| ------- | ----------- | ----- |
| B1 discovery refuses every untrusted URL | Fixed. F6 corrected. `discoverProviderConfig` gets our own predicate (https, a DNS name, no private suffix) plus `allowOrigins` for tests; Better Auth `trustedOrigins` stays the panel list. Unit test of the predicate with Entra and Graph hosts; spike S9 runs the predicate against `https://accounts.google.com`. | facts F6; stage 07 step 07.1, test 8; stage 01 S9 |
| B2 a session made from an SSO session becomes `password` for 30 days | Fixed. New column `auth_sessions.sso_started_at`; the create hook copies `signInMethod` and `ssoStartedAt` from the current session; the trigger caps on `sso_started_at`. Tests for TOTP turn-on and `/change-password` with `revokeOtherSessions`. | facts F9; D6; stage 02; stage 05 step 05.1, test 5; stage 01 S4 |
| N1 a client id change keeps links | Fixed: a client id change is `boundary`. | stage 07, test 2 |
| N2 `id_token` stays in clear | Fixed: account hooks store no IdP token; `encryptOAuthTokens` dropped. | facts F8; D3; stage 03; stage 01 S7 |
| N3 old password sessions survive `--require on` | Fixed: `--require on` ends the password sessions of members it refuses. | stage 08 step 08.2, test 7 |
| N4 no check that the IdP vouches for the e-mail | Fixed: `SsoIdentity` gets `emailVerified` and `hostedDomain`; `email_verified: false` → `email_unverified`; the Google issuer needs `hd` = domain. | stage 03; stage 04 rule 4, tests 6, 6a |
| N5 one organization's IdP opens another tenant | Fixed: the provider's organization must be the user's oldest membership. | D5; stage 04 rules 3, 5, test 7 |
| N6 bad OAuth state lands on `/api/auth/error` | Fixed: `onAPIError.errorURL = "/login?sso=failed"`, test 10. A domain that loses its proof between sign-in and callback still answers 401 JSON: accepted (only an operator action in the same minute causes it). | stage 03 |
| N7 lock order of a `boundary` set | Fixed: set and remove lock the organization, then the provider row. | stage 07 |
| N8 two owners for the auth-table deletes; tenancy would import the plugin | Fixed: `platform/auth-sessions-end.ts` from stage 07, reused by 08 and 09; the CLI builds the config JSON and passes a string. | stages 07, 09, 13 |
| N9 `domainVerified` mapping path | Fixed (worker hint). | stage 03 |
| N10 every SSO session read writes a row | Accepted: one UPDATE and one `Set-Cookie` per request for SSO sessions only; pilot scale. A `session.update.before` that returns false would end the session (Better Auth treats it as a failed update). | stage 05 |
| N11 the `signInMethod` mapping fails open | Fixed: anything but `"password"` maps to `"sso"`. | stage 05, test 11 |
| N12 the flag off locks out an SSO-required organization | Fixed: a warning in `org:flag` and the console write, and a start-up warn line for `FEATURES_OFF`. | stage 09 step 09.3 |
| N13 the audit rules for refusals disagree | Fixed: one rule (resolver refusals get a row; plugin failures and refused passwords a log line). | D12; stage 04 |
| N14 an unlicensed Entra user has no `email` claim | Fixed: spike S10 checks it; stage 15 check 4 accepts either outcome without a new user. | stages 01, 15 |
| N15 `organizationSlug` gives a 500 | Fixed: a body allow-list on `/sign-in/sso`, test 9. | stage 03 |
| N16 the public route lands without review | Fixed: stage 10 gets a review. | plan § Review |

Unverified items of the review (N1 lock-out size, N14, N15 not run) stay with the spike and the stage tests.
