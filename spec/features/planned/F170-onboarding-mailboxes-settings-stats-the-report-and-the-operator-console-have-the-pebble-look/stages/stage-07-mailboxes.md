# F170 stage 07 — Mailboxes: cards with a clear state

Needs F166 stage 02: `ui:sheet`, the a11y `schemes` option. Needs F166 stages 04, 05: the primitives. Needs F166 stage 06: `InitialsAvatar`. Needs F166 stage 08: `web:build:dev`, `patterns.spec.ts` (the Proof). Needs F166 stage 09: `AppShell` `lead` and `action`. Needs F166 stage 10: `SectionCard`, `EmptyState`, `FactBox`. May run next to 01–06, 08, 09, 10.

Part of [`../plan.md`](../plan.md). Decisions: P2, P3, P4, P9, D1, D5, D6, D7; questions.md items 2, 3.

Owns: `apps/web/src/islands/MailboxesPage.tsx`, `components/mailboxes/`, `components/telegram/`, `apps/web/src/lib/mailbox-status.ts`, `apps/web/src/lib/mail-oauth.ts`, `mailboxes.spec.ts`, `mailbox-oauth.spec.ts`, `polish.spec.ts`, the `mb_*`, `oauth_*`, `tg_*`, `status_*` keys (next to their groups).

## Step 1 — The card state

- **Interface:** `mailboxCardState(mailbox: MailboxView): MailboxCardState` in `lib/mailbox-status.ts`, `MailboxCardState = "connected" | "never_synced" | "paused" | "login_error" | "host_refused" | "access_revoked"`. `mailboxStatusUi` stays.
- **Decisions (P3):** `paused` → paused; `host_blocked` → host_refused; `auth_error` + `authMethod: "oauth"` → access_revoked; other `auth_error` → login_error; `active` + `lastSyncedAt: null` → never_synced; else connected. The card carries `data-state=<state>`.
- **Per state:** status line with icon (connected `CircleCheck` + last sync; never synced `Clock` + `mb_never_synced`; paused `Pause`; the three error states `TriangleAlert`, destructive tone and edge). The owner hint: login error `mb_auth_error_hint`; host refused `mb_host_blocked_hint`; access revoked by `authReason`: `admin_consent_required` → `oauth_err_admin`, `protocol_disabled` → `oauth_err_protocol`, else (`oauth_expired`, `oauth_revoked`, `null`) the new `mb_access_revoked_hint` ("The access to this mailbox was withdrawn or has expired. Reconnect it to start it again.").
- **Buttons (owner who can write):** Pause (connected, never synced), Resume (paused), Change password (login error), Reconnect (access revoked), More → Change password (password mailboxes) and Remove. Host refused: only More.
- **Reconnect (P3).** A new connect of a known address is refused (`mailbox_exists`, `oauth/apply.ts`); a start call with `mailboxId` reaches the server's Reconnect (flag off too; another account gives `oauth_wrong_account`).
  - **Interface:** `startOAuth(provider, deps = browserDeps(), mailboxId?: string)` in `lib/mail-oauth.ts`: the body is `{ mailboxId }` when given, else `{}` as today.
  - The button `mb_reconnect` ("Reconnect") calls `startOAuth(mailbox.oauthProvider, undefined, mailbox.id)`. Disabled while the call runs; a failure toasts the returned key; `watchPageRestore` clears the pending state. The return shows today's banner. No button when `oauthProvider` is `null`.
- **Test (unit, `test.each`):** (1) the six rows: `{ status: "active", lastSyncedAt: "2026-11-20T08:00:00.000Z" }` → connected; `{ status: "active", lastSyncedAt: null }` → never_synced; `paused` → paused; `host_blocked` → host_refused; `{ status: "auth_error", authMethod: "password" }` → login_error; `{ status: "auth_error", authMethod: "oauth", authReason: "oauth_revoked" }` → access_revoked. (2) Render test: an `auth_error` OAuth card for an owner has no button named `mb_change_password` and one named `mb_reconnect`. (2b) `mail-oauth.test.tsx`: `startOAuth("google", deps, <fixed uuid>)` posts `{ mailboxId: <that uuid> }`; without it, `{}`.

## Step 2 — The page

- **Look (shot `04b-*`):** a grid of cards (one column below `lg`, two from `lg`). A card: `InitialsAvatar`, the address (breaks at `@`, full in `title`), the provider line if OAuth, the status line, the mode `Badge` (P4), the scope badges, the hint, the buttons. No "mails today" (PB-7).
- **Page head:** `lead="mb_lead"`: "Your connected mailboxes and their state."; `action`: "Connect mailbox" for an owner who can write (opens the dialog; the in-page button goes). "Updated at" and Refresh stay.
- **Other parts:** no mailbox → `EmptyState` (icon `Inbox`, `mb_empty`, Connect). The OAuth banner keeps `data-block="oauth-banner"`, its `role` and Close. The Telegram card is a `SectionCard` (icon `Send`, `tg_title`); its flow stays. `mb_scopes_note` is a `FactBox`. The dialogs keep every field id, error id and the remove dialog's access-page links.
- **Edge cases:** `?connect=1` opens the dialog once; `?oauth=<code>` shows one banner. A member sees no button and no page action.
- **Test:** (3) e2e `mailboxes.spec.ts`: `page.route` on `/api/mailboxes` answers the six states of test 1; each card has its `data-state`, the a11y scan passes; the spec saves phone and desktop pictures under `<UI_SHEET_DIR>/f170-07/` (D7). (4) `mailbox-oauth.spec.ts`, the connect step of `onboarding.spec.ts` and `polish.spec.ts` pass.

## Step 3 — Docs

Update rule 9 (Mailboxes) and rule 13 of `docs/capabilities/web-panel.md` (the six states) and `apps/docs` how-to `pause` (English and Polish; name Reconnect).

## Out of scope

A mode toggle or switches on this page (PB-4). Any server change.

## Done when

The four `mailboxes-*` sheet rows and the six-state pictures match shot `04b-*`; the Proof of `../plan.md` with `mailboxes.spec.ts mailbox-oauth.spec.ts polish.spec.ts onboarding.spec.ts activity.spec.ts` prints `PROOF_OK`.
