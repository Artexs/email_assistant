# F168 stage 06 — Activity frame: filter chips, day groups, empty states

Needs F166 stage 06: `FilterChips`. Needs F166 stage 09: `AppShell` `lead`. Needs F166 stage 10: `EmptyState`. May run next to 01, 02, 03, 04, 05, 08.

Part of [`../plan.md`](../plan.md): P10, P11, P12. This stage fixes the frame of the Activity page; stage 07 restyles the rows inside it.

## Step 1 — Head and filters

- **Files:** `islands/ActivityPage.tsx`, `components/activity/ActivityFilterBar.tsx`, `i18n/texts/en-activity.ts`, `pl-activity.ts`.
- **Decisions:**
  - Title and nav name stay (PB-4; the mockup's "What I did" is first-person past tense, PB-8). The island passes `lead`: one line that says each change shows its reason and Undo works for `{days}` days, with `days` from `UNDO_WINDOW_MS` of `@ea/core` (7). No `action`.
  - Range: `FilterChips` with `single`, the four values of `activityRanges`, labelled as today. "Only not rated": a `FilterChips` of one option (a toggle). Category and mailbox stay `Select`s (P10); the mailbox select shows only with 2 or more mailboxes, as today.
  - The "updated at" line and Refresh stay at the end of the filter row; below `lg` they wrap under the chips.
  - `ActivityFilters`, `filtersFromSearch`, `filtersToSearch` and the URL do not change (DB-1).
- **Test:** (1) the existing `lib/activity-filters.test.ts` passes unchanged. (2) e2e: a tap on the `30d` chip puts `range=30d` in the URL and reloads the list; a tap on "Only not rated" puts `notRated=1` in the URL.

## Step 2 — Day groups

- **Files:** `lib/activity-days.ts` (new) and its test, `components/activity/ActivityList.tsx`.
- **Interface (stage 07 keeps it):** `dayGroups(items: readonly ActivityItem[], timeZone: string, now: Date): { day: string; label: "today" | "yesterday" | "date"; items: ActivityItem[] }[]`. `day` is the local date `YYYY-MM-DD` of `receivedAt` (through `localDateTime` of `@ea/core/web`). The order of the items does not change; a group starts where the day changes. "Yesterday" is the calendar day before the local date of `now`, never `now` − 24 h.
- **Markup:** each group is a `section` with an `h2` (today, yesterday, or the weekday and date in the page language), then a `ul` of the rows. Each row stays an `li[data-email-id]` that renders `ActivityRow` (stage 07 changes its inside). The skeleton, the load-more button and the polled merge stay; a group continues across a load-more page (no second heading for the same day).
- **Tests** (time zone `Europe/Warsaw`):
  3. `now = 2026-03-29T10:00:00Z`; items at `2026-03-28T23:30:00Z` and `2026-03-28T22:30:00Z` → two groups: `2026-03-29` `today` (00:30 local) and `2026-03-28` `yesterday` (23:30 local).
  4. Items on `2026-11-20`, `2026-11-20`, `2026-11-18` (local), `now` on `2026-11-24` → two `date` groups, sizes 2 and 1.
  5. An empty list → `[]`.

## Step 3 — Empty states

- **Files:** `components/activity/ActivityList.tsx`, the island.
- **Decisions (P12):** one `EmptyState` per case, in this order of checks:
  - (a) `me.mailboxCount === 0`: "Open Mailboxes" to `/mailboxes` (today's keys `act_no_mailbox`, `act_open_mailboxes`).
  - (b) the filters are `DEFAULT_FILTERS` except the range: "Show 90 days" (sets the range to `90d`) while the range is shorter; no button at `90d`.
  - (c) any other filter set: "Clear filters" (back to `DEFAULT_FILTERS`).
  - The load error and the refresh error keep their texts and Retry.
- **Test:** (6) e2e: with a category filter that matches nothing, the page shows the (c) text and "Clear filters" empties the URL query.

## Spec, docs

`e2e/tests/activity.spec.ts`: change the filter locators (chips in place of the range select and the switch). The tests of rows and actions stay for stage 07. `docs/capabilities/web-panel.md`: the Activity rules. User docs: `how-to/correct-a-category.mdx` and `undo-a-move.mdx` (and `pl/`) where they name the filter controls.

## Out of scope

The row, its actions, the panel and the picker (stage 07). The emoji keys (stage 07).

## Done when

- Tests 1–6 pass; the contact sheet pictures of `activity` read next to `05-activity-*`.
- Proof of `../plan.md` with the specs `activity.spec.ts polish.spec.ts` prints `PROOF_OK`.
