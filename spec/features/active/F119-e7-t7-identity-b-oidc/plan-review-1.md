FAIL 9e2a28b5d72b9ea44260afd0081efc356672451c

The F119 plan fails review. Two findings are blocking. Both are proven by reading the source of `@better-auth/sso` 1.7.18 and `better-auth` 1.7.18. HEAD is 9e2a28b5d72b9ea44260afd0081efc356672451c and matches the candidate. `git diff 69473f4e..HEAD` changes only the F119 folder, so the code I read is the code at the plan base.

## Blocking findings

**B1 (proven by source). F6 is wrong. With the plan as written, `org:sso --set` cannot discover Entra or Google in production. This breaks acceptance bullet 1 (Entra on the VPS) and stage 15.**
- `discoverOIDCConfig` refuses a discovery URL that `isTrustedOrigin` does not accept, on any host. A public host gets no exemption. Source: `@better-auth/sso/dist/index.mjs:394-397` (`validateDiscoveryUrl` → `discovery_untrusted_origin`).
- It then requires every endpoint in the discovery document to be trusted too: token, authorization, JWKS and userinfo. Source: `index.mjs:651-668`, `normalizeAndValidateUrl` at `:686`.
- Only the server-side fetches at runtime use the "private host unless trusted" rule that F6 describes (`index.mjs:430-436`).
- The plan says "Production passes no IdP origin" (`stages/stage-03-plugin.md:15`). It also gives `discoverProviderConfig(issuer, { trustedOrigins, timeoutMs })` (`stage-03-plugin.md:30`).
- The production `trustedOrigins` holds the panel origin and `WEB_TRUSTED_ORIGINS` only (`apps/server/src/web.ts:327`, `platform/auth.ts:297`). So `--set --issuer https://login.microsoftonline.com/<tid>/v2.0` exits with `discovery_failed discovery_untrusted_origin`.
- Trusting only the issuer origin also fails. Entra's `userinfo_endpoint` is on `graph.microsoft.com`, and Google's endpoints are on three googleapis hosts (my knowledge, not checked in this job).
- CI cannot catch this: stage 07 tests trust the fake IdP origin (`stage-07-org-sso-provider.md:35`). The first sign is stage 15, after the VPS deploy.
- Decision needed in stage 03 or 07: the trust predicate that the CLI passes to discovery. One example: any https URL on a public-routable host, used only for this operator-typed issuer. Do not add IdP origins to Better Auth `trustedOrigins`: Better Auth also uses that list for callbackURL and Origin checks.
- Fix F6 to match the source, and add a stage 07 test that runs discovery with the production trust rule.

**B2 (proven by source). A session made again from an SSO session becomes a 30-day `password` session. It skips the 12 h cap and the "SSO required" refusal.**
- When a user turns TOTP on, the plugin makes a new session from the current one: `two-factor/totp/index.mjs:175` (`createSession(user.id, false, activeSession)`). Our code keeps that new session (`auth-two-factor.ts:193`).
- `/change-password` with `revokeOtherSessions` also makes a new session (`api/routes/update-user.mjs:177`). That path is in the allow-list (`auth.ts:69`).
- In `createSession`, the additional-field defaults (`signInMethod: "password"`), `createdAt: now` and `expiresAt: now + 30 d` come after the copied fields, so they replace them (`db/internal-adapter.mjs:285-301`).
- Stage 05 marks a session `sso` only when the path starts with `/sso/callback/`, and "Any other path: unchanged" (`stage-05-sso-session.md:13`). The trigger only caps rows that are already `sso` (`stage-02-migration.md:26`).
- Result: a member of an "SSO required" org who has a password signs in by SSO, then turns TOTP on or changes the password. They get a 30-day session that an IdP disable does not end.
- This breaks the promise of ticket acceptance bullet 4, ADR 0026 points 6–7 and D6. No test covers it: `stage-05-sso-session.md:32-44` tests only the getSession refresh.
- Decision needed: a session made inside a request whose current session is `sso` stays `sso` and keeps the original cap. Add tests for TOTP turn-on and for `change-password` with `revokeOtherSessions` from an SSO session.

## Unverified checks

- Lockout impact of N1: it depends on the Entra fact that `sub` is unique per application ID. That comes from Microsoft docs I know; I did not fetch them in this job.
- N14 and N15 come from reading the source; I did not run them.
- No test suite ran: the diff is plan text only, and nothing could discriminate.

## Notes

- **N1 (conflict proven; lockout plausible).** The plan keeps links when the client id changes, but the plugin treats a client id change as an identity boundary.
  - `stage-07-org-sso-provider.md:15` maps "other client id or secret" to `secret` and keeps links and sessions.
  - The plugin's own boundary list includes `clientId` (`index.mjs:1972-1979`). Its update endpoint refuses such a change while linked accounts exist (`index.mjs:2450`).
  - Entra's `sub` is unique per app registration. A new app registration then sends `identity_mismatch` (stage 04 rule 6) to every linked member. In an "SSO required" org, that locks out everyone except the break-glass owner.
  - Fix: classify a client id change as `boundary`. Change stage 07 test 2.
