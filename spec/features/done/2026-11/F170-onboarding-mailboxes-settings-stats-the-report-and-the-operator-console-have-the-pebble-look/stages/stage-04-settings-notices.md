# F170 stage 04 — Settings: notices and organization cards

Needs F166 stage 02: `ui:sheet`, the a11y `schemes` option. Needs F166 stage 04: `Button` `soft` and `destructive-soft`, 48 px fields. Needs F166 stage 05: `Dialog`, `Table`, `Skeleton`. Needs F166 stage 08: `web:build:dev`, `patterns.spec.ts` (the Proof). Needs F166 stage 10: `SectionCard`, `RowList`, `Row`, `FactBox`. May run next to 01, 02, 03, 05, 06, 07, 08, 09, 10 (it does not touch `SettingsPage.tsx`).

Part of [`../plan.md`](../plan.md). Decisions: D1, D4, D5.

Owns: `DigestTimesCard.tsx`, `NotifyCards.tsx`, `NoticeRoutesCard.tsx`, `PushDevicesCard.tsx`, `TimezoneCard.tsx`, `TelegramLockCard.tsx` (in `components/settings/`), `notify.spec.ts`, `push-devices.spec.ts`, `telegram-detail.spec.ts` (stage 01 changes their `set_section_general` waits; keep those lines).

## Step 1 — Digests and notices group

- **Decisions:** each card is a `SectionCard` with its `data-card` unchanged: `digest` (icon `Clock`), `quiet-hours` (`MoonStar`), `report-channel` (`Send`), `notice-routes` (`Route`), `push-devices` (`Smartphone`).
  - Digest times: each time is a chip-like `Badge` with its remove button (the button name carries the time); "Add a time" is a `soft` icon button with an accessible name. Save stays where it is today.
  - Quiet hours and report channel: `Row`s with the time inputs and selects at the end (`htmlFor` = today's ids `quiet-start`, `quiet-end`, `report-channel`, `report-mailbox`).
  - Notice routes: three `Row`s (Urgent mail, Approvals, Updates), each with its select; "(default)" marks stay; "Use the defaults" is a `ghost` button.
  - Push devices: one `Row` per device (label, added date and last notice as the `hint`, "This device" as a `Badge`, Remove at the end, its confirm unchanged). The iOS install text and "not set up on this server" are `FactBox`es. "Turn on notices on this device" is the `default` button.
- **Edge cases:** each card keeps its flag and its show rule (`user_quiet_hours`, `report_mail`, `web_push`); with all flags off the group holds only the digest card. A member with no Telegram and no device keeps the hint. A read-only organization has no write button, as today.
- **Test:** (1) e2e `notify.spec.ts` and `push-devices.spec.ts` pass on both projects with their a11y scans. (2) Render test: `DigestTimesCard` with times `08:00` and `18:00` has two remove buttons named with those times.

## Step 2 — Organization group

- **Decisions:** `TimezoneCard` (`timezone`, icon `Globe`): the search field and the select as two labelled `Row`s; ids `timezone-search` and `timezone` stay. `TelegramLockCard` (`telegram-lock`, icon `Lock`): one `Row` with the switch (`htmlFor="tg-lock"`); a non-owner sees the state as text, no switch.
- **Test:** (3) e2e `telegram-detail.spec.ts` passes on both projects. (4) Render test: `TelegramLockCard` with `isOwnerRole: false` has no switch and shows the state text.

## Step 3 — Docs

Update the notices part of `docs/capabilities/web-panel.md` (rules 9, 14, 16, 17: the look only) and `apps/docs` how-to `digest-times` (English and Polish) if a button name changed.

## Out of scope

The order of the groups (stage 01). The Telegram link block (`components/telegram/`, stage 07). Any change of the notify API or of the route defaults.

## Done when

The sheet rows `settings` and `settings-trial`, and the pictures of the flag cards that `notify.spec.ts` and `push-devices.spec.ts` save under `<UI_SHEET_DIR>/f170-04/` (D7), match the mockup's "Digests and notices" card; the Proof of `../plan.md` with `notify.spec.ts push-devices.spec.ts telegram-detail.spec.ts settings.spec.ts` prints `PROOF_OK`.
