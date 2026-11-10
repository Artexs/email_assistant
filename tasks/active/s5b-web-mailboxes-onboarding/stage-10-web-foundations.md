# s5b-web-mailboxes-onboarding — Stage 10

Part of [`../s5b-web-mailboxes-onboarding.md`](../s5b-web-mailboxes-onboarding.md). Read that file's "Done when", "Owns", S1–S12, "Facts checked", B1–B17, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 10 — `lib/poll.ts` with the visibility test, the strings, the shared components

Two steps. No page changes yet: stages 11–13 use these parts.

- [ ] **10.1 `lib/poll.ts` and its test (B14, U7; the S5a final review item)**
  - Goal: the 30-second polling pauses while the tab is hidden, and a unit test proves it without a DOM library (no `bun.lock` change).
  - Files: create `apps/web/src/lib/poll.ts`, `apps/web/src/lib/poll.test.ts`; change `apps/web/src/lib/use-resource.ts`.
  - Interfaces:

    ```ts
    export interface PollDoc {
      readonly visibilityState: string;
      addEventListener(type: "visibilitychange", listener: () => void): void;
      removeEventListener(type: "visibilitychange", listener: () => void): void;
    }
    export interface PollTimers {
      setInterval(handler: () => void, ms: number): unknown;
      clearInterval(id: unknown): void;
    }
    // Runs `run` once now; repeats it every `pollMs` while the document is visible; returns stop().
    export function startPolling(
      run: () => void,
      opts: { pollMs: number; doc: PollDoc; timers: PollTimers }
    ): () => void;
    ```

  - Decisions:
    - The logic is the one in `use-resource.ts` today: run once; start the interval only when `visibilityState === "visible"`; on `visibilitychange` to `visible` run at once and restart; to anything else clear the interval; `stop()` clears the interval and removes the listener. At most one interval exists at any time.
    - `useResource` keeps its signature and its `loadRef` and `tick` logic; its effect body becomes `const stop = startPolling(run, { pollMs, doc: document, timers: { setInterval: (h, ms) => setInterval(h, ms), clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>) } }); return () => { active = false; stop(); };`.
  - Test (`poll.test.ts`, `bun:test`; the fake document is a small class with a writable `visibilityState` and a listener set; the fake timers record `{ id, ms }` and the cleared ids):
    1. Visible at the start: `run` called once; one interval with `ms` = 30000.
    2. Hidden at the start: `run` once; no interval.
    3. Visible → hidden event: the interval is cleared; no new interval.
    4. Hidden → visible event: `run` called again at once; a new interval; the old one is not running (at most one live id).
    5. `stop()`: the interval is cleared, the listener removed; a later `visibilitychange` calls nothing.
    6. Two visible events in a row leave one live interval (no leak).
  - Check: `bun run lint && bun run typecheck && bun run test:unit` (`test:unit` covers `apps/web/src/lib`).
  - Done when: the tests pass; `use-resource.ts` has no `visibilitychange` code of its own.
  - Out of scope: a DOM test library.

