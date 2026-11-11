# s5b-web-mailboxes-onboarding — Stage 13

Part of [`../s5b-web-mailboxes-onboarding.md`](../s5b-web-mailboxes-onboarding.md). Read that file's "Done when", "Owns", S1–S12, "Facts checked", B1–B17, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 13 — Onboarding page

- [x] **13.1 The checklist (S11, S12, D15, P10)**
  - Goal: `/onboarding` shows the four items with their live state from `/api/me.onboarding`, lets the owner keep shadow mode, and links Telegram in place.
  - Files: change `apps/web/src/islands/OnboardingPage.tsx`; create `apps/web/src/components/onboarding/ChecklistItem.tsx`.
  - Interfaces:

    ```ts
    export function ChecklistItem(props: {
      title: TextKey;
      done: boolean;
      optional?: boolean;
      children: ReactNode;
    }): JSX.Element; // an <li> with a check or an empty circle icon (lucide CircleCheck / Circle, aria-hidden) and an sr-only ob_item_done / ob_item_open
    ```

  - Decisions:
    - The page reads `useMe()` (the shell's `/api/me`, 30 s polling); no extra request for the state. An ordered list (`<ol>`) of four `ChecklistItem`s; while `me` is `null` the shell's skeleton shows.
    - Item 1 `ob_mailbox_title`: done → `ob_mailbox_done_one` / `ob_mailbox_done_many` (count = `me.mailboxCount`) and a link `ob_manage` to `/mailboxes`; open → `ob_mailbox_open` and, for the owner, a link styled as a button `mb_connect` to `/mailboxes?connect=1`; the assistant sees `ob_mailbox_assistant`.
    - Item 2 `ob_telegram_title`: `<TelegramLink timeZone={me.organization.timezone} onChange={reload} />` (stage 10; it handles `tg_off`, `tg_unreachable`, the link step with the 5 s polling, and the linked state with Unlink). When `me.telegram.available` is false the item shows no check and no circle but `tg_off`, and it does not block `ob_all_set` (B2, cold review finding 8).
    - Item 3 `ob_mode_title`: done → `ob_mode_done`; open → `ob_mode_open`, for the owner a button `ob_keep_shadow` (`POST /api/onboarding/keep-mode`, `api(…, z.undefined(), { method: "POST" })` because the answer is 204; pending → disabled; success → `reload()`; an error → toast `t(errorText(error))`) and a link `ob_open_settings` to `/settings`; the assistant sees `ob_mode_assistant`.
    - Item 4 `ob_rules_title` (`optional`; the check shows when `rules > 0`, but the item never blocks `done`): `ob_rules_text`, `ob_rules_one` / `ob_rules_many` when `rules > 0`, a link `ob_open_rules` to `/rules`.
    - When `me.onboarding.done`: above the list a `Alert` with `ob_all_set` and a link `ob_go_activity` to `/activity`. The shell hides the menu item already (stage 9 rule).
    - Both widths: one column, `max-w-2xl`.
  - Test: no unit test (React; Playwright in stage 14). Hand check as in stage 12 (the server command of stage 12, with `TELEGRAM_API_ROOT` and `TELEGRAM_BOT_TOKEN` of the fake instead of the empty token): a fresh dev organization shows four open items; connect through the item link; with the fake Telegram (`bun run fake-tg serve` and the dev server started with `TELEGRAM_API_ROOT=http://127.0.0.1:8090 TELEGRAM_BOT_TOKEN=<the fake's printed default token>` on the command line) "Link Telegram" shows `https://t.me/fake_ea_bot?start=…`, `bun run fake-tg send "/start <token>"` flips the item within about 5 s; "Keep shadow mode for now" flips item 3; `ob_all_set` appears; `/` then redirects to `/activity`; unlink and remove the mailbox to leave the dev organization clean. Both widths; zero console or CSP errors.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && cd apps/web && bun run build`, then the hand check.
  - Done when: the build passes and the hand check passes.
  - Out of scope: Playwright (stage 14).
