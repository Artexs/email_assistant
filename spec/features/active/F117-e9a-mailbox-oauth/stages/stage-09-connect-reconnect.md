# F117 stage 09 — Callback route, secret store, Connect and Reconnect

Part of [`../plan.md`](../plan.md). `[risky]` (tenant data, auth). Needs stage 08 (and through it 04–07).

## Step 09.1 — OAuth secret store with the mailbox lock

**Files.** `apps/server/src/modules/mail/oauth/secret-store.ts` (new); it uses the credentials repository.

**Interfaces.**

```ts
export function encodeOAuthSecret(secret: OAuthSecret): string; // JSON, v: 1
export function decodeOAuthSecret(clear: string): OAuthSecret;   // throws HardError on another shape
/** Runs `fn` in one transaction on the pool under pg_advisory_xact_lock(hashtextextended('mailbox_oauth:<id>', 0)). */
export async function withMailboxOAuthLock<T>(pool: Db, mailboxId: string, fn: (tx: Transaction<DB>) => Promise<T>): Promise<T>;
export async function readOAuthSecret(tx: Transaction<DB>, secrets: SecretBox, ctx: TenantContext, mailboxId: string): Promise<OAuthSecret>;
export async function saveOAuthSecret(tx: Transaction<DB>, secrets: SecretBox, ctx: TenantContext, mailboxId: string, secret: OAuthSecret): Promise<void>;
```

AAD `mailbox:<id>`, the current key version (D3, D14). Stage 10 uses the same lock; a Reconnect and a refresh never interleave.

## Step 09.2 — Connect and Reconnect

**Interfaces.** `applyOAuthGrant(deps, ctx, grant: OAuthGrant, actor: string): Promise<{ ok: true; code: "connected" | "reconnected"; mailboxId: string } | { ok: false; code: OAuthRefusalCode }>`.

**Connect** (`grant.start.mailboxId` null) keeps the order of `connectMailbox` (`docs/capabilities/sync.md` rule 1), with these changes:
- Flag check again (the flag may have gone off since the start) → `feature_off`.
- Hosts, ports and SMTP security from the provider spec; `send_via` and `oauth_provider` from it; `secret_kind = 'oauth'`.
- Same address in the organization → `mailbox_exists` (also on the unique-index race). Limit → `mailbox_limit`.
- Login test: IMAP with `{ kind: "oauth", accessToken: grant.mailAccessToken }`. A refused login → `protocol_disabled`. Google: also `verifySmtpLogin` with XOAUTH2. Microsoft: also one `refresh(refreshToken, "graph")` to prove `Mail.Send` consent; any `OAuthGrantError` there → `admin_consent_required` (the grant lacks `Mail.Send`); a soft error → `oauth_failed`; a rotated refresh token from it is the one to store.
- No test mail is sent.
- One transaction as today; the audit row `mailbox.connected` gets `{ method: "oauth", provider }`.

**Reconnect** (`grant.start.mailboxId` set; stage 08 checked the address):
- The same login tests.
- Under `withMailboxOAuthLock`: replace the secret; `auth_error` and `host_blocked` → `active` with `status_changed_at = now`; `paused` stays; `auth_reason` → NULL; audit `mailbox.reconnected` `{ provider }`.
- `oauthTokens.drop(mailboxId)` after the commit (stage 10 wires the real cache; until then a no-op).
- A password mailbox never reaches here: stage 07 refuses its id (Q3).

## Step 09.3 — The callback route

`GET /api/mailboxes/oauth/:provider/callback`:
- Always answers `303`, never JSON. No session → `Location: /login`. Else `finishOAuthCallback`, then `applyOAuthGrant`, then `Location: /mailboxes?oauth=<code>`, plus `&mailbox=<id>` on success, plus `&provider=microsoft` for `admin_consent_required`.
- The query of the incoming request is never logged (it holds the code); the request log line uses the route pattern.
- The guard's tenant and suspended rules apply; a suspended organization → `/mailboxes?oauth=oauth_failed` with nothing stored.

