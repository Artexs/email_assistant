# F119 stage 04 — Member resolution and the SSO audit rows

Part of [`../plan.md`](../plan.md). `[risky]` (auth). Needs stage 03.

## Step 04.1 — `resolveSsoMember` and the flag

**Goal.** No just-in-time accounts (PD-041): the callback links only an existing member.

**Files.** Tenancy repo `repo/sso.ts` (new) and service; `packages/core/src/features.ts`; `web.ts` passes `resolveSsoMember` to `createAuth`.

**Interfaces.**
- `resolveSsoMember(db: Db, identity: SsoIdentity): Promise<SsoResolution>` (types of stage 03). Plain Kysely reads, no tenant scope (it runs inside `/api/auth/*`, like `isBreakGlassOwner`), no write.
- Flag `sso_sign_in` in `featureFlags`: default false, epic `E7-T7`, `removeBy: "2027-06-01"`, description "Sign in with the company account (SSO).".

**Decisions.** D5, D13, D16. The order is the rule; the first failing check gives the code:

1. No `sso_providers` row with this `provider_id` → `no_provider` (`orgId: null`).
2. `isFeatureOn(db, { orgId }, "sso_sign_in")` false → `sso_off`.
3. A link exists: an `auth_accounts` row with `provider_id` = the provider id and `account_id` = `subject`. Its user has a membership in the provider's organization → `link` (`firstLink: false`); the IdP e-mail may have changed (accepted: the IdP owns it). Else → `not_a_member`.
4. No link. `email` lower-cased; its domain (after the last `@`) equals the provider `domain` exactly (a subdomain fails, Q8) → else `domain_mismatch`.
5. A user with `users.email` = that e-mail and a membership in the provider's organization → else `not_a_member`.
6. That user already has an `auth_accounts` row of this provider with another `account_id` → `identity_mismatch` (the IdP account was made again; the operator runs `org:member --unlink-sso`, stage 09).
7. Else `link` with `firstLink: true`.

## Step 04.2 — SSO audit rows

**Goal.** ADR 0026 point 8 for sign-in, link and refusal.

**Files.** `auditEvents` (audit module), `platform/auth-sso.ts`, `web.ts`.

**Interfaces.**
- `auditEvents.ssoLogin: "sso.login"` (data `provider_id`, `first_link`), `auditEvents.ssoRefused: "sso.refused"` (data `provider_id`, `code`). Actor: the user id for `sso.login`, `"system"` for `sso.refused` (the security log already names that actor). Both go to the provider's organization (`orgId` of the resolution), not to the user's oldest membership.
- `SsoPluginDeps.onSsoEvent?: (event: { kind: "login" | "refused"; orgId: string; userId: string | null; data: { provider_id: string; first_link?: boolean; code?: SsoRefusal } }) => Promise<void>`; never throws into Better Auth (catch and log `sso_audit_failed` with `kind`).
- `sso.refused` is written when `resolveMember` answers `reject` with an `orgId` (not for `no_provider`). `sso.login` is written once per session made by the callback, after the plugin transaction commits (a `session.create.after` hook or an after hook on the callback path; the worker picks the one that sees the commit; S3 notes in `spike.md`).
- Log lines: `sso_sign_in` (`org_id`, `user_id`) and `sso_refused` (`org_id`, `code`). These fields exist in `platform/log-fields.ts`; the provider id equals the org id (stage 02), so no new field.

**Decisions.** D12, D15, D16.

**Test** (`apps/server/test/integration/web-sso-resolve.test.ts`, new; fake IdP of stage 03; org A domain `x.test`, provider proved, flag on unless named):

1. Ann (`ann@x.test`, member of A, `sub` `s-ann`) signs in: session cookie, one `auth_accounts` row (`provider_id` = A's provider, `account_id = 's-ann'`), one `sso.login` row in A with `first_link: true`, actor Ann.
2. Ann again: same account row, `sso.login` with `first_link: false`.
3. The IdP changes Ann's e-mail to `ann.new@x.test` (same `sub`): link and sign-in work.
4. `zed@x.test` (no user): no `users` row, no account, no session; `error=not_a_member`; one `sso.refused` row (`code: not_a_member`, actor `system`).
5. `zed@x.test` with `requestSignUp: true`: the same as 4 (S9).
6. Bob (`bob@y.test`, member of A) signs in through A's IdP: `domain_mismatch`; `bob@sub.x.test`: `domain_mismatch`.
7. Cara (`cara@x.test`, member of org B only): `not_a_member`.
8. Ann's link exists with `s-ann`; the IdP sends `ann@x.test` with `sub` `s-ann-2`: `identity_mismatch`, no second account row.
9. Flag `sso_sign_in` off for A (`setOrgFeature`): `sso_off`; `FEATURES_OFF=sso_sign_in` with the row on: `sso_off`.
10. Unit-level on `resolveSsoMember`: `ANN@X.TEST` resolves to Ann.
11. A `resolveSsoMember` that throws: no session, an error redirect, and a `better_auth_log` line without the e-mail.
12. Log and audit capture over 1–11: no client secret, no `id_token`, no IdP e-mail in any line or `data`.

**Check.** The Proof of `plan.md` (`/tmp/f119-s04`).

**Done when.** The twelve tests pass; Proof prints `PROOF_OK`.

**Out of scope.** The session mark and the 12 h cap (stage 05), the security-log kinds (stage 10).
