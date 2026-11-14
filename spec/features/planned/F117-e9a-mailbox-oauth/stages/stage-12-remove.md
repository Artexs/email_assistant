# F117 stage 12 — Remove: revoke at Google, text per secret kind

Part of [`../plan.md`](../plan.md). Needs stage 10. Review (new Polish text).

## Step 12.1 — Revoke and the remove result

**Goal.** Removing an OAuth mailbox ends our access where the provider has an API, and tells the owner what is left to do (D19, ADR 0031 point 6).

**Rules.**
- `removeMailbox` keeps its order (pause, one delete transaction, audit, notice). For an `oauth` mailbox it reads and decrypts the secret before the delete, under `withMailboxOAuthLock`, then releases it.
- After the delete commits: `oauthTokens.drop(id)`; Google → `client.revoke(refreshToken)` with the 10 s timeout. A failure → one `warn` line `mail_oauth_revoke_failed` with `provider` and the soft kind; the remove still succeeds.
- Microsoft: no call (no per-grant revoke API for delegated tokens). The text names the page: work or school account → `myapps.microsoft.com`; personal account (tenant `9188040d-6c67-4c5b-b112-36a304b66dad`) → `account.live.com/consent/Manage`.
- The route answer gains `{ authMethod, oauthProvider, revoked: boolean | null, accessPage: "google" | "microsoft_work" | "microsoft_personal" | null }`; stage 17 picks the toast from it.
- The `mailbox_removed` notice view gains the same optional `access` field, set at queue time (the mailbox row is gone when it renders). Old rows without it render today's text.
- Organization delete (F106) revokes nothing (Q6); its secrets go with the rows.
- A crash after the commit and before the revoke: the token stays valid at Google until its expiry or the user's own revoke; accepted (the text tells them where).

**Texts** (core notice texts; stage 18 copies them as web keys; copy word for word):

| Case | en | pl |
| --- | --- | --- |
| Google, revoked | Mailbox removed. Its Google access is withdrawn. | Skrzynka usunięta. Dostęp przez Google został cofnięty. |
| Google, revoke failed | Mailbox removed. Withdraw its access at myaccount.google.com/permissions now. | Skrzynka usunięta. Cofnij teraz dostęp na myaccount.google.com/permissions. |
| Microsoft work | Mailbox removed. Withdraw the app's access at myapps.microsoft.com now. | Skrzynka usunięta. Cofnij teraz dostęp aplikacji na myapps.microsoft.com. |
| Microsoft personal | Mailbox removed. Withdraw the app's access at account.live.com/consent/Manage now. | Skrzynka usunięta. Cofnij teraz dostęp aplikacji na account.live.com/consent/Manage. |
| Password (today) | unchanged | unchanged |

**Decisions.** D18, D19.

**Test** (integration, fake token server):
1. Remove a Google OAuth mailbox → the fake's `revoked` holds its refresh token; the answer `revoked: true`, `accessPage: "google"`; the notice view has the access field.
2. The fake revoke answers 500 → remove succeeds, `revoked: false`, one `mail_oauth_revoke_failed` line.
3. Remove a Microsoft work mailbox → no revoke call; `revoked: null`, `accessPage: "microsoft_work"`; a personal-tenant one → `microsoft_personal`.
4. Remove a password mailbox → answer and notice as today.
5. Unit (core): the four notice texts in en and pl.
6. Canary: the refresh token is in no log line or error text.

**Check.** The Proof.

**Done when.** The tests pass; the Proof prints `PROOF_OK`.

**Out of scope.** The web remove dialog (stage 17).
