# F117 stage 17 — Panel: the admin consent block and its result page

Part of [`../plan.md`](../plan.md). Needs stages 14 and 16; review (Polish text).

## Step 17.1 — Admin block on `/mailboxes`

**Goal.** An owner whose work tenant needs admin approval can forward a link and knows what it grants (PD-088, notes §5).

- When the stage 16 banner shows `admin_consent_required` with `provider=microsoft`: call `GET /api/mailboxes/oauth/microsoft/admin-consent`; show the link in a read-only field, a copy button (Clipboard API; on failure the field stays selectable), the four scope lines in the order of the answer, and the private-network caveat (Q4).
- The Reconnect card of stage 18 shows the same block for a mailbox with `authReason = 'admin_consent_required'`; build it as one component that both use.
- A route error (`409 not_configured`) hides the block and keeps the banner.

## Step 17.2 — Result page `/mailboxes/admin-consent`

- New static page. It calls no API and needs no session: the administrator is not our user. Check that the panel's session redirect skips this path, and say how in the final message.
- `admin_consent=True` in the query → the approved text; anything else → the not-approved text. The page shows no query value.

**Texts** (`key`: en / pl; copy word for word):
- `oauth_admin_title`: Approval by your administrator / Zgoda administratora
- `oauth_admin_copy`: Copy link / Kopiuj link
- `oauth_admin_copied`: Link copied. / Link skopiowany.
- `oauth_scope_profile`: Sign in and read your e-mail address / Logowanie i odczyt adresu e-mail
- `oauth_scope_offline`: Access without a new sign-in each time / Dostęp bez ponownego logowania za każdym razem
- `oauth_scope_imap`: Read, move and add mail in the mailbox (IMAP) / Czytanie, przenoszenie i dodawanie wiadomości w skrzynce (IMAP)
- `oauth_scope_send`: Send mail as the mailbox user / Wysyłanie wiadomości w imieniu użytkownika skrzynki
- `oauth_admin_caveat`: After the approval, your administrator can see an error page, because this panel is on a private network. The approval still counts. / Po zatwierdzeniu administrator może zobaczyć stronę błędu, bo ten panel działa w sieci prywatnej. Zgoda i tak jest ważna.
- `oauth_admin_done_ok`: The app is approved. The user can now connect the mailbox. / Aplikacja zatwierdzona. Użytkownik może teraz połączyć skrzynkę.
- `oauth_admin_done_no`: The app was not approved. Nothing changed. / Aplikacja nie została zatwierdzona. Nic się nie zmieniło.

**Decisions.** D10, D11, Q4.

**Test** (web unit tests in the panel's pattern):
1. Banner `admin_consent_required` + a stubbed route answer → the block with the URL and four scope lines in answer order.
2. The stubbed route answers 409 → no block; the banner stays.
3. Copy: a stub clipboard gets the URL; a failing clipboard leaves the field selected and shows no "copied" text.
4. The result page with `admin_consent=True` → approved text; with `error=access_denied&error_description=x` → not approved, and `x` is not in the page.
5. i18n test: every new key in en and pl; no equal pair.

**Check.** The Proof with `web:build`.

**Done when.** The tests pass; `bun run web:build` passes; the Proof prints `PROOF_OK`.

**Out of scope.** The server route (stage 14); Reconnect (stage 18).
