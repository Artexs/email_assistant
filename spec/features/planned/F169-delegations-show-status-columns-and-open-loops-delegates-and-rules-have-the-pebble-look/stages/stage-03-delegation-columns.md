# F169 stage 03 — The Delegations page as status columns

Part of [`../plan.md`](../plan.md). Needs stage 01: `delegation-columns.ts`, `use-delegation-columns.ts`. Needs stage 02: `Delegations.tsx`, `OpenLoops.tsx` without `DelegationTabs`. Needs F166 stage 03 (tokens), stage 04 (Button `soft`) and stage 10 (`EmptyState`). May run next to 05–10. Stage 04 waits for it (`OpenLoops.tsx`).

Mockup: screen `delegations`, shots `08-delegations-*`, without its delegate strip (PB-7) and its "Answered or done" merge.

## Step 1 — The columns

- **Files:** `components/delegation/Delegations.tsx` (on the stage 01 hook), a new `DelegationColumn.tsx`, `DelegationRow.tsx` (card look), `DelegationCancelDialog.tsx` (look only). Move `loadPages` into `lib/use-delegation-columns.ts`, then delete `DelegationFilterTabs.tsx`, `lib/use-delegation-filter.ts`, `lib/use-delegation-list.ts`, and the helpers and keys only they read. Keep `dgn_filter_open` and `dgn_filter_closed`: `lib/loops-view.ts` reads them.
- **Decisions:** D1–D11, D18.
  - Layout D6. A column: a muted group with radius `xl`, an `h2` with icon and title in its tone, the count chip (D5), a `ul` named by the `h2` (`aria-labelledby`), then "Show more" (`dgn_more`, `dgn_more_error`) while its feed has a cursor; the empty line only at 0 rows and an ended feed (D4).
  - A card: the task (bold; the retention dash stays), subject, delegate, due date, buttons. The status badge shows only in the closed list (`showStatus` prop). Remind now `soft` at full card width, Done `outline`, Cancel `ghost`. The drafted card keeps its draft link (`dgn_open_draft`).
  - Closed list D8: a button `dgn_closed_show` / `dgn_closed_hide` ("Show / Hide closed delegations", "Pokaż / Ukryj zamknięte delegacje") with `aria-expanded`, then a `ul` named `dgn_col_closed` ("Closed" / "Zamknięte") with its own "Show more". `?filter=closed` opens it on load and scrolls it into view (D7).
  - One `EmptyState` (icon `Users`, `dgn_none_title` "No open delegations" / "Brak otwartych delegacji", `dgn_none_text` "When you hand a mail to a delegate, it shows here." / "Gdy przekażesz wiadomość osobie z zespołu, pojawi się tutaj.") when the four columns are empty and ended. The closed feed is not loaded then, so the closed-list button always shows.
  - The status line (`role="status"`, `tabindex="-1"`) and `dgn_owner_only` stay above the columns. Focus after a reload: `focusAfterReload` (D9). D4: `dgn_col_no_more` "No more rows in this column." / "W tej kolumnie nie ma więcej pozycji." (no cursor); `dgn_col_capped` "No new rows yet. Press Show more again." / "Na razie brak nowych pozycji. Naciśnij „Pokaż więcej” ponownie." (4-page cap; focus stays on the button).

## Step 2 — The Delegated tab of Open loops

- **Files:** `OpenLoops.tsx` (wiring only), `lib/loops-view.ts`.
- **Decisions:** D12. `Delegations` loses its `below` prop and keeps `embedded`. With `delegation_pages` on, the Delegated tab renders `<Delegations embedded />`, then `<LoopsBoard kind="delegated" filter={filter} filterNav={filterNav} showHeading />`. `LOOP_FILTER_OF_DELEGATION` goes. Look of the board: stage 04.

## Tests

1. `DelegationColumn` render test: 2 rows give an `h2` with the title and a list of that name with 2 items; 0 rows give the `empty` text when the feed ended, and only Show more when it has a cursor; `next` set gives the count `2+`.
2. `delegations.spec.ts`, the tab cases rewritten to columns on today's seed (each status at least once; `open_loops` is off in its org): each seeded row is in the column of its status; done and cancelled show only after `dgn_closed_show`; `/delegations?filter=closed` opens the closed list.
3. The same spec keeps today's action cases from column cards: remind (link, block reasons), done, cancel (dialog, focus), the status line, "Show more" focus, member, suspended and flag-off views.
4. Mobile project, en and pl (`locale: "pl-PL"`): the four column headings stack top to bottom; `scrollWidth <= innerWidth` (acceptance 2).
5. `open-loops.spec.ts`, Delegated cases only: the columns show; the delegated loops show under `lp_list_delegated` with the filter links; `?tab=delegated&filter=closed` shows closed loops and the open closed list.
6. Both specs' a11y scans pass on both projects.
7. `page.route` answers 500 for `filter=answered`: Retry shows in the Answered column only; the other columns keep their rows (D10).
8. `demo/record.spec.ts` step 7 finds the overdue card in its column (D20); typecheck proves the compile.

## Docs

`docs/capabilities/web-panel.md` rule 9 (Delegations); `delegation.md` and `open-loops.md` where they name the tabs; `delegate-and-follow-up.mdx`, en and pl (D19).

## Out of scope

Board look (stage 04); Delegates (stage 05); API, filter or status changes.

## Done when

Tests 1–8 pass; you opened the `delegations` sheet pictures; Proof B with `delegations.spec.ts open-loops.spec.ts` prints `PROOF_OK`.
