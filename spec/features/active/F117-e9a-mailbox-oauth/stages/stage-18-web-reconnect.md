# F117 stage 18 — Panel: Reconnect, reason hints, remove texts

Part of [`../plan.md`](../plan.md). Needs stages 11, 12 and 17; review (Polish text).

## Step 18.1 — Mailbox card for OAuth mailboxes

- `authMethod = 'oauth'`: no "Change password" button; a provider badge; a "Reconnect" button (always in the card actions; the primary action when `status = 'auth_error'`).
- Reconnect: `POST /api/mailboxes/oauth/<provider>/start` with `{ mailboxId }`, then `location.assign(url)`. Options `reconnect: false` → the button is disabled with `mb_reconnect_unavailable`.
- `status = 'auth_error'`: the hint of `authReason` (null → `mb_reason_unknown`). `admin_consent_required` also shows the admin block of stage 17 (Microsoft only).
- Pause or resume on an `auth_error` OAuth mailbox (`409 wrong_status`) shows `err_wrong_status_oauth`.
- Password mailboxes: no change.

## Step 18.2 — Remove dialog and toast

- The remove answer of stage 12 picks the toast: `accessPage` `google` with `revoked: true` / `false`, `microsoft_work`, `microsoft_personal`; null → today's toast. The four texts are those of the stage 12 table, word for word, as web keys `removed_toast_google_revoked`, `removed_toast_google_failed`, `removed_toast_microsoft_work`, `removed_toast_microsoft_personal`.
- If today's dialog body speaks of the password, an OAuth mailbox gets `remove_body_oauth` instead.

**Texts** (`key`: en / pl; copy word for word):
- `mb_reconnect`: Reconnect / Połącz ponownie
- `mb_badge_microsoft`: Microsoft sign-in / Logowanie Microsoft
- `mb_badge_google`: Google sign-in / Logowanie Google
- `mb_reason_oauth_expired`: The sign-in expired. Tap Reconnect. / Logowanie wygasło. Stuknij „Połącz ponownie”.
- `mb_reason_oauth_revoked`: Access was withdrawn at the provider. Tap Reconnect. / Dostęp cofnięto po stronie dostawcy. Stuknij „Połącz ponownie”.
- `mb_reason_admin_consent_required`: Your administrator must approve this app. / Administrator musi zatwierdzić tę aplikację.
- `mb_reason_protocol_disabled`: Your administrator turned off IMAP or SMTP for this mailbox. Ask them to turn it on, then tap Reconnect. / Administrator wyłączył IMAP lub SMTP dla tej skrzynki. Poproś o włączenie, potem stuknij „Połącz ponownie”.
- `mb_reason_unknown`: The sign-in fails. Tap Reconnect. / Logowanie nie działa. Stuknij „Połącz ponownie”.
- `mb_reconnect_unavailable`: Reconnect is not available here now. Ask the operator. / Ponowne połączenie nie jest teraz dostępne. Zapytaj operatora.
- `err_wrong_status_oauth`: This mailbox has a sign-in error. Reconnect it first. / Ta skrzynka ma błąd logowania. Najpierw połącz ją ponownie.
- `remove_body_oauth`: Removing the mailbox ends the assistant's access to it. Mail on the mail server stays. / Usunięcie skrzynki kończy dostęp asystenta do niej. Poczta na serwerze zostaje.

**Decisions.** D13, D15, D19.

**Test** (web unit tests in the panel's pattern):
1. An OAuth Google card in `active` → badge, Reconnect, no password button.
2. Same card in `auth_error` with each of the 4 reasons and null → the matching hint; `admin_consent_required` on Microsoft → the admin block.
3. Reconnect calls start with `{ mailboxId }` and assigns the URL; options `reconnect: false` → disabled with the text.
4. Each remove answer → its toast (5 cases with today's).
5. A password card renders as today (snapshot).
6. i18n test: every new key in en and pl; no equal pair.

**Check.** The Proof with `web:build`.

**Done when.** The tests pass; `bun run web:build` passes; the Proof prints `PROOF_OK`.

**Out of scope.** Server routes (stages 07–12).

## Carry-over from the stage 06 review (2026-11-15)

`mb_reason_admin_consent_required` and the admin block: AADSTS 65001 means "the user or an administrator has not consented" (a personal account or a withdrawn consent gives it too). The card text must not say only "administrator".
