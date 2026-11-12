# s5d-web-activity — Stage 7

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", A1–A10, "Facts checked", B1–B15, "Rules for every step", "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first.

## Stage 7 — Web foundations: strings, texts, filters, list state, API, media hook, lint scope

Three steps. Pure code with unit tests and two thin hooks; no page yet. The web imports core only through `@ea/core/web`.

- [x] **7.1 The S5d strings, `lib/activity-text.ts`, the unit-test scope (B2, B10, fact 14)**
  - Goal: every activity string is a key in `en.ts`, and a test ties the toast and category words to the Telegram source.
  - Files: change `apps/web/src/i18n/en.ts`, `package.json` (root, the `test:unit` script); create `apps/web/src/lib/activity-text.ts`, `activity-text.test.ts`.
  - Interfaces:

    ```ts
    // lib/activity-text.ts
    import type { ActivityItem, Category, FeedbackResult, UndoWebResult } from "@ea/core/web";
    export function categoryName(category: Category): string; // t(`act_cat_${category}`)
    export function categoryTagText(category: Category): string; // t(`act_tag_${category}`)
    export function confidenceText(confidence: number): string; // t("act_confidence", { value: Math.round(confidence * 100) })
    export function feedbackToast(kind: "right" | "pick", result: FeedbackResult, trueCategory: Category): string;
    export function undoToast(kind: UndoWebResult["kind"]): string;
    export function feedbackStateText(feedback: ActivityItem["feedback"]): string;
    export function senderText(from: string | null): string; // the address, or act_unknown_sender
    export function subjectText(subject: string | null): string; // the subject, or act_no_subject
    export function delegationText(delegation: NonNullable<ActivityItem["delegation"]>): string; // "Ola · Drafted"
    ```

  - Decisions:
    - New `en.ts` block `// activity (S5d)` with these keys and texts (English, ASD-STE style where the text is ours; the Telegram texts word for word):
      - Filters: `act_filter_mailbox` "Mailbox", `act_all_mailboxes` "All mailboxes", `act_filter_category` "Category", `act_all_categories` "All categories", `act_needs_action` "Needs my action", `act_filter_range` "Range", `act_range_24h` "Last 24 hours", `act_range_7d` "Last 7 days", `act_range_30d` "Last 30 days", `act_range_90d` "Last 90 days", `act_not_rated` "Only not rated".
      - Categories (Telegram names, fact 5): `act_cat_urgent` "Urgent", `act_cat_needs_reply` "Reply", `act_cat_delegation` "Delegate", `act_cat_info` "Info", `act_cat_notification` "Notification", `act_cat_spam` "Spam", `act_cat_unsure` "Unsure"; tags `act_tag_urgent` "🔴 Urgent", `act_tag_needs_reply` "✉️ Reply", `act_tag_delegation` "👥 Delegate", `act_tag_info` "ℹ️ Info", `act_tag_notification` "🔔 Notification", `act_tag_spam` "🚫 Spam", `act_tag_unsure` "❓ Unsure".
      - Row: `act_confidence` "{value} %", `act_no_subject` "(no subject)", `act_unknown_sender` "(unknown sender)", `act_btn_right` "Right: {category}", `act_btn_edit` "Change the category", `act_btn_undo` "Undo", `act_icon_right` "✅", `act_icon_edit` "✏️", `act_icon_undo` "↩️", `act_undo_pending` "Undo started", `act_load_more` "Load more".
      - States: `act_empty` "No mail in this range.", `act_no_mailbox` "Connect a mailbox first.", `act_open_mailboxes` "Open Mailboxes", `act_load_error` "Could not load the activity.", `act_refresh_error` "Could not refresh.".
      - Panel: `act_panel_title` "Mail details", `act_received` "Received {time}", `act_section_why` "Why", `act_section_did` "What the assistant did", `act_section_delegation` "Delegation", `act_section_feedback` "Your feedback", `act_no_reason` "No reason given.", `act_action_at` "{phrase} · {time}".
      - Feedback state: `act_fb_right` "You said: right", `act_fb_label` "You said: {category}", `act_fb_undo` "You said: wrong (Undo)", `act_fb_none` "Not rated yet".
      - Delegation: `act_dlg_drafted` "Drafted", `act_dlg_sent` "Sent", `act_dlg_answered` "Answered", `act_dlg_overdue` "Overdue", `act_dlg_done` "Done", `act_dlg_cancelled` "Cancelled", `act_dlg_line` "{name} · {status}", `act_dlg_due` "Due {time}", `act_dlg_someone` "A delegate".
      - Picker: `act_pick_title` "Pick the right category", `act_pick_ai` "{category} (AI)", `act_pick_help` "AI said: {category}".
      - Toasts (B2): `act_toast_right` "✅ Saved: {category} is right.", `act_toast_picked` "✏️ Saved: {category} (AI said {ai}).", `act_toast_same` "Already saved.", `undo_started` "↩️ Undo started: the mail goes back within a minute.", `undo_already` "Undo was already requested for this mail.", `undo_nothing` "Nothing to undo.", `undo_too_old` "Too old to undo (7 days).", `undo_held` "Undo is not possible now: mailbox changes are off or the mailbox is paused.".
    - `cat_help` (S5c key) ends with "Rate mails with ✅ or ✏️ in Telegram or on the Activity page." (the rest unchanged).
    - `feedbackToast`: `"right"` → `result.saved ? t("act_toast_right", { category: categoryName(trueCategory) }) : t("act_toast_same")`; `"pick"` → `result.saved ? t("act_toast_picked", { category: categoryName(trueCategory), ai: categoryName(result.aiCategory) }) : t("act_toast_same")`.
    - `feedbackStateText`: `null` → `act_fb_none`; `source === "undo"` and no true category → `act_fb_undo`; `verdict === "right"` → `act_fb_right`; else `act_fb_label` with `categoryName(trueCategory)` (a `wrong` row with no true category and another source → `act_fb_undo` too).
    - `delegationText`: ``t("act_dlg_line", { name: d.delegateName ?? t("act_dlg_someone"), status: t(`act_dlg_${d.status}`) })``.
    - Root `package.json`: `test:unit` gets `apps/web/src/i18n` after `apps/web/src/lib` (fact 14: `en.test.ts` exists since S5c and never ran in `test:unit`). No other script changes; `bun.lock` does not change.
  - Test (`activity-text.test.ts`, unit; imports `UNDO_TEXTS`, `rightAnswer`, `pickedText`, `categoryLabels`, `categoryTag`, `categories` from `@ea/core/web`):
    1. For each of the five undo kinds: `undoToast(kind)` = `UNDO_TEXTS[kind]`.
    2. For each of the seven categories: `categoryName(c)` = `categoryLabels[c].name`; `categoryTagText(c)` = `categoryTag(c)`.
    3. For each category `c` of `labelCategories`: `feedbackToast("right", { saved: true, verdict: "right", aiCategory: c }, c)` = `rightAnswer(true, c)`; with `saved: false` = `rightAnswer(false, c)`; for each pair `(true, ai)` of label categories: `feedbackToast("pick", { saved: true, verdict: "wrong", aiCategory: ai }, true)` = `pickedText(true, ai)`.
    4. `subjectText(null)` = `"(no subject)"`, `senderText(null)` = `"(unknown sender)"`; `confidenceText(0.934)` = `"93 %"`; `feedbackStateText` for `null`, a `right` row, a `wrong` row with `trueCategory: "info"` (→ `"You said: Info"`), an `undo` row; `delegationText({ delegateName: "Ola", status: "drafted", dueAt: null })` = `"Ola · Drafted"`, with `delegateName: null` = `"A delegate · Drafted"`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit` (now with `en.test.ts`).
  - Done when: the tests pass; `bun run test:unit` output lists `en.test.ts`.
  - Out of scope: components.

- [x] **7.2 `lib/activity-filters.ts` and `lib/activity-list.ts` (B10, B11)**
  - Goal: the URL, the API query and the list state are pure functions with tests.
  - Files: create `apps/web/src/lib/activity-filters.ts`, `activity-filters.test.ts`, `activity-list.ts`, `activity-list.test.ts`.
  - Interfaces:

    ```ts
    // lib/activity-filters.ts
    export interface ActivityFilters {
      mailboxId: string | null;
      category: "all" | "action" | Category;
      range: ActivityRange;
      notRated: boolean;
    }
    export const DEFAULT_FILTERS: ActivityFilters; // { mailboxId: null, category: "all", range: "7d", notRated: false }
    export function filtersFromSearch(search: string): ActivityFilters;
    export function filtersToSearch(filters: ActivityFilters): string; // "" for the defaults, else "?mailbox=…&category=…&range=…&notRated=1"
    export function activityQueryString(filters: ActivityFilters, now: Date, before?: string): string; // "?since=…&…"

    // lib/activity-list.ts
    export interface ActivityListState {
      items: ActivityItem[];
      nextBefore: string | null;
      olderLoaded: boolean;
      status: "loading" | "ready" | "error";
      refreshError: boolean;
      loadingMore: boolean;
      lastLoad: Date | null;
    }
    export const INITIAL_LIST: ActivityListState; // status "loading", empty
    export function firstPage(page: ActivityWebPage, at: Date): ActivityListState;
    export function mergePolled(state: ActivityListState, page: ActivityWebPage, at: Date): ActivityListState;
    export function startLoadMore(state: ActivityListState): { state: ActivityListState; cursor: string } | null; // null: nothing to load or a load runs
    export function appendOlder(state: ActivityListState, page: ActivityWebPage, sentCursor: string): ActivityListState;
    export function loadMoreFailed(state: ActivityListState): ActivityListState; // loadingMore: false
    export function patchItem(
      state: ActivityListState,
      emailId: string,
      patch: Partial<Pick<ActivityItem, "feedback" | "undoable" | "undoPending">>
    ): ActivityListState;
    export function compareKey(a: ActivityItem, b: ActivityItem): number; // receivedAt DESC, then emailId DESC
    ```

  - Decisions:
    - URL keys: `mailbox` (a UUID; else ignored), `category` (`action` or one of the seven; else `all`), `range` (one of `activityRanges`; else `7d`), `notRated` (`1` = on). Unknown keys are ignored. `filtersFromSearch` does not know the mailbox list; the page drops an unknown mailbox id (stage 8).
    - `activityQueryString`: `since` = `new Date(now.getTime() − activityRangeMs[range]).toISOString()`; `mailboxId` when set; `categories` = `NEEDS_ACTION_CATEGORIES.join(",")` for `action`, the one category, nothing for `all`; `notRated=true` when on; `before` when given; `limit` is not sent (the server default 50). Build it with `URLSearchParams` (it encodes the cursor).
    - `compareKey` compares `receivedAt` strings as instants (`Date.parse`), then `emailId` as strings, both descending (the server order is `received_at DESC, id DESC`; UUID text order equals the Postgres `uuid` order for the lower-case hex the API returns).
    - `mergePolled`: when `olderLoaded` and `loadingMore` are both false, or `page.items` is empty → `firstPage(page, at)` (an empty poll means the window has no mail: drop the old pages; cold review question 18). Else `last` = the last polled item; `keep` = the old items with `compareKey(item, last) > 0` (older than `last`) whose `emailId` is not in the page; result `items = [...page.items, ...keep]`; `nextBefore` and `loadingMore` keep their old values; `olderLoaded` keeps its value; `status: "ready"`, `refreshError: false`, `lastLoad: at`. Why `loadingMore` counts: a poll that lands while "Load more" runs must not replace `nextBefore`, or the older page would attach to the wrong end (cold review finding 3).
    - `startLoadMore`: `null` when `loadingMore` or `nextBefore === null`; else `{ state: { …state, loadingMore: true }, cursor: state.nextBefore }`.
    - `appendOlder(state, page, sentCursor)`: when `state.nextBefore !== sentCursor` (a `refresh()` or a first page replaced the list meanwhile) → `{ …state, loadingMore: false }`, the page dropped; else add the page items whose `emailId` is not yet in the list, in order; `nextBefore = page.nextBefore`; `olderLoaded = true`; `loadingMore = false`.
    - `loadMoreFailed`: `{ …state, loadingMore: false }`.
    - `patchItem`: replaces the one item (immutable); an unknown id returns the same state object.
  - Test (unit, fixed items built by a local `item(id, receivedAt)` helper):
    1. `filtersFromSearch("")` = defaults; `"?category=action&range=30d&notRated=1&mailbox=<uuid>"` → the four values; `"?category=bogus&range=1y&mailbox=x"` → defaults; `filtersToSearch(DEFAULT_FILTERS)` = `""`; round trip for three filter sets.
    2. `activityQueryString` with `NOW = 2026-11-11T12:00:00.000Z`, range `24h`, category `action`, not rated, a mailbox and `before = "abc_-"` → `since=2026-11-10T12:00:00.000Z`, `categories=urgent%2Cneeds_reply%2Cunsure` (or the decoded equal value), `notRated=true`, `mailboxId=…`, `before=abc_-`; defaults → only `since` (7 days).
    3. `mergePolled` without older pages = `firstPage`.
    4. Older pages loaded: old list A..F (newest A), first page was A..C, older D..F; a poll returns N, A, B (N is new; C fell off) → result N, A, B, C, D, E, F (C kept because it is older than B); `nextBefore` unchanged.
    5. A poll returns A', B, C with a changed A' (feedback set) → A' replaces A; no duplicate.
    6. Equal `receivedAt`: two items with the same time and ids `…a` and `…b` sort `…b` first; `mergePolled` keeps both exactly once.
    7. `appendOlder` skips an id already in the list; `patchItem` changes only the target item; an unknown id returns the same object (`toBe`).
    8. Load more and a poll at the same time: `startLoadMore` on a first-page state (A..C, `nextBefore` = X) gives cursor X and `loadingMore: true`; a poll lands (`mergePolled` with N, A, B) → `nextBefore` is still X and `loadingMore` still `true`, C kept; `appendOlder(state, D..F page, X)` → N, A, B, C, D, E, F and `loadingMore: false`. A second `startLoadMore` while `loadingMore` → `null`.
    9. Load more and a refresh: after `startLoadMore` (cursor X), `firstPage` of a refresh gives `nextBefore` Y; `appendOlder(state, page, X)` → the page is dropped and `loadingMore` is `false`.
    10. An empty poll with older pages loaded → `firstPage` (empty list, `nextBefore: null`).
  - Check: `bun run lint && bun run typecheck && bun run test:unit`.
  - Done when: the tests pass.
  - Out of scope: the hook (7.3).

- [x] **7.3 `lib/activity-api.ts`, `lib/use-media.ts`, `lib/use-activity-list.ts`, the lint scope (B10, B11)**
  - Goal: the page has one data hook with polling, load more, refresh and patch, and a width hook for the panel side.
  - Files: create `apps/web/src/lib/activity-api.ts`, `use-media.ts`, `use-activity-list.ts`; change `eslint.config.js`.
  - Interfaces:

    ```ts
    // lib/activity-api.ts
    export function fetchActivity(query: string): Promise<ActivityWebPage>; // api(`/api/activity${query}`, activityPageSchema)
    export function postFeedback(body: FeedbackBody): Promise<FeedbackResult>; // POST /api/feedback
    export function postUndo(body: UndoBody): Promise<UndoWebResult>; // POST /api/actions/undo

    // lib/use-media.ts
    export function useMediaQuery(query: string): boolean;

    // lib/use-activity-list.ts
    export function useActivityList(
      queryOf: (before?: string) => string,
      opts?: { pollMs?: number; onLoadMoreError?: () => void }
    ): {
      state: ActivityListState;
      refresh(): void;
      loadMore(): void;
      patch(emailId: string, patch: Parameters<typeof patchItem>[2]): void;
    };
    ```

  - Decisions:
    - `useMediaQuery`: `useSyncExternalStore(subscribe, () => matchMedia(query).matches, () => false)`; `subscribe` adds and removes a `change` listener on `matchMedia(query)`. The server snapshot `false` gives the phone layout in the static build.
    - `useActivityList` (the `useResource` pattern of `lib/use-resource.ts`, with `startPolling` of `lib/poll.ts`): `queryOf` is read through a ref; a `seqRef` counts loads, `refresh()` and `patch()`; a load answer counts only when its sequence number is still the newest; the first load and each poll call `fetchActivity(queryOf())` and apply `firstPage` (first load or `refresh()`) or `mergePolled` (a poll) — keep a ref `modeRef` that `refresh()` sets to "first"; a poll failure with items → `refreshError: true` (items kept); with no items → `status: "error"`; `refresh()` sets `status: "loading"` only when there are no items, restarts the polling loop (the `tick` state of `useResource`) and loads with `firstPage`; `loadMore()`: `startLoadMore(state)`; `null` → nothing; else set that state and call `fetchActivity(queryOf(cursor))`; the answer is applied with `appendOlder(current, page, cursor)` (a functional `setState`), unless a `refresh()` came after the start (a separate `moreSeqRef` that `refresh()` and an unmount bump; a poll does not bump it); a failure → `loadMoreFailed` and `opts.onLoadMoreError?.()`. The first-page `seqRef` and `moreSeqRef` are separate, so a poll never drops a load-more answer and a load-more never drops a poll. `patch()` bumps the sequence and applies `patchItem`.
    - No React test harness exists (S5c review note 7): the hook stays thin over the tested pure functions; `poll.test.ts` covers the 30 s interval and the stop when hidden (the done-when's polling line).
    - `eslint.config.js`: add `"apps/web/src/components/activity/**/*.tsx"` to the `react/jsx-no-literals` file list (fact 11).
  - Test: none new beyond 7.1 and 7.2 (the hooks are thin; the page stages and Playwright cover them).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run web:build`.
  - Done when: lint, typecheck, unit and the web build pass.
  - Out of scope: components (stages 8–9).
