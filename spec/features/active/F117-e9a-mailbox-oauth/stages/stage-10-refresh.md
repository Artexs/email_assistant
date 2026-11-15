# F117 stage 10 — Token refresh in `open.ts`: lock, cache, reasons

Part of [`../plan.md`](../plan.md). `[risky]` (data integrity, auth). Needs stages 05 and 09.

## Step 10.1 — `createOAuthTokens`

**Goal.** The real `OAuthTokens` of stage 05 (D14), wired for every caller of `openMailboxProvider`.

**Interface.** `createOAuthTokens(deps: { pool: Db; secrets: SecretBox; clients: Partial<Record<MailOAuthProvider, MailOAuthClient>>; now(): Date }): OAuthTokens`.

**Rules.**
1. Cache key `<mailboxId>:<resource>`; a hit needs 5 min or more left and no `fresh`.
2. A miss: `withMailboxOAuthLock(pool, id, …)`: read the secret, `refresh(secret.refreshToken, resource)`, save a new refresh token in the same transaction when it differs, commit, then cache `now + expiresInSec`. The lock runs on `pool`, never on the caller's transaction.
3. No client (not configured) → `SoftError` and one `error` line `mail_oauth_not_configured` with `provider`, once per process and provider.
4. `OAuthGrantError` → `MailAuthError` with its `reason`; the cache entries of the mailbox go.
5. `OAuthSoftError` `client_invalid` → `SoftError` and an `error` line `mail_oauth_client_invalid` with `provider` (each time). `server`, `timeout` → `SoftError`, one `warn` line.
6. `drop(id)` deletes both cache entries. Reconnect (stage 09) and Remove (stage 12) call it.

**Crash and repeat.** A crash after the provider answers and before the commit loses the rotated token; the next run redeems the old one (valid at Microsoft: spike M11, default). Else the mailbox goes `oauth_expired` and the user reconnects once.

## Step 10.2 — Login retry and status with reason

- `open.ts`: an IMAP login refused (`MailAuthError` without reason) for an `oauth` mailbox → `drop`, get a `fresh` token, retry once (always: `accessToken` does not say where a token came from; the cost is one refresh). Refused again → `MailAuthError` reason `protocol_disabled` (D17).
- The SMTP sender of an `oauth` mailbox: a `MailAuthError` without reason at send time gets reason `protocol_disabled` (the token is at most minutes old).
- A connection that drops during a session stays a connection error (soft), never `auth_error`.
- `setMailboxStatus` gets an optional `reason: AuthErrorReason | null`. The sync job and the committer pass `error.reason ?? null` when they set `auth_error`; every change to another status writes `auth_reason = NULL` in the same statement (stage 03 CHECK). The send outcome `{ kind: "auth_error" }` carries `reason`.

**Decisions.** D14, D15, D16, D17, D18.

**Edge cases.**
- Two jobs refresh one mailbox at once: the second waits on the lock, then refreshes again with the saved token (no stored access token; Q1 accepts two refreshes).
- A refresh while a Reconnect commits: the lock orders them; the refresh reads the new secret.
- An `auth_error` mailbox that the user reconnects: reason NULL, cache dropped.
- Pool: a refresh holds one pool connection for up to 10 s (the lock transaction around the HTTP call). Accepted: one refresh per mailbox at a time, and the jobs walk mailboxes one after another.

**Test** (integration: fake token server, GreenMail with XOAUTH2, real pool):
1. Two `accessToken` calls within one test minute → one refresh at the fake.
2. Fake `expires_in: 240` → the second call refreshes again (under 5 min left).
3. `rotate` on: after one refresh the stored refresh token is the new one; the old one is never stored again.
4. Two concurrent `accessToken(…, { fresh: true })` calls → two refreshes, in order; the stored token is the second rotation.
5. Fake answers `invalid_grant` AADSTS 700082 → the sync job sets `auth_error`, `auth_reason = 'oauth_expired'`; Google `invalid_grant` → `oauth_expired`; AADSTS 50173 → `oauth_revoked`.
6. Fake answers `invalid_client` → status stays `active`; one `mail_oauth_client_invalid` line.
7. Fake hangs, client `timeoutMs: 200` → status stays; `warn`.
8. Provider without a client → `SoftError`; status stays; one `mail_oauth_not_configured` line for two runs.
9. An `openProvider` stub that throws `MailAuthError` once → one `fresh` refresh, the second open passes. Throws twice → `protocol_disabled`.
10. A password mailbox in `auth_error` keeps `auth_reason` NULL; `auth_error` → `active` clears a reason.
11. Canary: refresh and access tokens in no log line or error text.

**Check.** The Proof.

**Done when.** The tests pass; every `openMailboxProvider` caller in the composition gets `oauthTokens`; the Proof prints `PROOF_OK`.

**Out of scope.** Texts, notices and views (stage 11); Graph (stage 13).

## Carry-over from stage 03 review

- The CHECK `auth_reason IS NULL OR (status = auth_error AND oauth_provider IS NOT NULL)` makes every status writer that moves a mailbox away from `auth_error` fail unless it clears `auth_reason` in the same statement. List every mailbox-status writer (re-auth success, pause, host_blocked, remove) and clear the reason in each; add a test per writer.

## Carry-over from stage 04 review

- Map both IMAP (`Unsupported authentication mechanism`, now a `HardError`) and SMTP (a 504 to AUTH XOAUTH2 when only PLAIN is offered, a `MailAuthError`) to the same reason `protocol_disabled`.
- An SMTP 421 to AUTH becomes `MailAuthError` (nodemailer raises EAUTH for any non-2xx reply to AUTH). Do not turn a temporary 421 into `protocol_disabled` or `oauth_revoked`: check the reply code before you set a reason.
- nodemailer sends a second AUTH with the same token after a 334 challenge, so one refused login counts as two failures at the provider. Refresh the token before you open the sender.
- imapflow prefers OAUTHBEARER over XOAUTH2 when the server offers both.
