# F117 stage 06 — Provider registry, config, flags, token client, fake token server

Part of [`../plan.md`](../plan.md). `[risky]` (auth). Needs stage 03.

## Step 06.1 — Registry, config and flags

**Files.** New folder `apps/server/src/modules/mail/oauth/` (`providers.ts`, `client.ts`, tests); config in `platform/config.ts`; flags in `packages/core/src/features.ts`.

**Interfaces.**

```ts
export type MailOAuthProvider = "microsoft" | "google";
export interface MailOAuthProviderSpec {
  authorizeUrl: string; tokenUrl: string; revokeUrl: string | null;
  authorizeScopes: string[];
  resourceScopes: Record<TokenResource, string[] | null>; // google: graph null
  authorizeParams: Record<string, string>;
  imap: { host: string; port: number };
  smtp: { host: string; port: number; security: SmtpSecurity };
  sendVia: "smtp" | "graph";
  graphBaseUrl: string | null;
  issuerOk(iss: string): boolean;
}
export const mailOAuthProviders: Readonly<Record<MailOAuthProvider, MailOAuthProviderSpec>>;
```

Values (D6; spike rows M2 and G1 may change them):
- Microsoft: `https://login.microsoftonline.com/common/oauth2/v2.0/{authorize,token}`; no revoke URL; authorize scopes `openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://graph.microsoft.com/Mail.Send`; `mail` = `https://outlook.office.com/IMAP.AccessAsUser.All offline_access`; `graph` = `https://graph.microsoft.com/Mail.Send offline_access`; params `prompt=select_account`; IMAP `outlook.office365.com:993`; SMTP `smtp.office365.com:587` STARTTLS (stored, not used); `sendVia: "graph"`; Graph `https://graph.microsoft.com`; issuer `https://login.microsoftonline.com/<guid>/v2.0`.
- Google: `https://accounts.google.com/o/oauth2/v2/auth`, `https://oauth2.googleapis.com/token`, revoke `https://oauth2.googleapis.com/revoke`; scopes `openid email https://mail.google.com/`; `mail` = the same; params `access_type=offline`, `prompt=consent`; IMAP `imap.gmail.com:993`; SMTP `smtp.gmail.com:465` TLS; `sendVia: "smtp"`; issuer `https://accounts.google.com` or `accounts.google.com`.
- Config (D7): the four `MAIL_OAUTH_*` keys, optional, never logged; one of a pair alone, or a pair without `WEB_BASE_URL`, fails `loadConfig`. `mailOAuthConfigured(config, provider): boolean`.
- Flags (D8): `mail_oauth_microsoft` ("Connect a Microsoft 365 or Outlook mailbox with Microsoft sign-in."), `mail_oauth_google` ("Connect a Gmail mailbox with Google sign-in."); epic `E9a`, default off, remove by `2027-06-01`.

## Step 06.2 — Token client

```ts
export interface TokenAnswer { accessToken: string; expiresInSec: number; refreshToken: string | null; scopes: string[]; idToken: string | null }
export class OAuthGrantError extends HardError { readonly reason: AuthErrorReason; readonly providerCode: string; readonly aadsts: number | null }
export class OAuthSoftError extends SoftError { readonly kind: "client_invalid" | "server" | "timeout" }
export function createMailOAuthClient(spec: MailOAuthProviderSpec, cfg: { clientId: string; clientSecret: string; redirectUri: string }, fetchFn?: typeof fetch): {
  authorizeUrl(input: { state: string; codeChallenge: string; loginHint?: string }): string;
  redeemCode(code: string, verifier: string): Promise<TokenAnswer>;
  refresh(refreshToken: string, resource: TokenResource): Promise<TokenAnswer>;
  revoke(refreshToken: string): Promise<void>; // no revoke URL → resolves, no call
};
```

- Each call has a 10 s `AbortSignal.timeout`. `redeemCode` asks for the `mail` resource (Microsoft: one resource per token).
- Error map (D17):
  - `oauth_expired`: `invalid_grant` with AADSTS 70008, 700082, 700084 or 70043; any Google `invalid_grant` (Q10); another `invalid_grant`; `interaction_required`.
  - `oauth_revoked`: `invalid_grant` with AADSTS 50173, 65001 or 65004.
  - `admin_consent_required`: AADSTS 90094 or 90095; `consent_required`.
  - Soft `client_invalid`: `invalid_client`, `unauthorized_client`. Soft `server`: 5xx, `temporarily_unavailable`, a network error. Soft `timeout`: no answer in 10 s.

- AADSTS: the first `AADSTS(\d+)` of `error_description`; the description itself is never kept (D18).

## Step 06.3 — Fake token server

`apps/server/test/fake-mail-oauth.ts` (test helper; `Bun.serve` on `127.0.0.1`):

```ts
startFakeMailOAuth(): Promise<{
  specs(over: { imap: { host: string; port: number }; smtp: { host: string; port: number; security: SmtpSecurity }; graphBaseUrl?: string }): Record<MailOAuthProvider, MailOAuthProviderSpec>;
  code(input: { provider: MailOAuthProvider; address: string; scopes?: string[]; emailVerified?: boolean; tid?: string }): string;
  failNext(answer: { status: number; error: string; aadsts?: number } | "timeout"): void;
  rotate: boolean; // default true for microsoft, false for google
  calls: Array<{ grant: "authorization_code" | "refresh_token"; scope: string | null; codeVerifierOk: boolean }>;
  revoked: string[];
  stop(): Promise<void>;
}>
```

It checks the PKCE verifier, returns ID tokens with `aud` = the test client id, and rotates refresh tokens when `rotate`.

**Decisions.** D6, D7, D8, D17, D18.

**Test.**
1. `authorizeUrl` for each provider holds `code_challenge_method=S256`, the redirect URI, the scopes and the params; no client secret.
2. Each error-map row, with fixed fake answers, gives its reason or soft kind (7 cases).
3. `redeemCode` with a wrong verifier → `invalid_grant` → `OAuthGrantError`.
4. A Microsoft refresh returns a new refresh token; a Google one returns `refreshToken: null`.
5. Config: only `MAIL_OAUTH_GOOGLE_CLIENT_ID` set → `loadConfig` fails naming the key, never its value.
6. Canary: client secret `cs-canary`, refresh token `rt-canary`, a description `AADSTS70008: … user a@x.test` → no canary or address in an error message, `String(error)` or a captured log line.

**Check.** The Proof.

**Done when.** The tests pass; the Proof prints `PROOF_OK`.

**Out of scope.** Routes (07–08), storage (09), refresh flow (10).
