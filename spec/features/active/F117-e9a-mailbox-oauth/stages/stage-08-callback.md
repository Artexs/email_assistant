# F117 stage 08 — Callback: state, code redeem, identity

Part of [`../plan.md`](../plan.md). `[risky]` (auth). Needs stage 07.

## Step 08.1 — `finishOAuthCallback`

**Goal.** Turn the provider's redirect query into a checked grant or one refusal code (D11, D12). No route and no storage here: stage 09 adds both.

**Files.** `apps/server/src/modules/mail/oauth/callback.ts`, `id-token.ts` (new) and tests.

**Interfaces.**

```ts
export type OAuthRefusalCode =
  | "oauth_cancelled" | "oauth_state_invalid" | "oauth_state_expired" | "oauth_code_invalid" | "oauth_scope_missing"
  | "oauth_wrong_account" | "mailbox_exists" | "mailbox_limit" | "admin_consent_required" | "protocol_disabled"
  | "feature_off" | "not_configured" | "oauth_failed";
export interface OAuthGrant {
  start: OAuthStart; provider: MailOAuthProvider; address: string; tenantId: string | null;
  refreshToken: string; mailAccessToken: string; mailExpiresInSec: number; scopes: string[];
}
export type CallbackResult = { ok: true; grant: OAuthGrant } | { ok: false; code: OAuthRefusalCode };
export async function finishOAuthCallback(
  deps: { db: Db; secrets: SecretBox; clients: Partial<Record<MailOAuthProvider, MailOAuthClient>>; now(): Date },
  ctx: TenantContext,
  input: { provider: MailOAuthProvider; userId: string; query: Record<string, string> }
): Promise<CallbackResult>;
```

**Order.**
1. No client for the provider → `not_configured`. No `state` in the query → `oauth_state_invalid`. Else consume the state (stage 07) first, also when the query has `error`: an error ends the attempt.
2. `error` in the query: AADSTS 90094, 90095 or 65001 in `error_description`, or `error=consent_required` → `admin_consent_required`; `access_denied` → `oauth_cancelled`; else `oauth_failed`.
3. No `code` → `oauth_failed`. `redeemCode(code, verifier)`: `OAuthGrantError` with AADSTS 65001, 90094 or 90095 → `admin_consent_required` (at connect, 65001 means "no consent yet"); another `OAuthGrantError` → `oauth_code_invalid`; soft errors → `oauth_failed`.
4. No refresh token in the answer → `oauth_failed`.
5. Scopes: the answer's scopes must hold the one mail scope of the provider: Google `https://mail.google.com/`; Microsoft a scope that ends with `IMAP.AccessAsUser.All` (case-insensitive; Microsoft may answer the short or the full form, and leaves out `offline_access` and `openid`). Else `oauth_scope_missing`. Spike rows M2 and G1 record the raw strings.
6. ID token (`id-token.ts`): decode the payload only (D12, Q8). `aud` = client id, `exp` later than now minus 5 min, `issuerOk(iss)`; else `oauth_failed`. Google: `email_verified === true`, else `oauth_failed`. Microsoft: `tenantId` = `tid`.
7. Address: Google `email`; Microsoft `email`, else `preferred_username` (spike M12 may change the order). It must match the repo's address pattern; lower-case it. Else `oauth_failed`.
8. Reconnect (`start.mailboxId` set): the address must equal the stored mailbox address (case-insensitive), else `oauth_wrong_account`.

**Decisions.** D9, D11, D12, D13, D18.

**Edge cases.**
- A replayed callback URL: the state is gone → `oauth_state_invalid`; the code is never redeemed twice by us.
- A crash after step 1: the state is gone and nothing is stored; the user starts again.
- The fake's ID token has a dummy signature. The parser reads no header field and checks no signature (Q8).

**Test** (integration, fake token server):
1. Google: `code({ provider: "google", address: "Ann@X.test" })` → `ok`, address `ann@x.test`, refresh token kept, `tenantId` null.
2. Microsoft with `tid` `11111111-1111-1111-1111-111111111111` and no `email` claim, `preferred_username` `bob@x.test` → address `bob@x.test`, tenant set.
3. Query `error=access_denied` → `oauth_cancelled`; the state row is gone.
4. `error=access_denied&error_description=AADSTS90094: …` → `admin_consent_required`.
5. Wrong verifier (fake) → `oauth_code_invalid`.
6. Scopes without `https://mail.google.com/` → `oauth_scope_missing`; Google scopes `https://mail.google.com/ https://www.googleapis.com/auth/userinfo.email openid` and Microsoft `IMAP.AccessAsUser.All` (short form, no `offline_access`) → pass.
7. Google `email_verified: false` → `oauth_failed`; `aud` of another client → `oauth_failed`.
8. The same query twice → second `oauth_state_invalid`; the fake saw one redeem.
9. Reconnect state for `ann@x.test`, the provider answers `eve@x.test` → `oauth_wrong_account`.
10. Canary: the code `code-canary`, the token values and the ID token are in no log line or error text.

**Check.** The Proof.

**Done when.** The tests pass; the Proof prints `PROOF_OK`.

**Out of scope.** The route, the redirect and the mailbox write (stage 09).

## Carry-over from stage 07 review

- Consume the state with the provider of the route path (`consumeOAuthState` filters by provider). It re-checks the membership of the user in the organization: a removed member gets `oauth_state_invalid`. The owner role is not checked there: stage 09 checks it at the callback route (a demoted owner → `oauth_failed`).
- Pass the pool to `consumeOAuthState`, never a caller's transaction.

