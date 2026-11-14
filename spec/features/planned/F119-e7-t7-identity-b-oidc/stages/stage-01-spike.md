# F119 stage 01 — Spike: the SSO plugin on our schema and pool

Part of [`../plan.md`](../plan.md). `[risky]` (auth). Gate G1 follows: the build stops after this stage.

## Step 01.1 — Probe and report

**Goal.** Prove or refute the plan's assumptions before any product code. The output is `spec/features/active/F119-e7-t7-identity-b-oidc/spike.md`, one row per check: PASS or FAIL, the evidence (command and the line of output), and for a FAIL the plan decision it breaks.

**Files.** Probe code in `.spike-f119/` at the job worktree root, with its own `package.json` (`better-auth` 1.7.18, `@better-auth/sso` 1.7.18, and `pg`, `kysely` at the versions of `bun.lock`). Never commit it; never change the repo `package.json` or `bun.lock`. Commit only `spike.md`.

**Setup.** The job DB from `scripts/limen-prepare.sh` has every migration. Apply the draft SQL of stage 02 (`sso_providers`, `organizations.sso_required`, `auth_sessions.sign_in_method`, the trigger) inside a transaction or a throwaway schema copy, and drop it after. Build a Better Auth instance with the options of `platform/auth.ts` (copy them; same table and field names, `pg` Pool, `cookiePrefix: "ea"`) plus the plugin options of D3 and a minimal fake OIDC IdP on 127.0.0.1 (this may become the stage 03 helper; D17).

**Checks.**

| # | Check | PASS when |
| - | ----- | --------- |
| S1 | Peers and audit | `@better-auth/sso@1.7.18` installs next to `better-auth` 1.7.18 with the repo's `better-call`, `@better-fetch/fetch`, `@better-auth/utils` versions (no second copy of `better-auth` or `@better-auth/core`); `bun audit` on the probe lists no high or critical advisory for the new packages (`samlify`, `@xmldom/xmldom`, `fast-xml-parser`, `jose`, `tldts`). |
| S2 | Schema fit | With the field mapping of D3, a provider row written by plain SQL (stage 02 shape; `oidc_config` = the JSON of `discoverOIDCConfig` plus `clientId`, `clientSecret`) is found by `/sign-in/sso` (by e-mail domain and by `providerId`), and the callback signs a user in. No `better_auth_log` with reason `schema_mismatch` or `other`. `user_id` NULL works. |
| S3 | Transactions | `resolveUser` runs: the adapter has native transactions with our `pg` Pool under Bun (no `SSO_USER_RESOLUTION_REQUIRES_*` error). A `reject` leaves no `users`, `auth_accounts` or `auth_sessions` row and redirects to the error URL with `error=<our code>`. |
| S4 | Session hook | `databaseHooks.session.create.before` sees `ctx.path` starting with `/sso/callback/` for the callback and `/sign-in/email` for a password sign-in; it can set the additional field `signInMethod` (`sign_in_method`) and `expiresAt`. |
| S5 | Cap | After S4, an update of `expires_at` to now + 30 days (what a refresh does, F5) leaves `created_at + 12 h` (trigger). `get-session` after `created_at` is moved 13 h back by SQL returns null and deletes the row. |
| S6 | No TOTP step | A user with `two_factor_enabled` true gets a session from the callback (F4), and our `signInAuditPlugin` writes no `web.login` for it. |
| S7 | Tokens | With `account.encryptOAuthTokens`, `auth_accounts.access_token`, `refresh_token` and `id_token` of the SSO row hold no clear JWT (no `eyJ` prefix) and no test e-mail. |
| S8 | Closed paths | A signed-in user who calls `auth.api.registerSSOProvider` directly (no allow-list in the probe) is refused with `providersLimit: () => 0`. |
| S9 | `requestSignUp` | `signIn.sso({ email, requestSignUp: true })` for an address that is no user still ends in `reject` from `resolveUser`. |
| S10 | Entra facts (docs only, no tenant) | Write, with source URLs and the date: the tenant-specific issuer form (`https://login.microsoftonline.com/<tenant-id>/v2.0`), whether the `email` claim needs the `email` scope or an optional claim, what `email_verified` Entra sends, the redirect URI rules for an app registration, and the cheapest path to a test tenant (E09 notes R10: an M365 Business Basic seat). |

**Decisions.** D1, D3, D5, D6, D7, D17. A FAIL gets no workaround in the probe: write the smallest change that would make it pass and the decision it touches.

**Check.** `test -s spec/features/active/F119-e7-t7-identity-b-oidc/spike.md && git status --porcelain -- package.json bun.lock apps packages db` prints nothing for the last part.

**Done when.** `spike.md` has 10 rows with a verdict and evidence each, plus a one-line summary: `all PASS` or the FAIL list. Committed alone. The repo outside the ticket folder is unchanged. Delete `.spike-f119/` before the job ends.

**Out of scope.** Product code, migrations, ADR edits, a real Entra sign-in.
