# F119 facts

Part of [`plan.md`](plan.md). Workers: the stage files cite these by number (F1–F8).

## Facts checked (2026-11-14, `@better-auth/sso@1.7.18` tarball from npm, `better-auth` 1.7.18 in the main checkout)

- F1 Plugin endpoints: `/sso/register`, `/sso/providers`, `/sso/get-provider`, `/sso/update-provider`, `/sso/delete-provider`, `/sign-in/sso`, `/sso/callback/:providerId`, `/sso/callback`, SAML paths; with domain verification also `/sso/request-domain-verification`, `/sso/verify-domain` (`dist/index.mjs`).
- F2 Schema fields `issuer`, `oidcConfig` (JSON string with `clientSecret`), `samlConfig`, `userId`, `providerId` (unique), `organizationId`, `domain`, `domainVerified`; each `fieldName` is mappable.
- F3 `resolveUser(input)` gets `providerId`, `accountKey { issuer, accountId }`, `providerUser.email` and verified claims; returns `continue`, `link { userId, profile }` or `reject { code }`. It runs inside the callback transaction; it needs an adapter with native transactions and async context. A reject reaches the error URL as `?error=<code>`.
- F4 The two-factor plugin runs only on `/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number`; the SSO callback makes a session without a code.
- F5 `getSession` sets `expiresAt = now + expiresIn` once `expiresAt − expiresIn + updateAge ≤ now`: a 12 h session would get 30 days at its first read.
- F6 `discoverOIDCConfig` is exported; it refuses a private host unless its origin is trusted. The stored config skips runtime discovery when it has token, JWKS and authorization endpoints.
- F7 `createWithHooks` passes the endpoint context (`ctx.path`) to `databaseHooks.*.create.before`.
- F8 `account.encryptOAuthTokens` exists in `@better-auth/core` 1.7.18.

## Not verified (stage that checks)

S1–S10 of stage 01 (plugin on our schema and pool, transactions, `ctx.path` in the session hook, the Entra claims and sign-up path, peer versions, `bun audit`). Entra end to end: stage 15.
