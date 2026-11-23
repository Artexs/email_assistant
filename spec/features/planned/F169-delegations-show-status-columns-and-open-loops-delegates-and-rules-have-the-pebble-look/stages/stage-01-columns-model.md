# F169 stage 01 — The columns model and the feeds

Part of [`../plan.md`](../plan.md). Needs F166 stage 03: the `text-cat-*` and `text-primary` classes that `COLUMN_LOOK` names. May run next to 02, 05–10. No UI change: no page uses these files yet.

## Step 1 — The status-to-column record

- **Goal:** each delegation status has one place on the page (ticket acceptance 1).
- **Files:** `apps/web/src/lib/delegation-columns.ts` and its test.
- **Interfaces (stage 03 uses them):**
  ```ts
  export type DelegationColumn = "overdue" | "drafted" | "sent" | "answered";
  export type DelegationGroup = DelegationColumn | "closed";
  export const DELEGATION_COLUMNS: readonly DelegationColumn[];          // ["overdue", "drafted", "sent", "answered"], the page order
  export const DELEGATION_GROUP_OF: Record<DelegationStatus, DelegationGroup>;
  export const GROUP_FEED: Record<DelegationGroup, DelegationFilter>;    // overdue→overdue, drafted→open, sent→open, answered→answered, closed→closed
  export const COLUMN_LOOK: Record<DelegationColumn, { title: TextKey; empty: TextKey; icon: LucideIcon; tone: string }>;
  export function placeRows(feeds: Partial<Record<DelegationFilter, readonly DelegationItem[]>>): Record<DelegationGroup, DelegationItem[]>;
  export function focusAfterReload(focusedId: string | null, groups: Record<DelegationGroup, readonly DelegationItem[]>): "row" | "status" | null;
  ```
- **Decisions:** D1, D2, D3, D9. `drafted → drafted`, `sent → sent`, `overdue → overdue`, `answered → answered`, `done` and `cancelled → closed`. Tones: drafted `text-primary`, sent `text-cat-needs-reply`, overdue `text-cat-urgent`, answered `text-cat-notification`; each a whole class name. Icons (lucide): drafted `Send`, sent `Clock`, overdue `AlertTriangle`, answered `CheckCircle2`. `placeRows` keeps the server order inside a group; an id already placed is skipped (D3 order). `focusAfterReload`: `null` when nothing was focused; `"row"` when the id is in any group; else `"status"`.
- **Texts:** `dgn_col_overdue` "Overdue", `dgn_col_drafted` "Waiting for your approval", `dgn_col_sent` "Sent, waiting for an answer", `dgn_col_answered` "Answered"; pl "Po terminie", "Czeka na Twoją zgodę", "Wysłane, czeka na odpowiedź", "Z odpowiedzią". Empty: `dgn_col_empty_<column>` en "Nothing here.", pl "Nic tu nie ma.". Add them next to the `dgn_*` keys of `texts/en-approvals.ts` and `pl-approvals.ts`. `COLUMN_LOOK` reads them (the unused-key test of F166 stage 07 counts it).
- **Test:**
  1. The keys of `DELEGATION_GROUP_OF` equal `delegationStatuses` (a new core status fails here).
  2. `GROUP_FEED[DELEGATION_GROUP_OF[s]]` is the filter that holds `s`, from a table in the test (open = drafted, sent; closed = done, cancelled).
  3. `placeRows({ open: [d1 drafted, s1 sent, d2 drafted] })` gives drafted `[d1, d2]`, sent `[s1]`, the rest empty.
  4. `placeRows({ overdue: [x overdue], open: [x sent] })` places `x` once, in overdue.
  5. `focusAfterReload("x", …)` with `x` in answered gives `"row"`; with `x` nowhere gives `"status"`; with `null` gives `null`.
  6. Every key in `COLUMN_LOOK` has an `en` and a `pl` text.

## Step 2 — The feeds hook

- **Goal:** the page's feeds, each with its own paging, as one resource that reloads every 30 s.
- **Files:** `apps/web/src/lib/use-delegation-columns.ts` and a test of its pure part (model: `delegations-pages.test.ts`, which tests `loadPages`).
- **Interfaces (stage 03 uses them):**
  ```ts
  export interface FeedState { items: DelegationItem[]; next: string | null; pages: number; error: unknown | null }
  export async function loadUntilGain(column: "drafted" | "sent", feed: FeedState, fetch: (before: string) => Promise<DelegationList>, maxPages?: number): Promise<FeedState>;
  export function useDelegationColumns(options: { closedOpen: boolean }): {
    feeds: Partial<Record<DelegationFilter, FeedState>>; groups: Record<DelegationGroup, DelegationItem[]>;
    flagOff: boolean; loading: boolean; reload(): void; retry(feed: DelegationFilter): void;
    showMore(group: DelegationGroup): Promise<DelegationItem[]>;   // the rows that the clicked group gained
  };
  ```
- **Decisions:** D4, D8, D10. The first load fetches `open`, `overdue`, `answered` at once; `closed` only while `closedOpen`. Reuse `loadPages`, `mergePages`, `fetchDelegations`. A reload keeps each feed's page count. `flagOff` is true when any feed answers 404. Another error stays in its own `FeedState`. `loadUntilGain` stops at the first page that adds a row of `column`, at a `null` cursor, or after `maxPages` (default 4). `showMore("drafted" | "sent")` uses it; the other groups load one page.
- **Test:**
  7. `loadUntilGain("sent")` with a feed `next: "c1"` and fake pages `c1 → 50 drafted, next "c2"`, `c2 → 10 sent, next null` makes 2 calls and ends with 10 more sent rows and `next: null`.
  8. The same with every page drafted and `next` never null makes exactly 4 calls.
  9. A first page with `next: null` makes 0 calls.

## Out of scope

Components; the old list hooks (stage 03 replaces them).

## Done when

Tests 1–9 pass in `bun test` of the two new test files; Proof A of `../plan.md` prints `PROOF_OK`.
