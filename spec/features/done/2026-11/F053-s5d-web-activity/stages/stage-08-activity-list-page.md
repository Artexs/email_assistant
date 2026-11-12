# s5d-web-activity — Stage 8

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", A1–A10, "Facts checked", B1–B15, "Rules for every step", "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first.

## Stage 8 — Activity page part 1: filters, list, rows, load more, refresh, polling, states

Two steps. The page shows the list; the panel and the buttons come in stage 9. Patterns: `islands/MailboxesPage.tsx` (the "Updated" line, Refresh, the states), `islands/SettingsPage.tsx` (the URL query with `history.replaceState`), `components/settings/MailboxSelector.tsx` (a shadcn `Select` with a label).

- [x] **8.1 The island, the filters and the URL (A2, A3, B10, B13)**
  - Goal: the Activity page has the filter bar, the "Updated" line and Refresh, and keeps the filters in the URL.
  - Files: change `apps/web/src/islands/ActivityPage.tsx`; create `apps/web/src/components/activity/ActivityFilterBar.tsx`.
  - Interfaces:

    ```tsx
    // components/activity/ActivityFilterBar.tsx (not `ActivityFilters`: that is the type of lib/activity-filters.ts, TS2440)
    export interface ActivityFilterBarProps {
      filters: ActivityFilters;
      mailboxes: readonly { id: string; address: string }[]; // the Select shows only with 2 or more
      onChange(next: ActivityFilters): void;
    }
    export function ActivityFilterBar(props: ActivityFilterBarProps): JSX.Element;
    ```

  - Decisions:
    - `ActivityPage` renders `<AppShell active="activity" title="title_activity"><Activity /></AppShell>`. `AppShell` renders its children only after `/api/me` loaded, so `Activity` runs only in the browser: it may read `location.search` in a `useState` initializer (`useState(() => filtersFromSearch(location.search))`). Never read `location` or `window` at module level or in `ActivityPage` itself (the static build renders it).
    - `Activity`: `useMe()` gives `me.organization.timezone`, `me.mailboxCount`; the mailbox list comes from `useResource(() => api("/api/mailboxes", mailboxListSchema))`. The effective filters are derived in render (not stored; S5c lesson 2): a `filters.mailboxId` that is not in the loaded mailbox list becomes `null`. While the URL names a mailbox and the mailbox list has not loaded yet, the island renders the list skeleton and not `ActivityList`, so no request goes out with a stale id and no "No mail in this range." flashes (cold review finding 17). With no mailbox in the URL, `ActivityList` renders at once.
    - `onChange(next)`: `setFilters(next)` and ``history.replaceState(null, "", `${location.pathname}${filtersToSearch(next)}${location.hash}`)``.
    - `ActivityFilterBar`: three labelled shadcn `Select`s (`act_filter_mailbox` with `act_all_mailboxes` + the addresses, only with two or more mailboxes; `act_filter_category` with `act_all_categories`, `act_needs_action`, then the seven `act_tag_*` texts in the order of `categories`; `act_filter_range` with the four `act_range_*`) and a shadcn `Switch` with the label `act_not_rated`. Every control has a visible `Label` (`htmlFor`/`id`), U9. A Radix `Select` needs a non-empty item value: use `"all"` for "All mailboxes" and map it to `null`.
    - Layout: one row that wraps (`flex flex-wrap gap-2`); on the right the "Updated {time}" text (`updated_at` with `formatClock(lastLoad, timeZone, now)`, `useNow()`) and an outline `Button` `refresh`. The list area comes from 8.2.
  - Test: none (the pure parts have tests from stage 7; Playwright in stage 10).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run web:build`.
  - Done when: the checks pass; a filter change updates the URL (stage 10 checks it).
  - Out of scope: the rows (8.2).

- [x] **8.2 The list, the rows, load more, polling and the page states (A1, A8, B11, B13)**
  - Goal: the list shows the rows of the filters, polls the first page, loads older pages and shows the U4 states.
  - Files: create `apps/web/src/components/activity/ActivityList.tsx`, `ActivityRow.tsx`; change `islands/ActivityPage.tsx`.
  - Interfaces:

    ```tsx
    // components/activity/ActivityList.tsx
    export interface ActivityListProps {
      filters: ActivityFilters;
      timeZone: string;
      showMailbox: boolean; // two or more mailboxes
      mailboxAddress(id: string): string | null;
      hasMailbox: boolean; // me.mailboxCount > 0
      onLoaded(at: Date): void; // the page shows "Updated HH:MM"
      refreshSignal: number; // the page's Refresh button increments it
    }
    export function ActivityList(props: ActivityListProps): JSX.Element;

    // components/activity/ActivityRow.tsx
    export interface ActivityRowProps {
      item: ActivityItem;
      timeZone: string;
      now: Date;
      mailboxAddress: string | null; // null: not shown
    }
    export function ActivityRow(props: ActivityRowProps): JSX.Element;
    ```

  - Decisions:
    - The island renders `<ActivityList key={filtersToSearch(effective)} filters={effective} … />` (`effective` = the derived filters of 8.1): a filter change mounts a new list with a new hook (B11). Refresh: the island keeps `refreshSignal` state; `ActivityList` calls `refresh()` when it changes (a `useEffect` on the number, skipping the first render) — or the island passes a `ref`-free callback registration; choose the signal, it fits the react-compiler rules.
    - `ActivityList` uses `useActivityList((before) => activityQueryString(filters, new Date(), before), { onLoadMoreError: () => toast.error(t("error_generic")) })`; it calls `onLoaded(state.lastLoad)` when `lastLoad` changes (`useEffect` on `lastLoad`).
    - States: `status === "loading"` with no items → three `Skeleton` rows (`aria-busy="true"`); `status === "error"` → `act_load_error` and a `Button` `retry` (`refresh()`); `ready` with no items → `act_empty`, and when `hasMailbox` is false also `act_no_mailbox` with a link `act_open_mailboxes` to `/mailboxes`; items → `<ul>` of `ActivityRow` in `<li data-email-id={item.emailId}>`; `refreshError` → a muted line `act_refresh_error` with a `retry` link button above the list (the items stay). Under the list, while `nextBefore !== null`, an outline `Button` `act_load_more` (disabled while `loadingMore`); a load-more failure shows the toast through `onLoadMoreError`.
    - `ActivityRow` (A1): three lines. Line 1: `formatClock(new Date(item.receivedAt), timeZone, now)` `·` `senderText(item.from)` and, when `mailboxAddress` is not `null`, `·` the address. Line 2: `subjectText(item.subject)` (`truncate`). Line 3: `categoryTagText(item.category)` `confidenceText(item.confidence)` `·` `item.phrase`; then, when `item.delegation`, a `Badge` `delegationText(item.delegation)`; when `item.undoPending`, a `Badge` `act_undo_pending`. Mail-derived text only as text children. In this stage the row is a plain block; stage 9 makes the text a button and adds the buttons.
    - Sizes: one column at every width; rows separated by a border; the line 3 text `text-sm text-muted-foreground`; the list max width `max-w-3xl` (like Mailboxes).
  - Test: none new (stage 10 Playwright).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run web:build`. Hand check (optional, recommended): with the user-step-0 keys, `TELEGRAM_BOT_TOKEN= bun run dev` and `bun run web:dev`, sign in (`web:invite`), open `/activity`: the empty state shows; a filter change writes the URL; zero console errors. Never use the real dev bot.
  - Done when: the checks pass.
  - Out of scope: the panel, the buttons, the picker (stage 9).
