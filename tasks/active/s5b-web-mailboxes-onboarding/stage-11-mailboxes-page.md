# s5b-web-mailboxes-onboarding — Stage 11

Part of [`../s5b-web-mailboxes-onboarding.md`](../s5b-web-mailboxes-onboarding.md). Read that file's "Done when", "Owns", S1–S12, "Facts checked", B1–B17, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 11 — Mailboxes page: list, pause, resume, change password, remove

- [ ] **11.1 The list and the card actions (S4, S7, S8, U4–U7)**
  - Goal: `/mailboxes` shows every mailbox with its status, last sync, mode and scope badges; the owner pauses, resumes, changes a password and removes a mailbox; the page states follow U4.
  - Files: change `apps/web/src/islands/MailboxesPage.tsx`; create `apps/web/src/components/mailboxes/MailboxCard.tsx`, `PasswordDialog.tsx`, `RemoveDialog.tsx`.
  - Interfaces:

    ```ts
    // MailboxesPage: AppShell(active "mailboxes", title "title_mailboxes") around <Mailboxes />, which uses useMe() for role and timezone
    export function MailboxCard(props: {
      mailbox: MailboxView;
      isOwner: boolean;
      timeZone: string;
      now: Date;
      onChanged: () => void; // reload the list and /api/me (the auth_error banner count)
    }): JSX.Element;
    export function PasswordDialog(props: {
      mailbox: MailboxView;
      open: boolean;
      onOpenChange(open: boolean): void;
      onSaved(view: MailboxView): void;
    }): JSX.Element;
    export function RemoveDialog(props: {
      mailbox: MailboxView;
      open: boolean;
      onOpenChange(open: boolean): void;
      onRemoved(): void;
    }): JSX.Element;
    ```

  - Decisions:
    - Data: `useResource(() => api("/api/mailboxes", mailboxListSchema))` (30 s polling, U7); header row: `refresh` (calls `reload()`), and `updated_at` with `formatClock(lastLoad, timeZone, now)` where `lastLoad` is the time of the last successful load (keep it in state, set when `data` changes) and `now` = `useNow()` (stage 10; also passed to each card).
    - States (U4): loading → three skeleton cards (`aria-busy="true"`); error → `mb_load_error` + `retry`; empty → `mb_empty` (stage 12 adds the `mb_connect` button to the header and to the empty state).
    - Card (S4): the address in a `truncate` element with `title={address}`; `StatusBadge`; `mb_last_sync` with `formatClock` or `mb_never_synced`; `mb_mode_shadow` / `mb_mode_assist` / `mb_mode_none`; `ScopeBadges`; owner actions: `active` → `mb_pause`, `paused` → `mb_resume`, `auth_error` → the destructive `Alert` with `mb_auth_error_hint` and `mb_change_password` as the main button; a `DropdownMenu` (`mb_more`) with `mb_change_password` and `mb_remove`. An assistant sees the card without buttons. One column, `max-w-3xl` (48 rem) on both widths (S4).
    - Pause and resume: `api(\`/api/mailboxes/${id}/pause\`, mailboxViewSchema, { method: "POST" })`; the button is disabled while the request runs; success → toast `mb_paused_toast`/`mb_resumed_toast`and`onChanged()`; `ApiError`→ toast`t(errorText(error))`(409`wrong_status`→`err_wrong_status`; 403 → `owner_only`).
    - `onChanged` reloads the list and calls `useMe().reload()` so the S5a banner count follows.
    - `PasswordDialog` (S7): the field label is `mb_new_app_password_label` when the switch `app_password_switch` is on, else `mb_new_password_label`; the switch starts from the stored kind (`mailbox.secretKind === "app_password"`; cold review finding 10); `save` → while pending the button shows `checking_login` and is disabled, and the dialog cannot close; `POST …/password` with `{ password, secretKind }`; success → toast `password_saved_active` when the mailbox was `auth_error` before and is `active` now, else `password_saved`; errors inline under the field with `errorText` (422, 502, 404 → `error_generic`); the password state is cleared when the dialog closes. Validate with `mailboxPasswordBodySchema` before the request (empty → `err_required`).
    - `RemoveDialog` (S8): title `remove_title`; text `t("remove_text", { address })`; the input with the label `remove_confirm_label` (`autoComplete="off"`); `remove_submit` (`variant="destructive"`) is disabled until `sameAddress(typed, mailbox.address)`; `DELETE` with `{ confirmAddress: typed }`; success → toast `removed_toast`, `onRemoved()` (reload the list and `/api/me`); 400 `confirm_mismatch` cannot happen when the button rule holds, but shows `error_generic` if it does.
    - `react-compiler` and `jsx-a11y` errors are fixed, never disabled; every input has a `Label` with `htmlFor`.
  - Test: no unit test (React components; `test:unit` covers `lib/` only). Playwright covers the page in stage 14. A hand check: `bun run web:build`, `bun run dev` in the worktree, sign in through a `web:invite` link, a GreenMail mailbox connected with the CLI (`printf 'x' | bun run mailbox:connect --org-id <dev org> --address hand@e2e.test --imap-host 127.0.0.1 --imap-port 3143 --smtp-host 127.0.0.1 --smtp-port 3025`; GreenMail accepts any password, fact 3), then pause, resume, password, remove at 400 px and 1280 px in the headless Chromium (`CHROMIUM_PATH`) with screenshots; zero console or CSP errors.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && cd apps/web && bun run build`, then the hand check.
  - Done when: the build passes; the hand check passes; `grep -n "\"[A-Z][a-z]" apps/web/src/components/mailboxes/*.tsx` shows no UI literal (lint enforces it).
  - Out of scope: the connect dialog and the Telegram card (stage 12).
