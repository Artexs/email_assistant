# F170 stage 07 — Mailboxes: cards with a clear state

Needs F166 stage 06: `InitialsAvatar`. Needs F166 stage 09: `AppShell` `lead` and `action`. Needs F166 stage 10: `SectionCard`, `EmptyState`, `FactBox`. May run next to 01–06, 08, 09, 10.

Part of [`../plan.md`](../plan.md). Decisions: P2, P3, P4, P9, D1, D5, D6; questions.md items 2 and 3.

Owns: `apps/web/src/islands/MailboxesPage.tsx`, `components/mailboxes/`, `components/telegram/`, `apps/web/src/lib/mailbox-status.ts`, `mailboxes.spec.ts`, `mailbox-oauth.spec.ts`, `polish.spec.ts`, the `mb_*`, `oauth_*`, `tg_*`, `status_*` keys (next to their groups).

## Step 1 — The card state

- **Interface:** `mailboxCardState(mailbox: MailboxView): MailboxCardState` in `lib/mailbox-status.ts`, `MailboxCardState = "connected" | "never_synced" | "paused" | "login_error" | "host_refused" | "access_revoked"`. `mailboxStatusUi` stays (Settings uses `StatusBadge`).
- **Decisions (P3):** `paused` → paused; `host_blocked` → host_refused; `auth_error` with `authMethod: "oauth"` → access_revoked; other `auth_error` → login_error; `active` with `lastSyncedAt: null` → never_synced; else connected. The card carries `data-state=<state>`.
- **Per state:** status line with icon (connected `CircleCheck` + last sync; never synced `Clock` + `mb_never_synced`; paused `Pause`; login error, host refused, access revoked `TriangleAlert`, destructive tone, the card gets the destructive edge). The owner hint: login error `mb_auth_error_hint`; host refused `mb_host_blocked_hint`; access revoked by `authReason`: `admin_consent_required` → `oauth_err_admin`, `protocol_disabled` → `oauth_err_protocol`, else (`oauth_expired`, `oauth_revoked`, `null`) the new `mb_access_revoked_hint` ("The access to this mailbox was withdrawn or has expired. Connect it again to start it again.").
- **Buttons (owner who can write; today's rules):** Pause (connected, never synced), Resume (paused), Change password (login error only), Connect mailbox (access revoked: opens today's `ConnectDialog`), More → Change password (password mailboxes only) and Remove. Host refused keeps no pause, resume or password button.
- **Before you build:** read `apps/server/src/modules/mail/oauth/apply.ts`: does a sign-in with the account of an existing OAuth mailbox give `reconnected`? If not, the access-revoked card has no Connect button and the hint says to remove the mailbox and connect it again; say so in the final message.
- **Test (unit, `test.each`):** (1) the six rows: `{ status: "active", lastSyncedAt: "2026-11-20T08:00:00.000Z" }` → connected; `{ status: "active", lastSyncedAt: null }` → never_synced; `paused` → paused; `host_blocked` → host_refused; `{ status: "auth_error", authMethod: "password" }` → login_error; `{ status: "auth_error", authMethod: "oauth", authReason: "oauth_revoked" }` → access_revoked. (2) Render test: an `auth_error` OAuth card for an owner has no button named `mb_change_password` and one named `mb_connect`.

## Step 2 — The page

- **Look (mockup screen `mailboxes`, shot `04b-*`):** a grid of cards (one column below `lg`, two from `lg`). A card: `InitialsAvatar` of the address, the address (breaks at `@`, `title` keeps the full address), the provider line if OAuth, the status line, the mode as a `Badge` (`mb_mode_*`, P4: no toggle), the scope badges, the hint, the buttons. No "mails today", no automatic-action card (PB-4, PB-7).
- **Page head:** `lead="mb_lead"`: "Your connected mailboxes and their state."; `action`: "Connect mailbox" for an owner who can write (it opens the dialog; the in-page button goes). "Updated at" and Refresh stay above the grid.
- **Other parts:** no mailbox → `EmptyState` (icon `Inbox`, `mb_empty`, Connect for the owner). The OAuth result banner keeps `data-block="oauth-banner"`, `role` alert or status, Close. The Telegram card is a `SectionCard` (icon `Send`, `tg_title`); the link block, the consent tick and the detail choice keep their flow. `mb_scopes_note` is a `FactBox`. The connect, password and remove dialogs: primitives only, every field id and error id stays, the remove dialog's access-page links stay.
- **Edge cases:** `?connect=1` still opens the dialog once; `?oauth=<code>` still shows one banner. A member sees cards, no button, no page action.
- **Test:** (3) e2e `mailboxes.spec.ts`: with `page.route` on `/api/mailboxes` answering the six states of test 1 (one mailbox each), each card has its `data-state` and the a11y scan passes. (4) `mailbox-oauth.spec.ts` and `onboarding.spec.ts`' connect step pass. (5) `polish.spec.ts` passes.

## Step 3 — Docs

Update rule 9 (Mailboxes) and rule 13 of `docs/capabilities/web-panel.md` (the six states) and `apps/docs` how-to `pause` (English and Polish).

## Out of scope

A mode toggle or switches on this page (PB-4). Any mail or OAuth API.

## Done when

The pictures of `mailboxes` match shot `04b-*`; the Proof of `../plan.md` with `mailboxes.spec.ts mailbox-oauth.spec.ts polish.spec.ts onboarding.spec.ts activity.spec.ts` prints `PROOF_OK`.
