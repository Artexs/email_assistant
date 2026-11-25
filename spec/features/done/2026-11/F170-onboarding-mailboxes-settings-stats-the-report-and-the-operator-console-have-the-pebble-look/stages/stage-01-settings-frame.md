# F170 stage 01 — Settings frame: sections, section links, page head, `useModeChange`

Needs F166 stage 02: `ui:sheet`, the a11y `schemes` option. Needs F166 stage 04: `Button` `soft` and `destructive-soft`, 48 px fields. Needs F166 stage 05: `Dialog`, `Table`, `Skeleton`. Needs F166 stage 08: `web:build:dev`, `patterns.spec.ts` (the Proof). Needs F166 stage 09: `AppShell` `lead`. Needs F166 stage 10: `EmptyState`. May run next to 03, 04, 05, 07, 08, 09, 10. Stages 02 and 06 need this stage's `useModeChange`.

Part of [`../plan.md`](../plan.md). Decisions: P5, P9, D1, D2, D3, D5, D6.

Owns: `apps/web/src/islands/SettingsPage.tsx`, `apps/web/src/lib/settings-groups.ts`, `apps/web/src/components/settings/SettingsNav.tsx`, `apps/web/src/lib/use-mode-change.ts`, the logic part of `ModeCard.tsx` (no class change there: stage 02 restyles it), `settings.spec.ts`.

## Step 1 — `useModeChange`

- **Interface (plan D2):** `useModeChange(mailboxId, { onChanged, onFail }) → { pending, change(mode, keepSwitches) }` in `apps/web/src/lib/use-mode-change.ts`.
- **Decisions:** move the mode call of `ModeCard` into the hook with no change of behaviour: the same `patchSettings(mailboxId, "/mode", { mode, keepSwitches })`, the same toast keys (`mode_assist_toast`, `mode_shadow_toast`, chosen by the caller in `onChanged`). The hook calls `onFail(error)` on every failure; `ModeCard`'s `onFail` keeps today's paths (a 404 calls its `onMissing` prop). `ModeCard` closes its `AssistDialog` in `onChanged`. `pending` is true from the call until it ends, also on failure.
- **Test:** (1) a render test with a fake `api`: `change("assist", true)` sends `PATCH /api/settings/m1/mode` with the body `{ "mode": "assist", "keepSwitches": true }` and calls `onChanged` once with the answer and `"assist"`. (2) A `404` answer calls `onFail` once and not `onChanged`; `pending` is false after it.

## Step 2 — Groups and the section links

- **Interfaces:**
  - `type SettingsGroupId = "mailbox" | "notices" | "organization" | "account"`; `SETTINGS_GROUPS: readonly { id: SettingsGroupId; label: TextKey }[]` in that order (`lib/settings-groups.ts`).
  - `SettingsGroup({ id: SettingsGroupId; children: ReactNode })`: `<section id={id} aria-labelledby={`${id}-label`}>` with the label as a small muted `<p id>` (not a heading; the cards are the `h2`), and a scroll margin for the phone top bar.
  - `SettingsNav()`: `<nav aria-label={t("set_nav_label")}>` with one `<a href="#<id>">` per group, styled as `Button` `soft` `sm` links (links, not `FilterChips`).
- **Decisions:** P5. Group contents: mailbox = the selector, the status and scope badges and the six mailbox cards (or the no-mailbox state); notices = digest times, the notify cards, push devices; organization = time zone, Telegram lock; account = `AccountCard`. The old heading `set_section_general` and its key go (DB-10). This stage also moves its readers: the waits in `push-devices.spec.ts` and `telegram-detail.spec.ts` (only those lines; stage 04 owns the files) wait for the notices group region, and `apps/docs` `reference/settings.mdx` names the four groups. The "owner only" line shows once, under the page head. Layout: one column of cards (`max-w-3xl`); from `lg` the nav is a sticky column on the left; below `lg` it wraps above the groups (DB-7: no sideways scroll at 320 px).
- **Edge cases:**
  - A load with `#notices` (any group id): after the first load the page scrolls to that group once, not on a later poll. An unknown hash does nothing.
  - The mailbox choice keeps the hash (today's `replaceState` keeps it).
  - `?two_factor=required` still scrolls to `#two-factor`; when both are given, `two_factor` wins.
  - No mailbox: the mailbox group shows an `EmptyState` (icon `Inbox`, `set_no_mailbox`, button "Open Mailboxes" to `/mailboxes`), `headingLevel` 2; the other three groups still show.
  - Every group shows with all flags off (digest times, time zone, account have no flag).
- **Page head:** `lead="set_lead"`: "How and when the assistant talks to you, and what it may do."
- **Test:** (3) unit: `SETTINGS_GROUPS` ids are unique, and no id equals an `id` used by a settings component today (scan `components/settings/` for them). (4) e2e `settings.spec.ts`: the nav has 4 links; a tap on "Account and security" puts `#account` in the viewport (`toBeInViewport`); `/settings#notices` opened cold puts `#notices` in the viewport after load. (5) e2e: exactly one `h1`, and every `data-card` of today that the seed shows is still found. (6) the a11y scan of `/settings` passes.

## Out of scope

The look inside each card (stages 02–05). Merging cards. A sticky phone nav (P5).

## Done when

The sheet rows `settings` and `settings-trial` match the mockup's frame; the Proof of `../plan.md` with `settings.spec.ts two-factor.spec.ts account.spec.ts push-devices.spec.ts telegram-detail.spec.ts` prints `PROOF_OK`.
