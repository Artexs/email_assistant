# F119 stage 15 — Real check with a Microsoft Entra test tenant

Part of [`../plan.md`](../plan.md). `[risky]` (real system, a real identity provider). **The coordinator runs it with the owner** (owner step U1). Needs stage 14. It closes the ticket.

## Owner step U1 (the owner's hands, about 30 min)

1. The Entra test tenant: the Microsoft 365 Business Basic seat that E9a (F117) also uses (E09 notes R10; Q10). The steps and the cost come from `spike.md` S10.
2. In the tenant: register one app (single tenant). Redirect URI (web): the `redirect` line that `org:sso --org-id <test org id>` prints (`https://<panel host>.ts.net/api/auth/sso/callback/<id>`). Make one client secret. Copy the tenant id and the client id.
3. Make one test user in the tenant whose e-mail is `<name>@<tenant>.onmicrosoft.com` (or the tenant's domain).
4. On the VPS (the owner pastes the secret; no agent reads or prints it): `$C run --rm -T server bun run org:sso --org-id <test org id> --set --issuer https://login.microsoftonline.com/<tenant id>/v2.0 --domain <tenant domain> --client-id <client id> --client-secret-stdin`.

## The test organization (coordinator, before U1 step 4)

1. `org:invite --org-name "SSO test" --email <owner test address> --display-name "SSO test owner" --print`: the owner sets a password, turns TOTP on (the break-glass owner).
2. `org:break-glass --org-id <id> --user-id <owner id>`.
3. `org:flag --org-id <id> --flag sso_sign_in --on`.
4. `org:member --org-id <id> --add --email <Entra test user e-mail> --display-name "SSO test member"`.

## Checks (after U1)

1. `org:sso --org-id <id> --attest --confirm <tenant domain>` (no DNS control of `onmicrosoft.com`) → `attested`; `GET /api/sign-in-options` → `{"sso":true}`.
2. The owner opens `/login` on a tailnet device, chooses company sign-in, types the test user's e-mail, signs in at Microsoft: the panel opens. Audit: one `sso.login` with `first_link: true` in the test organization.
3. `auth_sessions` of the test user: `sign_in_method = 'sso'`, `expires_at − sso_started_at = 12:00:00`.
4. A second Entra user who is not a member signs in: no new `users` row. With an `email` claim (`spike.md` S10): `login_sso_error_not_member` and one `sso.refused` row; an unlicensed user without one: the generic error and no row (cold review N14).
5. `org:sso --require on` → `required yes`. The test member's password sign-in (after `web:invite` gave a password): `login_error_credentials`. The break-glass owner signs in with password and TOTP.
6. The owner disables the test user in Entra; `org:member --end-sessions` ends the session; the next company sign-in fails at Microsoft.
7. `$C logs --since "$T" server | grep -iE "eyJ|client_secret|<test user e-mail>"` → no line (`grep -c`, never print matches).
8. Clean up: `org:sso --require off`, keep or remove the provider (ask the owner; the E9a spike may reuse the tenant), `org:delete` the test organization when the owner says so.

Google Workspace stays "by config" (PD-040): no real check until a Workspace tenant exists.

## After

- `plan.md` § Log: date, check results (no ids, no addresses, no tenant name).
- A failed check: a question to the owner with the evidence; it may reopen `spike.md` S10 facts.
- All checks hold: `limen ticket done F119`.

## Done when

Checks 1–8 hold, the log line is written, and the ticket is in `done/`.
