# F119 stage 03 — Plugin, allow-list, fake IdP

Part of [`../plan.md`](../plan.md). `[risky]` (auth). The only `bun.lock` change of F119; none of any ticket next to it.

## Step 03.1 — The fake IdP test helper

**Goal.** A local OIDC provider for SSO tests (D17).

**Files.** `apps/server/test/fake-oidc.ts` (new).

**Interfaces.**
- `startFakeOidc(opts?: { emailClaim?: boolean }): Promise<FakeOidc>`; `FakeOidc = { issuer, origin, clientId, clientSecret, setUser(user: { sub; email; emailVerified?; hd? }), stop() }`.
- Serves on `127.0.0.1:<random port>`: discovery, `/jwks`, `/authorize` (auto-consent redirect with `code` and `state`; checks `client_id`, `redirect_uri`, PKCE S256), `/token` (client secret, one-time code, verifier; an RS256 `id_token` with `iss`, `aud`, `sub`, `email`, `email_verified`, optional `hd`, `nonce`, `iat`, `exp`), `/userinfo`.
- Keys from `node:crypto` (`generateKeyPairSync`, JWK export, `crypto.sign`). No dependency, no `jose` or `@better-auth/*` import.
- Tests add `fake.origin` to `AuthDeps.trustedOrigins` (sign-in fetches refuse a private host otherwise, F6). Production adds no IdP origin there.
- `ssoSignIn(app, fake, { email, providerId?, requestSignUp? })` (`apps/server/test/sso-helpers.ts`): sign-in → IdP → callback with a cookie jar and fresh `x-client-ip`; returns `{ status, location, sessionCookie | null }`.

## Step 03.2 — Wire the plugin

**Goal.** Better Auth loads `@better-auth/sso` with the D2, D3 surface. Until stage 04, `resolveUser` rejects every identity with `sso_off`.

**Files.** `apps/server/package.json` (exact `"@better-auth/sso": "1.7.18"`), `bun.lock`, `platform/auth-sso.ts` (new), `platform/auth.ts`, the ESLint SDK rule (the package only in `auth-sso.ts`).

**Interfaces** (`platform/auth-sso.ts`; later stages use them):
- `isAllowedSsoPath(method, path): boolean` — true only for `POST /sign-in/sso` and `GET /sso/callback/<one segment>`; `isAllowedAuthPath` calls it.
- `ssoPlugin(deps: { resolveMember?: (identity: SsoIdentity) => Promise<SsoResolution> })`; absent = reject `sso_off`.
- `SsoIdentity = { providerId: string; issuer: string; subject: string; email: string; emailVerified: boolean | null; hostedDomain: string | null }` (`accountKey.accountId`, `accountKey.issuer`, `providerUser.email`; `email_verified` and `hd` from `verifiedIdTokenClaims`, null when absent; cold review 1, N4).
- `SsoResolution = { kind: "link"; userId; orgId; firstLink: boolean } | { kind: "reject"; code: SsoRefusal; orgId: string | null }`.
- `SsoRefusal` in `@ea/core` (`packages/core/src/web/sso.ts`, new): `"no_provider" | "sso_off" | "domain_mismatch" | "email_unverified" | "not_a_member" | "identity_mismatch"`. The plugin gets `link` (`profile: "preserve"`) or `reject` (the code).
- `discoverProviderConfig` and `buildOidcConfig`: stage 07 adds them here.
- `SSO_SESSION_SECONDS = 43_200` (stage 05).
- Plugin options: `providersLimit: () => 0`; `domainVerification: { enabled: true }`; `disableImplicitSignUp: true`; `modelName: "sso_providers"` and every field mapped to the stage 02 columns (`domainVerified` maps only through `schema.ssoProvider.fields`, N9); no `defaultSSO`, `redirectURI` or `organizationProvisioning`. Core: rate limit `/sign-in/sso` 10 per 60 s; `onAPIError.errorURL: "/login?sso=failed"` (a bad OAuth state lands there, F10).
- No IdP token is stored (D15, F8): `databaseHooks.account.create.before` and `update.before` set `idToken`, `accessToken`, `refreshToken` to null when `providerId !== "credential"`.
- A `before` hook on `/sign-in/sso` accepts only the body keys `email`, `providerId`, `callbackURL`, `errorCallbackURL`, `requestSignUp`; any other key (`organizationSlug`, `domain`, `loginHint`, `scopes`) → `400 BAD_BODY` (F10).
- Order: `twoFactorPlugin()`, `ssoPlugin(...)`, `signInAuditPlugin(report)` last (F105 F3).
- `AuthDeps.resolveSsoMember?` goes into `ssoPlugin`; `web.ts` passes it in stage 04.

**Decisions.** D1, D2, D3, D15, D17.

**Test** (`apps/server/test/integration/web-sso-plugin.test.ts`, new; `auth-sso.test.ts` unit):

1. Unit: `isAllowedSsoPath` true for `POST /sign-in/sso`, `GET /sso/callback/<uuid>`; false for `GET /sign-in/sso`, `GET /sso/callback`, `GET /sso/callback/a/b` and every other path of F1.
2. Each path of F1 outside D2, with and without a session, answers 404 through `createApp`.
3. A signed-in user calling `auth.api.registerSSOProvider` gets an error, no row (S8).
4. A provider row by SQL for org A (`x.test`, proof `dns`, fake IdP config), member `ann@x.test`: `ssoSignIn` ends at the error URL with `error=sso_off`; no account or session row for Ann.
5. The same provider unproved: `/sign-in/sso` refuses (no IdP redirect).
6. `POST /sign-in/sso` for `bob@y.test` (no provider): an error, no redirect.
7. The 11th `/sign-in/sso` in 60 s from one address: 429.
8. Log capture over tests 4–7: no client secret, no `code`, no `id_token`, no `ann@x.test`.
9. `POST /sign-in/sso` with `{ organizationSlug: "a" }` or with `domain`: 400, no `better_auth_error` line.
10. A callback with an unknown `state`: a redirect to `/login?sso=failed&error=invalid_state`.

**Check.** The Proof of `plan.md` (`/tmp/f119-s03`).

**Done when.** The ten tests pass; `bun.lock` changes only by the new package and its dependencies; `PROOF_OK`.

**Out of scope.** Linking (stage 04), the session mark (stage 05), CLIs.