- **N2 (proven). `encryptOAuthTokens` does not cover `id_token`, so S7 will FAIL.**
  - Only the access and refresh tokens go through `setTokenUtil` (`better-auth/dist/oauth2/utils.mjs:21-27`). `idToken` is written in clear (`oauth2/link-account.mjs:197, 244, 301`), and it holds the IdP e-mail.
  - The spike will report S7 FAIL at `stage-01-spike.md:23`. F8 is true but too narrow.
  - Decide now: `databaseHooks.account.create.before` / `update.before` set `idToken`, `accessToken` and `refreshToken` to null for SSO rows. We never call the IdP API.
- **N3 (gap, proven by plan text). `--require on` leaves existing password sessions alive.**
  - `stage-08-domain-and-require.md:27-29` only sets the flag. Stage 06 refuses only new sign-ins.
  - A member's 30-day password session from before the switch survives an IdP disable (ADR 0026 point 7).
  - Decide: end the password sessions of refused members in the same transaction, with a count in `sso.required_changed`. Or write it down as accepted.
- **N4 (plausible). No rule checks that the IdP vouches for the e-mail.**
  - `SsoIdentity` (`stage-03-plugin.md:27`) drops `verifiedIdTokenClaims`, which the plugin does pass (`index.mjs:3998`). Stage 04 rules 4–5 trust any `email` claim on the domain. D3 rejects `trustEmailVerified`.
  - Google's issuer is shared by all Google accounts. With an External OAuth client, a consumer Google account on the work address (for example an ex-employee's) links to the member.
  - Decide: require `hd` = domain for Google, and/or `email_verified`. This needs a field in the stage 03 interface.
- **N5 (plausible). A user in two orgs: one org's IdP opens the other org's tenant.**
  - The session tenant is the oldest membership (`platform/http.ts:216-227`). Stage 04 rule 5 checks only the provider's org.
  - So an SSO sign-in through org A's IdP can open tenant B and bypass B's "SSO required". The audit row goes to A.
  - D16 "one user has one SSO identity" (`plan.md:26`) conflicts with rule 6, which checks per provider (`stage-04-resolve-member.md:22`).
  - Product paths prevent multi-membership, but e2e-seed and stage 06 test 8 make it. Decide: refuse SSO when the provider's org is not the user's oldest membership.
- **N6 (proven by source). No rule covers an expired or invalid OAuth state.**
  - The plugin then redirects to `onAPIError.errorURL || ${baseURL}/error` (`index.mjs:3821`), which is `/api/auth/error`.
  - The allow-list sends 404 JSON for that path (`auth.ts:62-71`). `onAPIError` sets no `errorURL` (`auth.ts:460`).
  - A domain that lost its proof between sign-in and callback throws 401 JSON, not a redirect (`index.mjs:3840`).
  - Decide on `errorURL` (for example `/login?sso=failed`) and test it.
- **N7 (plausible). Race between a `boundary` set and a callback in flight.**
  - Only remove says to lock the provider row `FOR UPDATE` (`stage-07-org-sso-provider.md:18`). The plugin's callback holds that row through an UPDATE (`index.mjs:2060-2072`).
  - If `boundary` deletes links before it waits on the row, a link committed by an in-flight callback survives. State the same lock order for `boundary`.
- **N8 (proven by plan text). Stage interfaces do not match.**
  - Stage 07 deletes `auth_accounts` and `auth_sessions` rows in tenancy `repo/sso.ts` (`stage-07:15,18`). Stage 09 later makes `platform/auth-sessions-end.ts` for the same deletes (`stage-09:9`). Stage 07 can land first (`plan.md:99`).
  - `docs/code-patterns.md:180` says no repository function touches these tables. Stage 13 (`stage-13-docs.md:15`) does not list the stage 07 deletes or the `linkedMembers` count.
  - `setSsoProvider` gets `config` plus `clientId`/`clientSecret`, so tenancy must call `buildOidcConfig`. That function lives in `platform/auth-sso.ts`, which imports `@better-auth/sso`. This conflicts with "tenancy never imports Better Auth" (`plan.md:53`).
  - Name one owner for these functions, and let the CLI pass the built JSON string.
