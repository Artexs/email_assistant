# F170 stage 06 — Onboarding: steps, progress ring, mode cards

Needs stage 01: `useModeChange` (`apps/web/src/lib/use-mode-change.ts`). Needs F166 stage 06: `ProgressRing`. Needs F166 stage 09: `AppShell` `lead`. Needs F166 stage 10: `SectionCard`, `FactBox`. May run next to 02, 03, 04, 05, 07, 08, 09, 10.

Part of [`../plan.md`](../plan.md). Decisions: P1, P9, D1, D5, D6; questions.md item 1.

Owns: `apps/web/src/islands/OnboardingPage.tsx`, `components/onboarding/`, `apps/web/src/lib/onboarding-view.ts` (new), `onboarding.spec.ts`, the `ob_*` keys (in `texts/*-mailboxes.ts`, next to the other `ob_*` keys). It uses `TelegramLink` (stage 07) and `AssistDialog` (stage 02) unchanged.

## Step 1 — Progress

- **Interface:** `onboardingProgress(onboarding: Onboarding): { done: number; total: number; current: StepKey | null }` in `lib/onboarding-view.ts`, `StepKey = "mailbox" | "channel" | "report" | "telegram" | "mode"`.
- **Decisions:** the required steps follow the `trust` field: trust on → mailbox, channel, report; trust off → mailbox, telegram, mode. A step whose state is `null` (Telegram off on this server: `telegramAvailable: false`) is left out of both counts. The rules step is optional and never counts. `current` is the first required step that is not done; `null` when all are done.
- **Look (mockup screen `onboarding`, shot `07-*`):** from `lg` a side card with the `ProgressRing` (`value` done, `max` total, label "2 of 3 steps done", the text `2/3` inside) and the step list to its right; below `lg` the ring card is above the list, `sm` size. Each step is a card: a number circle (a check when done; `ob_item_done` / `ob_item_open` stay as screen-reader text), the title as `h2`, its text and its one button. The `current` step has the primary outline. "All set" (`ob_all_set`, `ob_go_activity`) is a `FactBox` above the list.
- **Page head:** `lead="ob_lead"`: "A few short steps. You can change everything later." No action.
- **Test (unit, one `test.each` table):** (1) trust off, `{ mailbox: true, telegram: false, telegramAvailable: true, mode: false }` → `{ done: 1, total: 3, current: "telegram" }`. (2) The same with `telegramAvailable: false` → `{ done: 1, total: 2, current: "mode" }`. (3) trust on, `{ mailbox: true, channel: true, report: false }` → `{ done: 2, total: 3, current: "report" }`. (4) All required done, `rules: 0` → `current: null`, `done` = `total`.

## Step 2 — Mode cards

- **Decisions (P1):** shown in the mode step (trust off) while it is open, for every role. Two cards side by side from `sm`, stacked below: Shadow (icon `Eye`, `mode_shadow`, `mode_shadow_text`) and Assist (icon `Sparkles`, `mode_assist`, `mode_assist_text`; the Settings keys, not new copies). A card is a `div`, not a button.
  - Shadow holds `ob_keep_shadow` (today's `POST /api/onboarding/keep-mode`, today's error toast).
  - Assist holds `ob_use_assist` ("Use assist…"). Its action depends on the mailbox list (`GET /api/mailboxes`, loaded only while the mode step is open): one mailbox → on tap, load `GET /api/settings/:id` (`settingsViewSchema`), then open `AssistDialog` with that mailbox and its `toolSwitches`; a choice calls `useModeChange(id).change("assist", keepSwitches)`; on success toast `mode_assist_toast`, close the dialog, reload `me`. Two or more mailboxes → a link to `/settings`. No mailbox → no button, the line `ob_mode_need_mailbox` ("Connect a mailbox first.").
  - A member, or an owner of a read-only organization (`canWrite` false), sees both cards with no button and `ob_mode_assistant`.
  - "Open Settings" (`ob_open_settings`) stays below the cards.
- **Edge cases:** a failed settings load shows the error toast and no dialog. The Assist button is disabled while the load or the mode call runs. A 404 (mailbox removed in another tab) toasts the error and reloads the list.
- **Test:** (5) e2e `onboarding.spec.ts`, today's flow still passes. (6) e2e: with one connected mailbox, a tap on "Use assist…" opens the dialog with the title `assist_title`; Cancel closes it, the step stays open, and a `page.on("request")` counter saw 0 requests to `/mode`. (7) A11y scan of `/onboarding` with the mode cards, both projects.

## Out of scope

The Telegram link block (stage 07). The trust-path steps' texts. Any onboarding API.

## Done when

The pictures of `onboarding` (main owner, and the trust seed state) match shot `07-*`; the Proof of `../plan.md` with `onboarding.spec.ts report.spec.ts` prints `PROOF_OK`.
