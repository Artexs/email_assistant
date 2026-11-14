# F119 stage 03 — Plugin, allow-list, fake IdP

Part of [`../plan.md`](../plan.md). `[risky]` (auth). The only `bun.lock` change of F119; no other `bun.lock` change of any ticket runs next to it.

## Step 03.1 — The fake IdP test helper

**Goal.** A local OIDC provider for every SSO test (D17).

**Files.** `apps/server/test/fake-oidc.ts` (new).

**Interfaces.**
- `startFakeOidc(opts?: { emailClaim?: boolean }): Promise<FakeOidc>`, with `FakeOidc = { issuer: string; origin: string; clientId: string; clientSecret: string; setUser(user: { sub: string; email: string; emailVerified?: boolean }): void; stop(): Promise<void> }`.
- Serves on `127.0.0.1:<random port>`: `/.well-known/openid-configuration`, `/jwks`, `/authorize` (auto-consent: redirects to `redirect_uri` with `code` and the given `state`; it checks `client_id`, `redirect_uri`, PKCE `code_challenge` S256), `/token` (checks the client secret, the code once, the verifier; answers an RS256 `id_token` with `iss`, `aud`, `sub`, `email`, `email_verified`, `nonce`, `iat`, `exp`), `/userinfo`.
- Keys from `node:crypto` `generateKeyPairSync("rsa")`, JWK export, `crypto.sign`. No dependency, no import of `jose` or `@better-auth/*`.
- Tests add `fake.origin` to `AuthDeps.trustedOrigins` (the plugin refuses a private host otherwise, F6). Production passes no IdP origin.
- `ssoSignIn(app, fake, { email, providerId?, requestSignUp? })` in `apps/server/test/sso-helpers.ts`: drives `POST /api/auth/sign-in/sso` → the IdP → `GET /api/auth/sso/callback/<id>` with a cookie jar and fresh `x-client-ip`; returns `{ status, location, cookies, sessionCookie | null }`.

## Step 03.2 — Wire the plugin

**Goal.** Better Auth loads `@better-auth/sso` with the D2, D3 surface. Users are not linked yet: `resolveUser` rejects every identity with `sso_off` until stage 04.

**Files.** `apps/server/package.json` (exact `"@better-auth/sso": "1.7.18"`), `bun.lock`, `apps/server/src/platform/auth-sso.ts` (new), `platform/auth.ts`, the ESLint SDK rule (allow `@better-auth/sso` only in `platform/auth-sso.ts`).

**Interfaces** (`platform/auth-sso.ts`; later stages use them):
- `SSO_ALLOWED_PATHS` and `isAllowedSsoPath(method, path): boolean` — true only for `POST /sign-in/sso` and `GET /sso/callback/<one segment>`; `isAllowedAuthPath` calls it.
- `ssoPlugin(deps: SsoPluginDeps)` with `SsoPluginDeps = { resolveMember?: (identity: SsoIdentity) => Promise<SsoResolution> }`; absent = reject `sso_off`.
- `SsoIdentity = { providerId: string; issuer: string; subject: string; email: string }` (subject = `accountKey.accountId`, issuer = `accountKey.issuer`, email = `providerUser.email`).
- `SsoResolution = { kind: "link"; userId: string; orgId: string; firstLink: boolean } | { kind: "reject"; code: SsoRefusal; orgId: string | null }`.
- `SsoRefusal` in `@ea/core` (`packages/core/src/web/sso.ts`, new): `"no_provider" | "sso_off" | "domain_mismatch" | "not_a_member" | "identity_mismatch"`. The plugin gets `link` with `profile: "preserve"`, or `reject` with the code.
- `discoverProviderConfig(issuer: string, opts: { trustedOrigins: readonly string[]; timeoutMs: number }): Promise<OidcProviderConfig>` — wraps `discoverOIDCConfig` (F6); stage 07 uses it.
- `SSO_SESSION_SECONDS = 43_200` (stage 05 uses it).
- Plugin options: `providersLimit: () => 0`; `domainVerification: { enabled: true }`; `disableImplicitSignUp: true`; `modelName: "sso_providers"` and every field mapped to the stage 02 columns; no `defaultSSO`, no `redirectURI`, no `organizationProvisioning`. Core: `account.encryptOAuthTokens: true`; rate limit rule `/sign-in/sso` 10 per 60 s.
- `plugins` order: `twoFactorPlugin()`, `ssoPlugin(...)`, `signInAuditPlugin(report)` last (F105 F3).
- `AuthDeps.resolveSsoMember?` passes into `ssoPlugin`; `web.ts` does not pass it yet.

**Decisions.** D1, D2, D3, D15, D17.

**Test** (`apps/server/test/integration/web-sso-plugin.test.ts`, new; `auth-sso.test.ts` unit):

1. Unit: `isAllowedSsoPath` true for `POST /sign-in/sso`, `GET /sso/callback/0b8f…` (a UUID); false for `GET /sign-in/sso`, `GET /sso/callback`, `GET /sso/callback/a/b`, `POST /sso/register`, `GET /sso/providers`, `POST /sso/verify-domain`, `POST /sso/request-domain-verification`, `GET /sso/saml2/sp/metadata`, `POST /sso/saml2/sp/acs/x`.
2. Each path of F1 outside D2, signed in and signed out, answers 404 through `createApp`.
3. A signed-in user calling `auth.api.registerSSOProvider` directly gets an error and no row (S8).
4. A provider row by SQL for org A (`x.test`, `domain_proof = 'dns'`, fake IdP config) and a member `ann@x.test`: `ssoSignIn` ends at the error URL with `error=sso_off`; no `auth_accounts` or `auth_sessions` row for Ann.
5. The same provider with `domain_verified = false`: `/sign-in/sso` refuses (no redirect to the IdP).
6. `POST /sign-in/sso` for `bob@y.test` (no provider): an error answer, no redirect.
7. The 11th `/sign-in/sso` in 60 s from one address answers 429.
8. Log capture over tests 4–7: no client secret, no `code`, no `id_token`, no `ann@x.test`.

**Check.** The Proof of `plan.md` (`/tmp/f119-s03`).

**Done when.** The eight tests pass, `bun.lock` changes only by the new package and its dependencies, Proof prints `PROOF_OK`.

**Out of scope.** Linking members (stage 04), the session mark (stage 05), CLIs.
