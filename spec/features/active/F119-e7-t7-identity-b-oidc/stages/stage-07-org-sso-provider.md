# F119 stage 07 — `org:sso`: show, set, remove

Part of [`../plan.md`](../plan.md). `[risky]` (security). Needs stage 04; may run next to 05–06.

## Step 07.1 — Discovery, config and service functions

**Goal.** PD-041: only the operator sets and removes a provider.

**Files.** `platform/auth-sso.ts` (discovery, config JSON); `platform/auth-sessions-end.ts` (new: Kysely deletes on `auth_accounts`, `auth_sessions`; no `better-auth` import; N8); tenancy.

**Interfaces.**
- `discoverProviderConfig(issuer, { allowOrigins: readonly string[], timeoutMs, lookup? })` wraps `discoverOIDCConfig` with our predicate (F6, B1): a URL passes when it is `https:` and its host is a DNS name (no IP literal, not `localhost`, no `.local`, `.internal`, `.localhost` suffix), or its origin is in `allowOrigins`. Never Better Auth's `trustedOrigins`.
- DNS check (spike C3): outside `allowOrigins`, resolve the issuer host before discovery and each endpoint host after it (`lookup`, default `dns.lookup(host, { all: true })`). Any address outside global unicast (IANA special-purpose ranges, IPv4-mapped forms too) → `discovery_private_host`; a lookup error → `discovery_dns_failed`. A DNS change after the check is accepted (operator-only GET).
- `buildOidcConfig(discovered, { clientId, clientSecret }): string` — the plugin JSON of `spike.md` S2 (endpoints, `clientId`, `clientSecret`, `pkce: true`, `scopes: ["openid", "email", "profile"]`, `allowIdpInitiated: false`). The CLI calls both; tenancy gets the string (it never imports Better Auth).
- `getSsoState(db, ctx): Promise<SsoState | null>`, `SsoState = { providerId, issuer, domain, proof: "dns" | "attested" | null, required, linkedMembers, breakGlassReady }` (`breakGlassReady`: a break-glass owner has TOTP on). Never the config.
- `setSsoProvider(db, ctx, { issuer, domain, clientId, oidcConfig: string, actor, now }): Promise<{ kind: "new" | "secret" | "boundary" | "unchanged" | "not_found" | "domain_taken" }>`. One transaction: `lockOrganization`, then the provider row `FOR UPDATE` (a callback in flight finishes first, N7), then:
  - no row → insert (`provider_id` = org id, unproved): `new`;
  - same issuer, domain and client id, other JSON → update the config; links and sessions stay: `secret`;
  - other issuer, domain or client id (F10, N1) → update, unproved, `sso_required = false`, delete its links and those users' `sso` sessions: `boundary`;
  - identical → `unchanged`, no write;
  - another organization's domain → `domain_taken`.
  - Audit `sso.provider_set` (`provider_id`, `change`, `issuer_host`, `domain`, `links_removed`, `sessions_ended`), actor `cli`.
- `removeSsoProvider(db, ctx, { actor, now }): Promise<{ kind: "removed"; linksRemoved; sessionsEnded } | { kind: "none" }>`: the same lock order; links, their users' `sso` sessions and the provider go; `sso_required = false`; audit `sso.provider_removed`.

**Decisions.** D10, D12, D15, D16.

## Step 07.2 — The CLI

**Interfaces.**
- `bun run org:sso --org-id <uuid>`: show `provider`, `issuer <host>`, `domain <d> <proof|unproved>`, `required`, `flag sso_sign_in`, `break-glass <ready|missing>`, `linked <n>`, `redirect <WEB_BASE_URL>/api/auth/sso/callback/<id>`; or `no provider`. Stage 08 adds the `txt` line.
- `--set --issuer <https url> --domain <d> --client-id <id> --client-secret-stdin`: one stdin line, trimmed (empty → exit 1 `client_secret_missing`). No `--client-secret <value>` (D10). Prints the kind and the redirect line.
- `--remove --confirm <domain>` (`confirm_mismatch`, exit 1). Domains are trimmed, lower-cased and checked as in stage 02 (`bad_domain`). Discovery failure: exit 1 `discovery_failed <code>`, nothing written. Errors are event lines; never the secret or the config.

**Test** (`org-sso.test.ts`; the fake IdP as issuer, its origin in `allowOrigins`):

1. Set on org A: `new`, one row, unproved, one `sso.provider_set` (`change: new`). The same set again: `unchanged`, no row.
2. New secret: `secret`; Ann's link and SSO session stay. New client id: `boundary`.
3. New issuer (a second fake IdP): `boundary`; Ann's link and SSO session gone, her password session stays, `sso_required` false, unproved; counts 1 and 1.
4. Org B sets `x.test`: `domain_taken`.
5. Remove with `--confirm x.test`: `removed`, counts right, no row, `sso_required` false; again: `none`. `--confirm y.test`: exit 1, nothing changed.
6. Args unit: no `--org-id`, `--set` without `--issuer`, an `http://` issuer, `--client-secret foo`, two commands: usage, exit 1.
7. Secret `s3cret-value-1\n` on stdin: in `oidc_config`; not in stdout or stderr of set and show, logs or audit `data`; show prints no `clientSecret`.
8. Discovery against a stopped fake IdP: exit 1 `discovery_failed`, no row. Unit: the predicate passes `https://login.microsoftonline.com/t/v2.0`, `https://graph.microsoft.com/oidc/userinfo`; refuses `http://idp.x.test`, `https://10.0.0.1`, `https://localhost`, `https://idp.internal`. Fake `lookup`: issuer host → `127.0.0.1`, `::ffff:169.254.169.254` or `[93.184.215.14, 10.0.0.1]`: `discovery_private_host`; `[93.184.215.14]`: passes; `jwks_uri` host → `192.168.1.1`: `discovery_private_host`.

**Check.** `plan.md` § Proof (`/tmp/f119-s07`).

**Done when.** The eight tests pass; `PROOF_OK`.

**Out of scope.** Proof, attestation, require (stage 08); the console (stage 10).
