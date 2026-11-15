# F117 stage 06: facts for stages 07 to 15

Code: `apps/server/src/modules/mail/oauth/` (`providers.ts`, `client.ts`, `clients.ts`). Test double: `apps/server/test/fake-mail-oauth.ts`.

## What later stages call

- `MailOAuthClient` (named type, `client.ts`): `authorizeUrl`, `redeemCode`, `refresh`, `revoke`. `MailOAuthClients = Partial<Record<MailOAuthProvider, MailOAuthClient>>` (review N5): a provider without keys has no entry. `createMailOAuthClients(config, { specs?, fetchFn?, timeoutMs? })` builds the map. Stage 08 and stage 10 take `MailOAuthClients` and handle a missing entry.
- Config: `mailOAuthApp(config, provider)` (client id, secret, redirect URI `<WEB_BASE_URL>/api/mailboxes/oauth/<provider>/callback`) and `mailOAuthConfigured` live in `platform/config.ts` (`platform` does not import `modules`; its `MailOAuthProviderId` equals `MailOAuthProvider`).
- Granted scopes (review N1): use `missingResourceScopes(spec, resource, answer.scopes)` in stage 08. It ignores `openid`, `email`, `profile`, `offline_access` and the case. Never compare the exact requested names. The fake server answers Google with the userinfo.email URL and Microsoft without `offline_access`.
- `OAuthGrantError` (HardError: `reason`, `providerCode`, `aadsts`) and `OAuthSoftError` (SoftError: `kind`). Messages are fixed text, no `cause`. Stage 08 and stage 10 turn an `OAuthGrantError` into `MailAuthError` with `reason` (review B1: a refused login is a `MailAuthError`, never an `SmtpSendError`).
- The client logs one warn line per failure (`oauth_grant_refused` or `oauth_token_failed`; fields `reason`/`kind`, `status`, `code`, `error_code` = AADSTS). A caller adds its own line with `mailbox_id`; it must not log the error message of a nodemailer or imapflow error.

## Decisions taken in this stage

- **AADSTS 65001 has one reason: `admin_consent_required`** (review N4), at connect and at refresh. The plan text of stage 06 said `oauth_revoked`; stages 08 and 09 need no special case for 65001 any more. 50173 and 65004 stay `oauth_revoked`; 70008, 700082, 700084, 70043, every other `invalid_grant` (also Google, Q10) and `interaction_required` are `oauth_expired`.
- **The AADSTS list is unverified.** Nobody read the Microsoft Entra "authentication and authorization error codes" reference in this job. Spike rows M1, M13, M14 and stage 14 must confirm the numbers. The code says so in a comment.
- **AADSTS source:** the first `AADSTS(\d+)` of `error_description`, else `error_codes[0]`. The description is never kept.
- **Unknown error codes.** `invalid_request`, `invalid_scope`, `unsupported_grant_type` count as `client_invalid` (our request or app is wrong). Any other unknown code and 429 are `server`. A `providerCode` that does not match `^[a-z][a-z_]{0,47}$` becomes `unknown`.
- **`scope` is sent only for a provider with a Graph resource** (Microsoft: one resource per token, at redeem and at refresh). Google gets none. Whether Google accepts a `scope` on refresh was not checked: the spike (G1) may show it.
- **Revoke.** No revoke URL resolves with no call. `invalid_token` (already revoked) resolves. Any other failure is an `OAuthSoftError`; stage 12 treats it as best effort.
- **Fake token server deviation:** `rotate` is `Record<MailOAuthProvider, boolean>` (one boolean cannot default true for Microsoft and false for Google). It also exposes `clientId`, `clientSecret`, `issuedRefreshTokens` and takes `codeChallenge` in `code()` (PKCE check). `failNext` takes an optional `description`. The ID token is unsigned (`alg: none`); stage 08 checks `aud`, `exp`, `iss` only (D12). Microsoft ID tokens carry `email`, `preferred_username` and `tid` (guess: row M12).
- No env key holds a URL (D6, N8): a test builds a registry with `fake.specs({ imap, smtp, graphBaseUrl })` and passes it as `specs` / to `createMailOAuthClient`. A CLI subprocess cannot do this (review B6): stage 20 runs `main()` in the test process.

## Mutations (each run alone, log in /tmp/f117-s06/mut-<name>.log, source restored)

m1 provider code not sanitised; m2 description in error message; m3 `cause` kept; m4 client secret in authorize URL; m5 raw body in a console line; m6 65001 not consent; m7 no timeout signal; m8 no Microsoft `scope`; m9 revoke call without URL; m10 identity scopes required; m11 exact-case scope compare; m12 half pair accepted; m13 pair without `WEB_BASE_URL` accepted; m14 secret value in the config error key; m15 a URL env key in the schema. Each fails at least one test.
