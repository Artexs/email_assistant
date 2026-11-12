# s5b-web-mailboxes-onboarding — Stage 12

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", S1–S12, "Facts checked", B1–B17, "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first.

## Stage 12 — The connect dialog and the Telegram card

- [x] **12.1 `ConnectDialog`, `?connect=1`, the Telegram card (S5, S9, S10, B15)**
  - Goal: the owner connects a mailbox from the page with a preset or with host fields; the page links and unlinks Telegram after onboarding.
  - Files: create `apps/web/src/components/mailboxes/ConnectDialog.tsx`, `apps/web/src/lib/connect-form.ts`, `apps/web/src/lib/connect-form.test.ts`; change `apps/web/src/islands/MailboxesPage.tsx`.
  - Interfaces:

    ```ts
    // lib/connect-form.ts (pure)
    export type ProviderChoice = PresetKey | "other";
    export interface ConnectFormState {
      provider: ProviderChoice;
      providerTouched: boolean;
      address: string;
      password: string;
      appPassword: boolean;
      imapHost: string;
      imapPort: string;
      smtpHost: string;
      smtpPort: string;
    }
    export function initialConnectForm(): ConnectFormState; // provider "interia", untouched, ports "993"/"465", appPassword false
    export function onAddressChange(state: ConnectFormState, address: string): ConnectFormState; // auto-pick (S5)
    export function onProviderChange(state: ConnectFormState, provider: ProviderChoice): ConnectFormState; // touched; appPassword = preset secretKind === "app_password"
    export function toConnectBody(state: ConnectFormState): unknown; // the request body (parsed by connectMailboxBodySchema before sending)
    export function fieldErrorKeys(
      issues: { path: PropertyKey[]; message: string }[]
    ): Partial<Record<keyof ConnectFormState, TextKey>>;
    // components/mailboxes/ConnectDialog.tsx
    export function ConnectDialog(props: {
      open: boolean;
      onOpenChange(open: boolean): void;
      onConnected(): void;
    }): JSX.Element;
    ```

  - Decisions:
    - Field order (S5): provider `Select` (`preset_interia`, `preset_gmail`, `preset_onet`, `preset_wp`, `preset_o2`, `preset_other`), the help line `help_<provider>` under it (muted), `address_label` (`type="email"`, `autoComplete="username"`, `inputMode="email"`), the password field (`type="password"`, `autoComplete="off"`, label `mb_app_password_label` when `appPassword`, else `mb_password_label`), the `Switch` `app_password_switch`; for `other` four more fields (`imap_host_label`, `imap_port_label` with `inputMode="numeric"`, `smtp_host_label`, `smtp_port_label`).
    - Auto-pick: while `providerTouched` is false, `onAddressChange` sets `provider = presetForAddress(address) ?? state.provider` and `appPassword` from that preset; once the user picks a provider, typing never changes it.
    - `toConnectBody` (every text field trimmed except the password; cold review finding 23): a preset → `{ address: address.trim(), password, secretKind, preset }`; `other` → `{ address: address.trim(), password, secretKind, imapHost: imapHost.trim(), imapPort: Number(imapPort), smtpHost: smtpHost.trim(), smtpPort: Number(smtpPort) }` (an empty or non-numeric port becomes `NaN`, which the schema refuses → `err_port`). `secretKind` = `appPassword ? "app_password" : "password"`. The password is never trimmed.
    - Before the request: `connectMailboxBodySchema.safeParse(body)`; issues → inline errors through `fieldErrorKeys` (`required`, or a `too_small` issue on any field → `err_required`; another issue on a port path → `err_port`; another issue on a host path → `err_host`; `address` → `email_invalid` (exists since S5a); `password` → `err_required`).
    - Submit: `api("/api/mailboxes", connectResultSchema, { method: "POST", body })`; while pending the button shows `checking_login`, every field and the close control are disabled (`onOpenChange` ignores a close while pending); success → toast `connected_toast`, clear the form (also the password), `onConnected()` (reload the list and `/api/me`), close; `ApiError` → one inline error above the button with `errorText` (422 `err_mail_login_failed`, 502 `err_mail_unreachable`, 409 `err_mailbox_exists`, 400 `host_not_allowed` → `err_host_not_allowed`, 400 `validation` → the field errors from `details` mapped by `fieldErrorKeys`).
    - `MailboxesPage`: the owner sees `mb_connect` in the header and in the empty state; `?connect=1` in `location.search` opens the dialog once on mount (in an effect; then `history.replaceState` drops the parameter so a reload does not reopen it); an assistant never sees the dialog.
    - The Telegram card (S9): under the list, a `Card` with the title `tg_title` and `<TelegramLink timeZone={me.organization.timezone} onChange={reloadMe} />`; for every member (each links their own chat).
    - Under the list, once: `mb_scopes_note` (muted).
  - Test (`connect-form.test.ts`): (1) the initial state; (2) typing `anna@gmail.com` while untouched → provider `gmail`, `appPassword` true; then `x@wp.pl` → `wp`, `appPassword` false; (3) after `onProviderChange("onet")`, typing `x@gmail.com` keeps `onet`; (4) `toConnectBody` for `gmail` has no host keys and keeps a password with outer spaces; for `other` the ports are numbers; (5) `other` with an empty SMTP port → `connectMailboxBodySchema` refuses it and `fieldErrorKeys` gives `smtpPort: "err_port"`; (6) `other` with the host `"bad host"` → `imapHost: "err_host"`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && cd apps/web && bun run build`; a hand check as in stage 11: connect GreenMail through "Other" (`127.0.0.1`, 3143, `127.0.0.1`, 3025; the worktree server needs `WEB_MAIL_ALLOW_LOCAL=true` in its environment for this run: pass it on the command line, do not edit `.env`), a 409 on the second try, `/mailboxes?connect=1` opens the dialog; the Telegram card shows `tg_off` when the dev server runs without a bot token. The hand-check server command: `WEB_MAIL_ALLOW_LOCAL=true TELEGRAM_BOT_TOKEN= HEARTBEAT_URL= bun run dev` (the worktree `.env` is a copy with the dev bot token and the heartbeat URL; empty values on the command line win, S5a fact 21; cold review finding 22).
  - Done when: the tests pass; the hand check passes at both widths with zero console or CSP errors.
  - Out of scope: the onboarding page (stage 13), Playwright (stage 14).
