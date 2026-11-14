# F117 stage 10 — Token refresh in `open.ts`: lock, cache, reasons

Part of [`../plan.md`](../plan.md). `[risky]` (data integrity, auth). Needs stages 05 and 09.

## Step 10.1 — `createOAuthTokens`

**Goal.** The real `OAuthTokens` of stage 05 (D14), wired in the composition root for every caller of `openMailboxProvider` (sync, committer, CLIs).

**Interface.** `createOAuthTokens(deps: { pool: Db; secrets: SecretBox; clients: Partial<Record<MailOAuthProvider, MailOAuthClient>>; now(): Date }): OAuthTokens`.

**Rules.**
1. Cache key `<mailboxId>:<resource>`; a hit needs 5 min or more left and no `fresh`.
2. A miss: `withMailboxOAuthLock(pool, id, …)`: read the secret, `refresh(secret.refreshToken, resource)`, save a new refresh token in the same transaction when it differs, commit, then cache `now + expiresInSec`. The lock runs on `pool`, never on the caller's transaction.
3. The provider has no client (not configured) → `SoftError("mail oauth not configured")` and one `error` line `mail_oauth_not_configured` with `provider`, once per process and provider.
4. `OAuthGrantError` → `MailAuthError` with its `reason`; the cache entries of the mailbox go.
5. `OAuthSoftError` `client_invalid` → `SoftError` and an `error` line `mail_oauth_client_invalid` with `provider` (each time; E8 alerts read it later). `server`, `timeout` → `SoftError`, one `warn` line.
6. `drop(id)` deletes both cache entries. Reconnect (stage 09) and Remove (stage 12) call it.

**Crash and repeat.** The process dies after the provider answers and before the commit: the rotated token is lost and the next run redeems the old one. Microsoft keeps it valid (spike M11, default). If M11 shows otherwise, the mailbox goes `oauth_expired` and the user reconnects once; no other repair.

## Step 10.2 — Login retry and status with reason

- `open.ts`: an IMAP login refused (`MailAuthError` without reason) for an `oauth` mailbox: if the token came from the cache → `drop`, get a `fresh` token, retry once. A refusal with a fresh token → `MailAuthError` reason `protocol_disabled` (D17).
- A Google SMTP login refused at send time → `SmtpSendError` stage `login` with reason `protocol_disabled`.
- A connection that drops during a session stays a connection error (soft), never `auth_error`.
- `setMailboxStatus` gets an optional `reason: AuthErrorReason | null`. The sync job and the committer pass `error.reason ?? null` when they set `auth_error`; every change to another status writes `auth_reason = NULL` in the same statement (stage 03 CHECK). The send outcome `{ kind: "auth_error" }` carries `reason`.
- Log lines keep the mailbox id and the reason code only.

**Decisions.** D14, D15, D16, D17, D18.

**Edge cases.**
- Two jobs refresh one mailbox at once: the second waits on the lock, then refreshes again with the saved token (no stored access token; Q1 accepts two refreshes).
- A refresh while a Reconnect commits: the lock orders them; the refresh reads the new secret.
- A paused or `auth_error` mailbox is not synced, so it is not refreshed.
- An `auth_error` mailbox that the user reconnects: reason NULL, cache dropped.

**Test** (integration: fake token server, GreenMail with XOAUTH2, real pool):
1. Two `accessToken` calls within one test minute → one refresh at the fake.
2. Fake `expires_in: 240` → the second call refreshes again (under 5 min left).
3. `rotate` on: after one refresh the stored refresh token is the new one; the old one is never stored again.
4. Two concurrent `accessToken(…, { fresh: true })` calls → two refreshes, in order; the stored token is the second rotation.
5. Fake answers `invalid_grant` AADSTS 700082 → the sync job sets `auth_error`, `auth_reason = 'oauth_expired'`; Google `invalid_grant` → `oauth_expired`; AADSTS 50173 → `oauth_revoked`.
6. Fake answers `invalid_client` → status stays `active`; one `mail_oauth_client_invalid` line.
7. Fake times out (> 10 s; use a short test timeout option) → status stays; `warn`.
8. Provider without a client → `SoftError`; status stays; one `mail_oauth_not_configured` line for two runs.
9. An `openProvider` stub that throws `MailAuthError` once for a cached token → one fresh refresh, the second open passes. Throws twice → `protocol_disabled`.
10. A password mailbox in `auth_error` keeps `auth_reason` NULL; `auth_error` → `active` clears a reason.
11. Canary: refresh and access tokens in no log line or error text.

**Check.** The Proof.

**Done when.** The tests pass; every `openMailboxProvider` caller in the composition gets `oauthTokens`; the Proof prints `PROOF_OK`.

**Out of scope.** Texts, notices and views (stage 11); Graph (stage 13).
