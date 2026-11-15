# F117 stage 16 — Panel: sign-in buttons and the result banner

Part of [`../plan.md`](../plan.md). Needs stage 09; review (Polish text).

## Step 16.1 — Connect dialog

- `ConnectDialog` reads `GET /api/mailboxes/oauth/options`. For each provider with `connect: true`, a button above the presets: "Sign in with Microsoft" or "Sign in with Google". A tap: `POST …/:provider/start` with the body `{}` (the route parses JSON; an empty body is a 400 `invalid_json`), then `location.assign(url)`. A start error shows the text of its code.
- The password presets stay below "Or connect with a password". The `gmail` preset stays (PD-087).
- Under the Google button: the testing-mode hint (R6).

## Step 16.2 — Result banner on `/mailboxes`

- Read `oauth` (and `mailbox`, `provider`) from the query once, show the banner, then remove the query with `history.replaceState`. An unknown code shows the `oauth_failed` text.
- `connected`, `reconnected` → success banner; the list reloads.
- `admin_consent_required` shows `oauth_err_admin`; stage 17 adds the admin block under it.

**Texts** (`key`: en / pl; copy word for word; reuse the existing keys for `mailbox_exists` and `mailbox_limit`):
- `oauth_btn_microsoft`: Sign in with Microsoft / Zaloguj się przez Microsoft
- `oauth_btn_google`: Sign in with Google / Zaloguj się przez Google
- `oauth_or_password`: Or connect with a password / Albo połącz hasłem
- `oauth_google_hint`: While this app is in Google's test mode, Google asks you to sign in again every 7 days. An app password does not expire. / Dopóki aplikacja jest w trybie testowym Google, Google co 7 dni prosi o ponowne zalogowanie. Hasło aplikacji nie wygasa.
- `oauth_ok_connected`: Mailbox connected. The first sync starts within a few minutes. / Skrzynka połączona. Pierwsza synchronizacja ruszy w ciągu kilku minut.
- `oauth_ok_reconnected`: Mailbox reconnected. Sync starts again within a few minutes. / Skrzynka połączona ponownie. Synchronizacja ruszy w ciągu kilku minut.
- `oauth_err_cancelled`: Sign-in was cancelled. Nothing changed. / Logowanie przerwane. Nic się nie zmieniło.
- `oauth_err_state` (`oauth_state_invalid`, `oauth_state_expired`): The sign-in link is no longer valid. Start again. / Link logowania jest już nieważny. Zacznij od nowa.
- `oauth_err_failed` (`oauth_code_invalid`, `oauth_failed`): The sign-in did not work. Try again. / Logowanie się nie udało. Spróbuj ponownie.
- `oauth_err_scope`: The mailbox needs every permission on the sign-in page. Start again and allow all of them. / Skrzynka potrzebuje wszystkich uprawnień ze strony logowania. Zacznij od nowa i zezwól na wszystkie.
- `oauth_err_wrong_account`: You signed in with another account. Sign in with the address of this mailbox. / Zalogowano się na inne konto. Zaloguj się adresem tej skrzynki.
- `oauth_err_admin`: Your administrator must approve this app first. Send them the link below. / Najpierw administrator musi zatwierdzić tę aplikację. Wyślij administratorowi poniższy link.
- `oauth_err_protocol`: Your administrator turned off IMAP or SMTP for this mailbox. Ask them to turn it on. / Administrator wyłączył IMAP lub SMTP dla tej skrzynki. Poproś o włączenie.
- `oauth_err_unavailable` (`feature_off`, `not_configured`): Sign-in with this provider is not available here. / Logowanie przez tego dostawcę nie jest tu dostępne.

**Decisions.** D8, D10, D11.

**Test** (web unit tests in the panel's pattern; no Playwright spec):
1. Options `[{ microsoft, connect: true }, { google, connect: false }]` → one Microsoft button, no Google button, presets still shown.
2. A tap calls start and assigns the returned URL (stub `location.assign`).
3. Each code of D11 maps to a text key; an unknown code → `oauth_err_failed`.
4. The query is removed after the banner shows.
5. i18n test: every new key in en and pl; no equal pair.

**Check.** The Proof with `web:build`.

**Done when.** The tests pass; `bun run web:build` passes; the Proof prints `PROOF_OK`.

**Out of scope.** The admin block (stage 17); Reconnect and remove UI (stage 18).
