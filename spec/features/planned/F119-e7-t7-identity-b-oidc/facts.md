# F119 facts

Part of [`plan.md`](plan.md). Workers: the stage files cite these by number (F1–F8).

## Facts checked (2026-11-14, `@better-auth/sso@1.7.18` tarball from npm, `better-auth` 1.7.18 in the main checkout)

- F1 Plugin endpoints: `/sso/register`, `/sso/providers`, `/sso/get-provider`, `/sso/update-provider`, `/sso/delete-provider`, `/sign-in/sso`, `/sso/callback/:providerId`, `/sso/callback`, SAML paths; with domain verification also `/sso/request-domain-verification`, `/sso/verify-domain` (`dist/index.mjs`).
- F2 Schema fields `issuer`, `oidcConfig` (JSON string with `clientSecret`), `samlConfig`, `userId`, `providerId` (unique), `organizationId`, `domain`, `domainVerified`; each `fieldName` is mappable.
- F3 `resolveUser(input)` gets `providerId`, `accountKey { issuer, accountId }`, `providerUser.email` and verified claims; returns `continue`, `link { userId, profile }` or `reject { code }`. It runs inside the callback transaction; it needs an adapter with native transactions and async context. A reject reaches the error URL as `?error=<code>`.
- F4 The two-factor plugin runs only on `/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number`; the SSO callback makes a session without a code.
- F5 `getSession` sets `expiresAt = now + expiresIn` once `expiresAt − expiresIn + updateAge ≤ now`: a 12 h session would get 30 days at its first read.
- F6 `discoverOIDCConfig` is exported. It calls the `isTrustedOrigin` predicate it gets for the discovery URL and for every endpoint of the document, on any host (`validateDiscoveryUrl`, `normalizeAndValidateUrl`); a public host gets no exemption there (corrected after cold review 1, B1). Fetches at sign-in time (`validateOIDCEndpointUrl`, `assertEndpointResolvesPublic`) accept a public-routable host or a trusted origin. A stored config with token, JWKS and authorization endpoints skips runtime discovery (`needsRuntimeDiscovery`).
- F7 `createWithHooks` passes the endpoint context (`ctx.path`) to `databaseHooks.*.create.before`.
- F8 `account.encryptOAuthTokens` exists, but it covers only the access and refresh tokens; `idToken` is stored in clear (`oauth2/link-account.mjs`; cold review 1, N2).
- F9 `createSession(userId, dontRememberMe, override)` puts the additional-field defaults, `createdAt` and `expiresAt` after the copied fields, so a session made from a current one (TOTP turn-on, `/change-password` with `revokeOtherSessions`) gets `password` and 30 days (`db/internal-adapter.mjs`; cold review 1, B2).
- F10 The plugin treats a client id change as an identity boundary; an OAuth state error redirects to `onAPIError.errorURL` or `<base>/error`; a body with `organizationSlug` looks up a model `organization` that we do not have (cold review 1, N1, N6, N15).
