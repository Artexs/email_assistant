# F119 stage 07 — Discovery and the provider service

Part of [`../plan.md`](../plan.md). `[risky]` (security). Needs stage 04; may run next to 05–06.

## Step 07.1 — The address guard moves to `platform/`

**Goal.** One refused-address list for mail and IdP hosts (review 2, N1); `platform/` imports no module.

**Interfaces.** `platform/net-address.ts` (new) holds `isLocalAddress(ip): boolean`, `LookupAll` and `dnsLookupAll`, moved unchanged from the mail module. That list refuses local, private, CGNAT/Tailscale, link-local, multicast, reserved, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, IPv4-mapped and IPv4-compatible forms. Mail imports them from there; no behaviour change.

## Step 07.2 — Discovery and config

**Interfaces** (`platform/auth-sso.ts`):
- `discoverProviderConfig(issuer, { allowOrigins: readonly string[], timeoutMs, lookup?: LookupAll }): Promise<{ kind: "ok"; discovered } | { kind: "failed"; code: string }>`. It wraps `discoverOIDCConfig` with our predicate (F6, B1). A URL passes when its origin is in `allowOrigins`, or it is `https:` with a DNS-name host (one trailing dot removed): no IP literal, not `localhost`, no `.local`, `.internal`, `.localhost` suffix. Never Better Auth's `trustedOrigins`.
- DNS check (spike C3): `checkPublicHosts(hosts: readonly string[], lookup: LookupAll): Promise<"ok" | "discovery_private_host" | "discovery_dns_failed">`. One answer with `isLocalAddress` true → `discovery_private_host`; a lookup error → `discovery_dns_failed`. `discoverProviderConfig` calls it for the issuer host before discovery and for the endpoint hosts after it, each outside `allowOrigins` (`lookup` default `dnsLookupAll`). A DNS change after the check is accepted (D10). Else `code` is the plugin's discovery code (`issuer_mismatch`, `discovery_untrusted_origin`, …); never its message.
- `buildOidcConfig(discovered, { clientId, clientSecret }): string`: the plugin JSON of `spike.md` S2 (endpoints, `clientId`, `clientSecret`, `pkce: true`, `scopes: ["openid", "email", "profile"]`, `allowIdpInitiated: false`). Tenancy gets the string; it never imports Better Auth.

## Step 07.3 — Service functions

**Goal.** PD-041: only the operator sets and removes a provider.

**Files.** `platform/auth-sessions-end.ts` (new: Kysely deletes on `auth_accounts`, `auth_sessions`; no `better-auth` import; stage 10 reuses it; N8); tenancy.

**Interfaces.**
- `getSsoState(db, ctx): Promise<SsoState | null>`, `SsoState = { providerId, issuer, domain, proof: "dns" | "attested" | null, required, linkedMembers, breakGlassReady }` (`breakGlassReady`: a break-glass owner has TOTP on). Never the config. Stages 08, 09, 11 use it.
- `setSsoProvider(db, ctx, { issuer, domain, clientId, oidcConfig: string, actor, now }): Promise<{ kind: "new" | "secret" | "boundary" | "unchanged" | "not_found" | "domain_taken" }>`. One transaction: `lockOrganization`, then the provider row `FOR UPDATE` (a callback in flight finishes first, N7), then:
  - no row → insert (`provider_id` = org id, unproved): `new`;
  - same issuer, domain and client id, other JSON → update the config; links and sessions stay: `secret`;
  - other issuer, domain or client id (F10, N1) → update, unproved, `sso_required = false`, delete its links and those users' `sso` sessions: `boundary`;
  - identical → `unchanged`, no write;
  - another organization's domain → `domain_taken`.
  - Audit `sso.provider_set` (`provider_id`, `change`, `issuer_host`, `domain`, `links_removed`, `sessions_ended`), actor `cli`.
- `removeSsoProvider(db, ctx, { actor, now }): Promise<{ kind: "removed"; linksRemoved; sessionsEnded } | { kind: "none" }>`: the same lock order; links, their users' `sso` sessions and the provider go; `sso_required = false`; audit `sso.provider_removed`.

**Decisions.** D10, D12, D15, D16.

**Test** (integration and unit; the fake IdP, its origin in `allowOrigins`; configs from `discoverProviderConfig` and `buildOidcConfig`):

1. Set on org A: `new`, one row, unproved, one `sso.provider_set` (`change: new`). Again: `unchanged`, no new row.
2. New secret: `secret`; Ann's link and SSO session stay. New client id: `boundary`.
3. New issuer (a second fake IdP): `boundary`; Ann's link and SSO session gone, her password session stays, `sso_required` false, unproved; counts 1 and 1.
4. Org B sets `x.test`: `domain_taken`.
5. Remove: `removed`, counts right, no row, `sso_required` false; again: `none`.
6. Discovery against a stopped fake IdP: `failed`, no row.
7. Predicate unit: passes `https://login.microsoftonline.com/t/v2.0`, `https://graph.microsoft.com/oidc/userinfo`; refuses `http://idp.x.test`, `https://127.0.0.1`, `https://10.0.0.1`, `https://169.254.169.254`, `https://localhost`, `https://localhost.`, `https://idp.internal`, `https://[::1]`.
8. `checkPublicHosts` with a fake `lookup`: `127.0.0.1`, `::ffff:169.254.169.254`, `64:ff9b::a00:1` (NAT64 of `10.0.0.1`) or `[93.184.215.14, 10.0.0.1]` → `discovery_private_host`; `[93.184.215.14]` → `ok`; `ENOTFOUND` thrown → `discovery_dns_failed`. `discoverProviderConfig("https://idp.x.test")` with `lookup` → `10.0.0.1`: `failed`, `discovery_private_host`, no fetch.
9. The mail host-check and host-guard tests pass unchanged after the move.
10. Log and audit capture over 1–6: no client secret, no `oidc_config`.

**Check.** `plan.md` § Proof (`/tmp/f119-s07`).

**Done when.** The ten tests pass; `PROOF_OK`.

**Out of scope.** The CLI (stage 08); proof, attestation, require (stage 09); the console (stage 11).
