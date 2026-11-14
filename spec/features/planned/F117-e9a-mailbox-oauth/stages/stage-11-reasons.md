# F117 stage 11 — Reasons in views, notices and the password paths

Part of [`../plan.md`](../plan.md). Needs stage 10. Review (new Polish text).

## Step 11.1 — Mailbox view and password paths

**Interfaces.**
- The mailbox view of `GET /api/mailboxes` gains `authMethod: "password" | "oauth"`, `oauthProvider: MailOAuthProvider | null`, `authReason: AuthErrorReason | null`. Stages 16–17 read them. Update the web API types.
- `POST /api/mailboxes/:id/password` on an `oauth` mailbox → `409 oauth_mailbox`, nothing changes. `bun run mailbox:password` on one → exit 1, `oauth mailbox: use Reconnect in the panel`.

## Step 11.2 — The `auth_error` notice and Telegram texts

**Interfaces.**
- `authErrorView` (notice view schema) gains optional `oauth: { provider: MailOAuthProvider; reason: AuthErrorReason | null } | undefined`. Old outbox rows without it still parse.
- The detector fills it from the mailbox row.
- `NoticeTexts.authError.fixOAuth(provider: string, reason: AuthErrorReason | null): string` replaces `fix` for OAuth mailboxes; `first` and `noRead` stay.
- Bot texts: `stateAuthErrorOAuth(since)` and `loginErrorOAuth(address)` for `/status` and the approval paths that today say "run mailbox:password".
- Provider names in text: `Microsoft`, `Google`.

**Texts** (copy word for word; `{p}` = provider name):

| Key | en | pl |
| --- | --- | --- |
| `fixOAuth` `oauth_expired` | The sign-in to {p} expired. Open the panel, Mailboxes, and tap Reconnect. | Logowanie do {p} wygasło. Otwórz panel, Skrzynki, i stuknij „Połącz ponownie”. |
| `fixOAuth` `oauth_revoked` | Access to the mailbox was withdrawn at {p}. Open the panel, Mailboxes, and tap Reconnect. | Dostęp do skrzynki cofnięto po stronie {p}. Otwórz panel, Skrzynki, i stuknij „Połącz ponownie”. |
| `fixOAuth` `admin_consent_required` | Your administrator must approve this app. The panel, Mailboxes, has the approval link. | Administrator musi zatwierdzić tę aplikację. Link do zatwierdzenia jest w panelu, w Skrzynkach. |
| `fixOAuth` `protocol_disabled` | Your administrator turned off IMAP or SMTP for this mailbox. Ask them to turn it on, then tap Reconnect in the panel. | Administrator wyłączył IMAP lub SMTP dla tej skrzynki. Poproś o włączenie, potem stuknij „Połącz ponownie” w panelu. |
| `fixOAuth` null | The sign-in to {p} fails. Open the panel, Mailboxes, and tap Reconnect. | Logowanie do {p} nie działa. Otwórz panel, Skrzynki, i stuknij „Połącz ponownie”. |
| `stateAuthErrorOAuth` | sign-in error since {since} (Reconnect in the panel) | błąd logowania od {since} (połącz ponownie w panelu) |
| `loginErrorOAuth` | ❌ {address} has a sign-in error: tap Reconnect in the panel first. | ❌ {address} ma błąd logowania: najpierw stuknij „Połącz ponownie” w panelu. |

Check the panel's Polish label for Mailboxes and the Reconnect button name of stage 17 ("Połącz ponownie"); if the panel uses another word for "Skrzynki", use the panel's word and say so in the final message.

**Decisions.** D15, D18.

**Edge cases.**
- The reason changes while a notice waits (for example `oauth_expired`, then a Reconnect, then `protocol_disabled`): each `status_changed_at` gives its own dedup key (today's rule); the old pending notice is cancelled (today's rule).
- A password mailbox: today's texts, byte for byte.

**Test.**
1. Unit (core): render each of the 5 `fixOAuth` cases in en and pl; the text names the provider and never `mailbox:password`.
2. Unit (core): an old `auth_error` view without `oauth` renders today's text unchanged (snapshot of today's output).
3. Integration: an OAuth Google mailbox set to `auth_error` with `oauth_expired` → one outbox row whose view has `oauth.reason = 'oauth_expired'`.
4. Integration: `GET /api/mailboxes` shows `authMethod`, `oauthProvider`, `authReason` for one OAuth and one password mailbox.
5. Integration: the password route on an OAuth mailbox → `409 oauth_mailbox`; the CLI → exit 1 and the message.
6. Unit: the i18n test that refuses equal en and pl texts passes with the new keys.

**Check.** The Proof.

**Done when.** The tests pass; the Proof prints `PROOF_OK`.

**Out of scope.** Panel UI (stage 17), push (E9b).
