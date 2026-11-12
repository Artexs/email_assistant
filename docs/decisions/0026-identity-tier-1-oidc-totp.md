# 0026 — Identity tier 1: OIDC sign-in per organization, TOTP, break-glass owner

- Status: proposed (E7 discovery, 2026-11-13). The owner accepted the defaults (PD-040–PD-043); points 2–5 have a second pass after the OIDC spike. The ticket that lands it sets "accepted".
- Date: 2026-11-13
- Amends: 0016 (web panel login with Better Auth: email and password only, sign-up off).

## Context

The panel signs people in with email and password only (`apps/server/src/platform/auth.ts`, Better Auth 1.7.18, sign-up off, invite only; F082 adds lockout, the leaked-password check and terms). A buyer with an identity provider expects company sign-in, a rule that forces it, and a second factor (`04-review-result.md` R6, PD-008: OIDC in Stage 2, SAML and SCIM later).

Facts (sources in `docs/product/stage-2/epics/E07-discovery-notes.md` §3):
- Better Auth has a `two-factor` plugin inside `better-auth` (TOTP, backup codes, trusted devices) and a separate `@better-auth/sso` package (OIDC and SAML, one `ssoProvider` row per connection, DNS TXT domain verification). `@better-auth/sso` 1.7.18 exists for the pinned core.
- By default any signed-in user can register up to 10 SSO providers. A 2026 domain-verification race in the plugin allowed account takeover (fixed in 1.6.27, GHSA-8c5h-wx78-2cfg).
- `disableImplicitSignUp` does not stop a client that sends `requestSignUp: true`; a `resolveUser` hook that returns `reject` does.
- `ts.net` is on the Public Suffix List, so Google and Microsoft Entra accept a redirect URI on the tailnet name (ADR 0017 stays).

## Decision

1. **TOTP** through the Better Auth `two-factor` plugin, with backup codes. Optional for members. Required for operators (ADR 0027) and for the break-glass owner of an organization with "SSO required".
2. **OIDC per organization** through `@better-auth/sso`, pinned to the same version as `better-auth`. One generic OIDC path; each organization registers an app in its own IdP (Microsoft Entra, Google Workspace or another OIDC provider) and gives the issuer, client id and secret.
3. **Only the operator creates or changes providers.** `providersLimit` returns 0 for every other user. No user-facing provider registration.
4. **Domain verification on.** Normal path: DNS TXT. An operator can attest a domain for a test organization that has no DNS control; this writes an audit row `sso.domain_attested`. Nobody else can attest.
5. **No just-in-time accounts.** `resolveUser` links only an existing member of the provider's organization and rejects every other identity. The invite stays the only way in.
6. **"SSO required" per organization.** Email-and-password sign-in and the reset request refuse members of that organization, except one break-glass owner who signs in with password and TOTP.
7. **Offboarding.** A session made by SSO lasts at most 12 hours; then the user signs in through the IdP again, so an account disabled in the IdP loses access within 12 hours. The owner can end a member's sessions.
8. **Audit.** SSO sign-in, link, refusal, provider change, domain verified or attested, TOTP on and off, backup code used: one audit row each, with ids and codes only.
9. **Mailbox access stays apart.** Mailbox OAuth tokens (E9) are not sign-in: separate storage, separate revocation, separate error states.

## Consequences

- New tables from both plugins join the organization-delete test (`information_schema`, S6c D13).
- Members of an organization must reach the panel on the tailnet; a public panel needs a change of ADR 0017.
- The real end-to-end test needs a Microsoft Entra test tenant (owner step). CI uses a local fake OIDC IdP. Google Workspace is supported by the same code and checked for real only when a Workspace tenant exists.
- Each SSO plugin upgrade re-runs the bypass tests (provider registration by a user, `requestSignUp`, domain change after verification).
- The spike (first stage of the OIDC ticket) checks the plugin with the renamed tables (`users`, `auth_*`), the `pg` pool transactions for `resolveUser`, `trustedOrigins` for discovery, the TXT record format, and the session length per sign-in method. A failed spike changes points 2–5 in a second pass.