**Decisions.** D3, D9, D10, D11, D13, D14, D18.

**Edge cases.**
- Crash after the redeem and before the commit: nothing stored; the grant is lost; the user starts again.
- Two callbacks for two states of one address at once: one wins, the other gets `mailbox_exists`.
- The owner role is checked again at the callback (a demoted owner → `oauth_failed`).

**Test** (integration: app, fake token server, GreenMail with XOAUTH2):
1. Google connect → `303 /mailboxes?oauth=connected&mailbox=<id>`; the row has `send_via = 'smtp'`, `oauth_provider = 'google'`, hosts of the injected spec; the credential decrypts to `v: 1`, provider `google`, the refresh token.
2. Microsoft connect → `send_via = 'graph'`; the fake saw one `graph` refresh; with `rotate` the stored refresh token is the rotated one.
3. Microsoft `graph` refresh answers `invalid_grant` AADSTS 65001 → `oauth=admin_consent_required&provider=microsoft`; nothing stored.
4. Second connect of the same address → `mailbox_exists`; one row.
5. At the mailbox limit → `mailbox_limit`.
6. Reconnect of an `auth_error` mailbox with reason `oauth_expired` and 3 `emails` rows → `reconnected`, same id, `active`, reason NULL, 3 rows, new secret.
7. Reconnect of a `paused` mailbox → stays `paused`.
8. No session cookie → `303 /login`; the state row still exists.
9. Canary: no code, token or `state` value in captured log lines, audit rows or the `Location` header.

**Check.** The Proof.

**Done when.** The tests pass; the Proof prints `PROOF_OK`.

**Out of scope.** Refresh in later jobs (stage 10), reason texts (stage 11), the panel (16, 18).

## Carry-over from the F117 stage 08 review

Source: `review-8.md` (N1, N2, N5).

- **Session user and organization (N1, login CSRF).** The route passes the user of the SESSION and the organization of the session to `finishOAuthCallback` (`input.userId`, `ctx`). It never takes a user or an organization from the query. Then the state consume (`user_id`, `org_id`, provider filters) refuses a callback URL of user A that opens in the session of user B: `oauth_state_invalid`, and A's state row stays.
- **Public route (N2).** `requireSession` (`platform/http.ts`) answers 401 JSON, but this route always answers `303` and sends "no session" to `/login`. So mount the route before the session guard, as `/api/sign-in-options` is. The route then:
  - reads the session itself (no session → `303 /login`, the state row stays);
  - enters the tenant scope itself (F119 rule);
  - is added to `PUBLIC_ROUTES` in `apps/server/test/integration/web-tenant-scope.test.ts` (the F119 public-route list);
  - has an `apiDoc`, or a `HIDDEN_ROUTES` entry (`docs/code-patterns.md` ~line 224; `openapi-routes.test.ts` enforces it).
  The guard's tenant and suspended rules still apply: run them in the route.
- **Login test with the grant address (N5).** Keep the IMAP login test and the Graph refresh test with `user = grant.address`. The Microsoft `email` claim is not verified by Microsoft (a tenant admin can set it: "nOAuth"). The login with the access token is what binds the address to the real account. The claim order (`email` before `preferred_username`) in `callback.ts` waits for spike row M12.
- **Added tests.**
  1. User A's callback URL (state of A, code of A) opened in the session of user B (same organization, and also a user of another organization) → `303 /mailboxes?oauth=oauth_state_invalid`; A's state row still exists; the fake saw no redeem; nothing is stored.
  2. Route test with no session and a valid query → `303 /login`; the state row stays (test 8 above).
  3. The route is in `PUBLIC_ROUTES` and passes the tenant-scope test; the OpenAPI test passes.
  4. A login test fails (fake IMAP refuses the user) when the grant address differs from the login user of the access token → `protocol_disabled`, nothing stored.

## Carry-over from the F104 stage 08 review

A mailbox created by the OAuth callback gets no Sent state row today (= off, the safe side). Set the Sent switch like `connectMailbox` does (the flag `sent_sync` decides): see F104 review-8.md N6.