- **N9 (proven by source). The `domainVerified` column name has one mapping path only.** It comes only from `schema.ssoProvider.fields.domainVerified` (`index.mjs:4623`), not from `options.fields`. This is a worker hint for stage 03; S2 will catch a wrong mapping.
- **N10 (proven by source). Every read of an SSO session writes to the database.** For a capped session, `expiresAt − 30 d + 1 d ≤ now` is always true (`api/routes/session.mjs:180`). Each request then makes one `auth_sessions` UPDATE and a new Set-Cookie. Accept this, or add a `session.update.before` rule.
- **N11 (plausible). The `signInMethod` mapping fails open.** `stage-05-sso-session.md:25` maps any value other than `"sso"` to `"password"`, so a broken field mapping passes SSO sessions to the operator console. Recommend fail closed: missing value → error. Test 7 partly covers it.
- **N12 (proven by plan text; owner default Q5).** Turning `sso_sign_in` off, or `FEATURES_OFF=sso_sign_in`, while "SSO required" is on locks out every member except the break-glass owner. `org:flag` gives no warning. Consider a refusal or a warning in `org:flag`.
- **N13 (proven by plan text). The audit rules for refusals do not agree.**
  - Stage 06 writes no audit row for a refused password ("a flood must not fill the security log", `stage-06:17`). Stage 04 writes one `sso.refused` row per refusal (`stage-04:34`).
  - Plugin-level refusals get no row at all: `invalid_provider`, `SSO_PROVIDER_CHANGED`, `account_ownership_conflict`. Compare ADR 0026 point 8. State the rule.
- **N14 (plausible).** Stage 15 check 4 (`stage-15-entra.md:24`) needs a second Entra user. An unlicensed user may have no `mail`, so no `email` claim. That gives `invalid_provider`/`missing_user_info`, not `not_a_member`, and no `sso.refused` row. Add this to S10 or to U1.
- **N15 (plausible; source read, not run).** A `POST /sign-in/sso` body with `organizationSlug` looks up model `organization` (`index.mjs:3660`). That model is not in our schema, so it throws `Model "organization" not found` (`@better-auth/core/dist/db/adapter/get-default-model-name.mjs:25`). Result: an unauthenticated 500 and a `better_auth_error` line. Consider a body allow-list in stage 03.
- **N16 (note).** Stage 10 adds a public unauthenticated route and extends the operator detail, but lands without review (`plan.md:77`).

## Facts

- Checked and true: F1 (endpoint list, `index.mjs:2239-4410`), F2, F3 (`index.mjs:3992-4005`, `:1600-1612`), F4 (`plugins/two-factor/index.mjs:23-25`), F5 (`session.mjs:180`), F7 (`db/with-hooks.mjs:7-18`).
- F6 is wrong (B1). F8 is true but too narrow (N2).
- Peers of `@better-auth/sso` match `bun.lock`: core ^1.7.18, better-call 1.4.5, @better-fetch/fetch 1.3.3, @better-auth/utils ^0.5.

## Checks I ran

- `git rev-parse HEAD` → 9e2a28b5d72b9ea44260afd0081efc356672451c.
- `git diff --stat 69473f4e HEAD` → 19 files, all in the F119 folder.
- `npm pack @better-auth/sso@1.7.18 --ignore-scripts` into a new empty /tmp folder, then I read `dist/index.mjs`. I deleted the folder afterwards.
- I read `better-auth` 1.7.18 and `@better-auth/kysely-adapter` in the main checkout's `node_modules`.
- `wc -w` → plan.md 1,499 words; largest stage file 695 words. Both are inside § Plan size.
- I ran no test suite: the diff is plan text only.
- One saved-log bash call (only `&&`, exit 0): `/tmp/f119-review/head.log` (HEAD), `diffstat.log`, `f8.log` (id_token in clear), `f5.log` (refresh math), `b2.log` (TOTP turn-on makes a new session).

## Note check

- HEAD matches candidate 9e2a28b5: proven. `/tmp/f119-review/head.log`, from `git rev-parse HEAD > /tmp/f119-review/head.log`.
- Every finding quotes file and line against the plan base 69473f4e: proven. `/tmp/f119-review/diffstat.log` shows that only the F119 folder changed, so HEAD code = base code. Each finding above carries path:line.
- F1–F8 checked against the 1.7.18 sources: not proven for the `@better-auth/sso` half. I read the tarball but deleted it and saved no log, so F1, F2, F3, F6 and the sso parts of B1/N1 have no saved file. The better-auth half is proven: `/tmp/f119-review/f8.log` (F8/N2), `/tmp/f119-review/f5.log` (F5), `/tmp/f119-review/b2.log` (B2).
- Final message starts with `FAIL <sha>` and ends with the verdict and counts: proven. This message.
- Easy-to-miss rule ("missing code detail is not a finding"; "PLAUSIBLE is never blocking"): followed. B1 and B2 are labeled proven by source. Every plausible item is a note. No finding is about line numbers, edit text or file lists.

Verdict: FAIL. 2 blocking findings (B1, B2), 16 notes (N1–N16).
