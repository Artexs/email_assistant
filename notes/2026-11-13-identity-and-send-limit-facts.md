# Identity (Better Auth SSO, 2FA) and provider send-limit facts (2026-11-13)

Facts found in the E7 discovery session. Decisions are in `docs/product/stage-2/epics/E07-platform-and-trust.md` and ADR drafts 0026, 0027. Sources and dates: `docs/product/stage-2/epics/E07-discovery-notes.md` §3.

## Better Auth

- `two-factor` is inside `better-auth` (`node_modules/better-auth/dist/plugins/two-factor`): TOTP, OTP, single-use backup codes, trusted devices (30 days).
- SSO is a separate package `@better-auth/sso` (not installed today). Versions 1.7.18–1.7.22 exist; `@better-auth/sso@1.7.18` peers `better-auth ^1.7.18`. Pin both to the same version.
- Default: any signed-in user can register up to 10 SSO providers. Set `providersLimit` to a function that returns 0 for non-operators.
- A domain-verification race allowed account takeover; fixed in `@better-auth/sso@1.6.27` (GHSA-8c5h-wx78-2cfg, 2026-08-11). Never go below it.
- `disableImplicitSignUp` does not stop `signIn.sso({ requestSignUp: true })` from any client. Refuse unknown users in `resolveUser` (`{ action: "reject" }`). `resolveUser` runs in a DB transaction.
- SSO identity = provider id + OIDC `sub`. Implicit linking to an existing user needs a verified provider domain, a matching email domain, a verified local email (invites set `email_verified = true`) and account linking on.
- Organization auto-provisioning needs the Better Auth organization plugin; this project has its own tenancy, so link users in `resolveUser`.
- Discovery fetches `{issuer}/.well-known/openid-configuration`; the IdP origin must be in `trustedOrigins`.
- Open PR 9750 (2026): the TXT check may fail when the record holds the raw token. The spike checks the format.

## OIDC on the tailnet

- Google redirect URIs: HTTPS, no raw IP, the host TLD must be on the Public Suffix List, no wildcards.
- `ts.net` is on the Public Suffix List. A redirect URI on `<machine>.<tailnet>.ts.net` is allowed: OIDC needs no public domain.
- Microsoft Entra multi-tenant (`/common`) tokens carry the tenant in `iss`; many libraries fail that check. A per-organization provider with the tenant issuer avoids it.

## Provider send limits (for the E7 send caps)

- Exchange Online: 30 messages per minute; 10,000 recipients per rolling 24 h; at the limit the mailbox cannot send until the count drops.
- Gmail (Workspace): 2,000 messages per rolling 24 h (500 on trial accounts); at the limit, no send for up to 24 h; spam-like senders can be restricted for good.
- The E7 defaults (20 per mailbox per hour, 100 per 24 h, 5 per recipient per 24 h) sit far below both.