- [ ] **10.2 The strings, the lint scope, the shared components (U1, B14, B15)**
  - Goal: every S5b text exists once in `en.ts`; the status badge, the scope badges and the Telegram link block are ready for both pages.
  - Files: change `apps/web/src/i18n/en.ts`, `eslint.config.js` (the `react/jsx-no-literals` block also covers `apps/web/src/components/mailboxes/**/*.tsx`, `components/telegram/**/*.tsx`, `components/onboarding/**/*.tsx`); create `apps/web/src/components/mailboxes/StatusBadge.tsx`, `ScopeBadges.tsx`, `apps/web/src/components/telegram/TelegramLink.tsx`, `apps/web/src/lib/errors.ts` (+ `errors.test.ts`), `apps/web/src/lib/scope-text.ts` (+ `scope-text.test.ts`), `apps/web/src/lib/use-now.ts`.
  - Interfaces:

    ```ts
    // components/mailboxes/StatusBadge.tsx
    export function StatusBadge({ status }: { status: MailboxView["status"] }): JSX.Element;
    // components/mailboxes/ScopeBadges.tsx — three badges, then the deduplicated reason lines (muted, small)
    export function ScopeBadges({ scopes }: { scopes: MailboxView["scopes"] }): JSX.Element;
    // lib/scope-text.ts — pure, so test:unit (which covers apps/web/src/lib) can test it
    export function badgeKey(scope: "triage" | "actions" | "send", state: ScopeBadge["state"]): TextKey;
    export function reasonKeys(scopes: MailboxView["scopes"]): TextKey[]; // order triage, actions, send; no duplicates
    // components/telegram/TelegramLink.tsx — the link step (question 12) and the linked state with Unlink (question 9)
    export function TelegramLink({ timeZone, onChange }: { timeZone: string; onChange?: () => void }): JSX.Element;
    // lib/errors.ts — maps an ApiError code to a text key; unknown → "error_generic"
    export function errorText(error: unknown): TextKey;
    ```

  - Decisions:
    - `en.ts` gets exactly these keys (the texts of S4–S12; keep the existing keys; add `owner_only`, used for every 403 `owner_only`, U4):

      ```ts
      owner_only: "Only the owner can do this.",
      cancel: "Cancel", save: "Save", refresh: "Refresh", updated_at: "Updated {time}",
      status_active: "Active", status_paused: "Paused", status_auth_error: "Login error",
      mb_connect: "Connect mailbox", mb_empty: "No mailbox yet.", mb_load_error: "Could not load the mailboxes.",
      mb_last_sync: "Last sync {time}", mb_never_synced: "Not synced yet",
      mb_mode_shadow: "Mode: shadow", mb_mode_assist: "Mode: assist", mb_mode_none: "Mode: not set",
      mb_pause: "Pause", mb_resume: "Resume", mb_more: "More", mb_change_password: "Change password", mb_remove: "Remove",
      mb_auth_error_hint: "The login failed. Change the password to start the mailbox again.",
      mb_paused_toast: "Paused. The system does not read or triage this mailbox now. Digests still come.",
      mb_resumed_toast: "Resumed. The next sync runs within 5 minutes.",
      mb_scopes_note: "The server settings decide these. The web cannot change them.",
      badge_triage_on: "Triage: on", badge_triage_synthetic: "Triage: test mail only", badge_triage_off: "Triage: off",
      badge_actions_on: "Mailbox changes: on", badge_actions_synthetic: "Mailbox changes: test mail only", badge_actions_off: "Mailbox changes: off",
      badge_send_on: "Sends: on", badge_send_self: "Sends: test addresses only", badge_send_off: "Sends: off",
      reason_triage_env_off: "Triage is off on this server (TRIAGE_LLM_SCOPE=off).",
      reason_actions_env_off: "Mailbox changes are off on this server (ACTIONS_SCOPE=off).",
      reason_send_env_off: "Sends are off on this server (SEND_SCOPE=off).",
      reason_other_mailbox: "Only the test mailbox is covered (TEST_MAILBOX_ADDRESS).",
      reason_synthetic_only: "Only synthetic test mail is covered.",
      reason_test_addresses_only: "Sends go only to the test addresses (SEND_TEST_ADDRESSES).",
      connect_title: "Connect a mailbox", provider_label: "Provider",
      preset_interia: "Interia", preset_gmail: "Gmail", preset_onet: "Onet", preset_wp: "WP", preset_o2: "o2", preset_other: "Other",
      help_interia: "Use your Interia password.",
      help_gmail: "Gmail needs an app password: turn on 2-Step Verification, then create one at myaccount.google.com/apppasswords.",
      help_onet: "Turn on IMAP and SMTP in the Onet mail settings first (Mail settings → Main account).",
      help_wp: "With two-step login, create a password for mail programs in the account settings.",
      help_o2: "With two-step login, create a password for mail programs in the account settings.",
      help_other: "Enter the IMAP and SMTP servers of your provider. Both must use SSL/TLS (as a rule ports 993 and 465).",
      address_label: "E-mail address", mb_password_label: "Password", mb_app_password_label: "App password",
      app_password_switch: "This is an app password",
      imap_host_label: "IMAP host", imap_port_label: "IMAP port", smtp_host_label: "SMTP host", smtp_port_label: "SMTP port",
      connect_submit: "Connect", checking_login: "Checking the login… (up to a minute)",
      err_mail_login_failed: "The server refused the login. Check the address and the password.",
      err_mail_unreachable: "Could not reach the mail server. Check the host and the port, or try again later.",
      err_mailbox_exists: "This mailbox is connected already.", err_host_not_allowed: "This host is not allowed.",
      err_wrong_status: "This mailbox has a login error. Change its password first.",
      err_required: "Fill in this field.", err_port: "Enter a port from 1 to 65535.", err_host: "Enter a host name without spaces.",
      connected_toast: "Mailbox connected. The first sync runs within 5 minutes.",
      password_title: "Change password", mb_new_password_label: "New password", mb_new_app_password_label: "New app password",
      password_saved: "Password saved.", password_saved_active: "Password saved. The mailbox is active again.",
      remove_title: "Remove mailbox?",
      remove_text: "This deletes {address} and all its data here: mail, triage results, actions, delegations, the rules of this mailbox and its history. Digests that were sent keep no text. This cannot be undone. Then change the mailbox password in your provider's settings: the assistant knew it.",
      remove_confirm_label: "Type the address to confirm", remove_submit: "Remove mailbox",
      removed_toast: "Mailbox removed. Change its password in your mail provider's settings now.",
      tg_title: "Telegram", tg_intro: "Digests, urgent notices and approvals come in Telegram.",
      tg_link: "Link Telegram", tg_linked: "Linked.", tg_linked_since: "Linked since {date}.",
      tg_open: "Open Telegram", tg_copy: "Copy", tg_copied: "Link copied.", tg_link_label: "Link",
      tg_valid_until: "The link works once, for 15 minutes (until {time}).",
      tg_expired: "The link has expired.", tg_new_link: "Make a new link",
      tg_off: "Telegram is off on this server.", tg_unreachable: "Telegram did not answer. Try again in a minute.",
      tg_unlink: "Unlink", tg_unlink_title: "Unlink Telegram?",
      tg_unlink_text: "Digests, notices and approvals stop until you link again.", tg_unlinked_toast: "Telegram unlinked.",
      ob_mailbox_title: "Connect a mailbox", ob_mailbox_open: "Connect the mailbox the assistant should read.",
      ob_mailbox_done_one: "1 mailbox connected.", ob_mailbox_done_many: "{count} mailboxes connected.", ob_manage: "Manage",
      ob_mailbox_assistant: "The owner connects the mailbox.",
      ob_telegram_title: "Link Telegram",
      ob_mode_title: "Choose the mode",
      ob_mode_open: "The assistant starts in shadow mode: it changes nothing and reports what it would do. Switch a mailbox to assist mode in Settings when the reports look right.",
      ob_keep_shadow: "Keep shadow mode for now", ob_open_settings: "Open Settings", ob_mode_done: "Mode chosen.",
      ob_mode_assistant: "The owner chooses the mode.",
      ob_rules_title: "Add sender rules (optional)", ob_rules_text: "VIP, whitelist and blocklist senders. You can do this later.",
      ob_rules_one: "1 rule", ob_rules_many: "{count} rules", ob_open_rules: "Open Rules",
      ob_all_set: "All set. Activity is your start page now.", ob_go_activity: "Go to Activity",
      ob_item_done: "Done", ob_item_open: "Not done",
      ```

    - `StatusBadge`: `active` → the default badge, `paused` → `secondary`, `auth_error` → `destructive`; the text from `status_*`.
    - `ScopeBadges`: three `Badge`s (`outline`) with `badge_<scope>_<state>` (the text from `badgeKey`: triage and actions have no `self` key and send has no `synthetic` key; such a pair falls back to the `off` key); then one `<p className="text-xs text-muted-foreground">` per key of `reasonKeys`: `env_off` → `reason_<scope>_env_off`, `other_mailbox` → `reason_other_mailbox`, `synthetic_only` → `reason_synthetic_only`, `test_addresses_only` → `reason_test_addresses_only`, `test_mailbox_only` → no line; duplicates removed.
    - `TelegramLink` (B9, B15, questions 9 and 12): `useResource(() => api("/api/channels/telegram", telegramStateSchema), { pollMs: link ? 5_000 : 30_000 })` where `link` is the state of the last `POST /link` answer (`{ url, expiresAt } | null`). `now` comes from `useNow()` (below), never from `Date.now()` during render (a `react-compiler` purity error; cold review finding 21). States: loading → a skeleton line; `available === false` and not linked → `tg_off` and no button; `available` with `botUsername === null` and not linked → `tg_unreachable` with a `retry` button that calls `reload()` (an outage is not a setting; finding 9); linked → `tg_linked_since` (date by `formatClock(linkedAt, timeZone, now)`), an "Unlink" button that opens a `Dialog` (`tg_unlink_title`, `tg_unlink_text`, `cancel`, `tg_unlink`) → `DELETE` → toast `tg_unlinked_toast`, `reload()`, `onChange?.()`; not linked without a link → `tg_intro` and `tg_link`; with a link → an `<a href={url} target="_blank" rel="noopener noreferrer">` styled as a button with `tg_open`, a read-only `Input` (label `tg_link_label`) holding the URL, a `tg_copy` button (`navigator.clipboard.writeText(url)` → toast `tg_copied`; a refused clipboard → no toast, the field stays selectable), and `tg_valid_until` with `formatClock(expiresAt, timeZone, now)`; when `now >= expiresAt` → `tg_expired` and `tg_new_link`. Only the change "a link is open and a poll answer says `linked: true`" clears the link state and calls `onChange?.()` once (an effect on `[data?.linked]` that checks `link !== null`; never on every poll: cold review finding 20); the onboarding page then reloads `/api/me`. `POST` errors: 409 `telegram_off` → `tg_off`; 502 `telegram_unreachable` → `tg_unreachable` as a toast.
    - `lib/use-now.ts`: `useNow(intervalMs = 30_000): Date` = `useState(() => new Date())` plus an effect with `setInterval(() => setNow(new Date()), intervalMs)` and its cleanup. Every component that formats a time or checks an expiry takes `now` from it (stages 11–13).
    - `errorText`: `ApiError` codes `mail_login_failed`, `mail_unreachable`, `mailbox_exists`, `host_not_allowed`, `wrong_status`, `owner_only`, `telegram_off`, `telegram_unreachable` → their keys; anything else → `error_generic`.
    - No literal user text in these components (the lint rule enforces it from this step on); the URL and the address are data, not literals.

  - Test: `errors.test.ts` (each mapped code and one unknown code); `scope-text.test.ts`: (1) all `on` → no reason; (2) triage and actions `other_mailbox` → one `reason_other_mailbox` line; (3) the three `env_off` → three different keys in the order triage, actions, send; (4) `send` `self` → `badgeKey` `badge_send_self` and the reason `reason_test_addresses_only`; (5) `badgeKey("triage", "self")` (a state the server never sends for triage) → `badge_triage_off` (the safe fallback).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && cd apps/web && bun run build`.
  - Done when: the tests pass; the build passes; `bun run lint` passes with the wider `jsx-no-literals` scope.
  - Out of scope: the pages (stages 11–13).
