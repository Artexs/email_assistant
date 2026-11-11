# s5b-web-mailboxes-onboarding — Stage 14

Part of [`../s5b-web-mailboxes-onboarding.md`](../s5b-web-mailboxes-onboarding.md). Read that file's "Done when", "Owns", S1–S12, "Facts checked", B1–B17, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 14 — Playwright: the fake Telegram server, `mailboxes.spec.ts`, `onboarding.spec.ts`

Needs user step 1 (GreenMail runs: `newgrp docker` + `bun run dev:up`). Runs in the worktree by the main session (the review copies run only lint, typecheck and unit tests).

- [x] **14.1 The e2e environment with the fake Telegram (B16, D19)**
  - Goal: `bun run test:e2e` starts the fake Telegram next to the app server, and the app server can connect GreenMail and link Telegram.
  - Files: change `apps/web/e2e/env.ts`, `apps/web/e2e/playwright.config.ts`, `apps/web/e2e/helpers.ts`, `apps/web/e2e/tests/auth.spec.ts` (line ~55: it expects `en.placeholder_text` on `/onboarding`, which stage 13 replaced; assert the checklist title `en.ob_mailbox_title` instead: cold review finding 1).
  - Interfaces:

    ```ts
    // env.ts
    export const E2E_TELEGRAM_PORT = 8092;
    export const E2E_TELEGRAM_URL = `http://127.0.0.1:${E2E_TELEGRAM_PORT}`;
    // e2eEnv() adds: WEB_MAIL_ALLOW_LOCAL: "true", TELEGRAM_BOT_TOKEN: FAKE_TOKEN, TELEGRAM_API_ROOT: E2E_TELEGRAM_URL
    //   (FAKE_TOKEN from "../../../tools/fake-telegram/src/state": a test value, not a secret)
    export const GREENMAIL = {
      host: process.env.TEST_IMAP_HOST ?? "127.0.0.1",
      imapPort: 3143,
      smtpPort: 3025,
    } as const;
    // helpers.ts
    export function mailboxAddress(project: string): string; // `e2e-${project}@e2e.test`
    // Removes what a spec made, through the API with the page's cookies and the Origin header: unlink, then every mailbox.
    export async function cleanUpOrg(page: Page): Promise<void>;
    ```

  - Decisions:
    - `webServer` becomes an array, the fake first: `{ command: "bun tools/fake-telegram/src/cli.ts serve --port 8092", cwd: repoRoot, url: `${E2E_TELEGRAM_URL}/\_fake/health`, reuseExistingServer: false, timeout: 30_000, stdout: "pipe", stderr: "pipe" }`, then the existing app server entry. Port 8092, not 8090: a developer's own fake on 8090 stays untouched.
    - Not verified at plan time: whether Playwright starts the entries one after the other. It does not matter for correctness: the bot's polling loop retries until the fake answers (`channels/telegram/polling.ts`), and the link route's `getMe` is called only when a test clicks. If the first run shows `telegram: getMe failed` lines at start, note it in the stage log.
    - `cleanUpOrg`: `page.request.delete("/api/channels/telegram/link", { headers: { origin: E2E_BASE_URL } })`, then `GET /api/mailboxes` and a `DELETE /api/mailboxes/<id>` with `{ confirmAddress: <address> }` for each; errors are ignored (a cleanup must not hide the real failure). Every S5b spec calls it in `test.afterEach`.
    - The S5a `auth.spec.ts` keeps every case (only the placeholder assertion changes) and must still pass: after the S5b specs the organization has no mailbox and no chat link, so `/` still lands on `/onboarding` (the `onboarding.mode_kept` row stays; `done` also needs a mailbox: B16).
  - Test: `bun run test:e2e` with only the S5a spec → 12 passed (the environment change alone breaks nothing).
  - Check: `bun run lint && bun run typecheck && bun run web:build && bun run test:e2e`.
  - Done when: 12 passed; the fake Telegram process ends with the run (no listener left on 8092: `ss -ltnp | grep 8092` is empty after the run).
  - Out of scope: the specs (14.2).

- [x] **14.2 `mailboxes.spec.ts` and `onboarding.spec.ts` (the segment's done-when)**
  - Goal: the S5 done-when "set up a mailbox and link Telegram without the CLI" runs in both projects.
  - Files: create `apps/web/e2e/tests/mailboxes.spec.ts`, `apps/web/e2e/tests/onboarding.spec.ts`.
  - Decisions:
    - Each spec: `test.describe.configure({ mode: "serial" })`; a `beforeEach` sets its own `x-forwarded-for` block (mailboxes: mobile `40`, desktop `140`; onboarding: mobile `70`, desktop `170`; the S5a blocks are `10` and `110`), signs in as the seed owner (`readSeed().owner`), and collects CSP errors with `cspErrors(page)`; an `afterEach` runs `cleanUpOrg(page)` and asserts the CSP list is empty.
    - Selectors use roles and the `en` texts (`page.getByRole("button", { name: en.mb_pause })`), never CSS classes. The `Select` of the provider is a Radix select: open it with its label, pick the option by role `option`.
    - The Telegram chat id per project: mobile `5550101`, desktop `5550102` (`createFakeTelegramClient(E2E_TELEGRAM_URL).send(`/start ${token}`, { chatId })`), so the two projects never share a chat.
  - Test (both projects):
    1. `mailboxes.spec.ts` "connect, pause, resume, change the password, remove": `/mailboxes` shows `mb_empty`; `mb_connect` → the dialog; provider `preset_other`; the address `mailboxAddress(project)`, any password, `GREENMAIL` hosts and ports; `connect_submit` → toast `connected_toast`; the card shows the address, `status_active`, the badges `badge_triage_off`, `badge_actions_synthetic`, `badge_send_off` (the e2e env: triage off, actions synthetic, sends off); `mb_pause` → toast `mb_paused_toast` and `status_paused`; `mb_resume` → `status_active`; `mb_more` → `mb_change_password` → a new password → `save` → toast `password_saved`; `mb_more` → `mb_remove` → `remove_submit` disabled; type the address in upper case → enabled → click → toast `removed_toast`; `mb_empty` again.
    2. `mailboxes.spec.ts` "a preset sends no host fields": `page.route("**/api/mailboxes", …)` answers a `POST` with 422 `{ "error": "mail_login_failed" }` and keeps the request body (a `GET` passes through with `route.continue()`); type `anna@gmail.com` → the provider shows `preset_gmail` and the password label is `mb_app_password_label`; `connect_submit` → the inline `err_mail_login_failed`; the kept body has `preset: "gmail"`, `secretKind: "app_password"` and none of the four host keys.
    3. `mailboxes.spec.ts` "the connect link opens the dialog": `/mailboxes?connect=1` → the dialog title `connect_title` is visible; the URL no longer holds `connect=1`.
    4. `onboarding.spec.ts` "from open to done and back" (`test.setTimeout(60_000)`, finding 24): read `GET /api/me` first (`page.request`); `/` → `/onboarding`; with `onboarding.mode` false four items are open (`ob_item_open` four times), with `true` (the other project kept the mode before; the audit row cannot be deleted) three are open and item 3 shows `ob_mode_done` (B16; cold review finding 2); the item link `mb_connect` → `/mailboxes` with the dialog open → connect GreenMail as in test 1 → back to `/onboarding` → `ob_mailbox_done_one`; `tg_link` → the URL field matches `^https://t\.me/fake_ea_bot\?start=[A-Za-z0-9_-]{43}$`; send `/start <token>` from the fake client → `tg_linked_since` within 10 s (the 5 s poll); only when the mode item was open: `ob_keep_shadow` → `ob_mode_done`; then `ob_all_set`; the menu has no `nav_onboarding` item (desktop sidebar; on the phone inside the menu sheet); `/` → `/activity`; then `tg_unlink` → the dialog → `tg_unlink` → toast `tg_unlinked_toast`; `/` → `/onboarding` again (the `afterEach` removes the mailbox).
    5. `onboarding.spec.ts` "the bot is linked from the page on a phone and a desktop alike": covered by test 4 in both projects (no extra test; S12 says one UI for both).
  - Check: `bun run lint && bun run typecheck && bun run web:build && bun run test:e2e` twice in a row (the second run proves the cleanup and the seed reset).
  - Done when: both runs pass with every test of `auth.spec.ts`, `mailboxes.spec.ts` and `onboarding.spec.ts` in both projects (expected 2 × (6 + 3 + 1) = 20 passed); the log line of the run count is in the stage log.
  - Out of scope: CI changes (the `e2e` job already has GreenMail and Bun; stage 15 checks the CI run).
