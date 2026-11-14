# F119 stage 04 — Member resolution and the SSO audit rows

Part of [`../plan.md`](../plan.md). `[risky]` (auth). Needs stage 03.

## Step 04.1 — `resolveSsoMember` and the flag

**Goal.** No just-in-time accounts (PD-041).

**Files.** Tenancy repo `repo/sso.ts` (new) and service; `packages/core/src/features.ts`; `web.ts`.

**Interfaces.**
- `resolveSsoMember(db: Db, identity: SsoIdentity): Promise<SsoResolution>` (stage 03 types). Kysely reads only, no tenant scope (inside `/api/auth/*`, like `isBreakGlassOwner`).
- Flag `sso_sign_in` in `featureFlags`: default false, epic `E7-T7`, `removeBy: "2027-06-01"`, description "Sign in with the company account (SSO).".

**Decisions.** D5, D13, D16. The order is the rule; the first failing check gives the code:

1. No `sso_providers` row with this `provider_id` → `no_provider` (`orgId: null`).
2. `isFeatureOn(db, { orgId }, "sso_sign_in")` false → `sso_off`.
3. A link exists (`auth_accounts`: this `provider_id`, `account_id` = `subject`) and its user's oldest membership is the provider's organization → `link` (`firstLink: false`; a changed IdP e-mail is accepted). A link whose user fails that → `not_a_member`.
4. No link. `emailVerified === false` → `email_unverified`. The e-mail, lower-cased, has the provider `domain` after the last `@` (a subdomain fails, Q8), and for the issuer `https://accounts.google.com` `hostedDomain` equals the domain (cold review N4) → else `domain_mismatch`.
5. A user with `users.email` = that e-mail whose oldest membership (the session tenant, `requireTenant`) is the provider's organization → else `not_a_member` (cold review N5: another organization's IdP never opens this tenant).
6. That user already has an `auth_accounts` row of this provider with another `account_id` → `identity_mismatch` (the IdP account was made again; the operator runs `org:member --unlink-sso`, stage 09).
7. Else `link` with `firstLink: true`.

The adapter never answers the plugin `continue`: with `requestSignUp: true` that makes a user (spike C5, S9).

## Step 04.2 — SSO audit rows

**Goal.** ADR 0026 point 8 for sign-in, link and refusal.

**Files.** `auditEvents` (audit module), `platform/auth-sso.ts`, `web.ts`.

**Interfaces.**
- `auditEvents.ssoLogin: "sso.login"` (`provider_id`, `first_link`; actor the user) and `ssoRefused: "sso.refused"` (`provider_id`, `code`; actor `"system"`), in the provider's organization.
- `ssoPlugin` deps get `onSsoEvent?: (event: { kind: "login" | "refused"; orgId; userId: string | null; data }) => Promise<void>`; it never throws into Better Auth (catch, log `sso_audit_failed` with `kind`).
- Rule (cold review N13): `sso.refused` is written for each `reject` of our resolver that has an `orgId` (each needs a real IdP sign-in, so no flood). Plugin-level failures (bad state, provider changed, missing claims) and refused passwords (stage 06) get a log line, no row. `sso.login` is written once per callback session, after the plugin transaction commits (`spike.md` S3).
- Log lines `sso_sign_in` (`org_id`, `user_id`), `sso_refused` (`org_id`, `code`): existing fields (the provider id equals the org id).

**Decisions.** D12, D15, D16.

**Test** (`web-sso-resolve.test.ts`, new; the fake IdP; org A, domain `x.test`, proved, flag on unless named):

1. Ann (`ann@x.test`, member of A, `sub` `s-ann`) signs in: a session, one `auth_accounts` row (`account_id = 's-ann'`, tokens null), one `sso.login` in A with `first_link: true`, actor Ann.
2. Ann again: same account row, `sso.login` with `first_link: false`.
3. The IdP changes Ann's e-mail to `ann.new@x.test` (same `sub`): link and sign-in work.
4. `zed@x.test` (no user): no `users` row, no account, no session; `error=not_a_member`; one `sso.refused` row (`code: not_a_member`, actor `system`).
5. `zed@x.test` with `requestSignUp: true`: the same as 4 (S9).
6. Bob (`bob@y.test`, member of A) through A's IdP: `domain_mismatch`; `bob@sub.x.test`: `domain_mismatch`; Ann with `email_verified: false`: `email_unverified`.
6a. A provider with issuer `https://accounts.google.com` (unit, resolver only): Ann with `hd: "x.test"` links; without `hd` or with `hd: "y.test"`: `domain_mismatch`.
7. Cara (`cara@x.test`, member of org B only): `not_a_member`. Dan (`dan@x.test`, member of B first, then of A): `not_a_member`.
8. Ann's link exists with `s-ann`; the IdP sends `ann@x.test` with `sub` `s-ann-2`: `identity_mismatch`, no second account row.
9. Flag `sso_sign_in` off for A (`setOrgFeature`): `sso_off`; `FEATURES_OFF=sso_sign_in` with the row on: `sso_off`.
10. `resolveSsoMember` with `ANN@X.TEST` resolves to Ann.
11. A `resolveSsoMember` that throws: no session, an error redirect, and a `better_auth_log` line without the e-mail.
12. Log and audit capture over 1–11: no client secret, no `id_token`, no IdP e-mail in any line or `data`.

**Check.** The Proof of `plan.md` (`/tmp/f119-s04`).

**Done when.** The twelve tests pass; Proof prints `PROOF_OK`.

**Out of scope.** The session mark and the 12 h cap (stage 05), the security-log kinds (stage 10).
