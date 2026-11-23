# F169 stage 03 — The Delegations page as status columns

Part of [`../plan.md`](../plan.md). Needs stage 01: `delegation-columns.ts` and `use-delegation-columns.ts`. Needs stage 02: `Delegations.tsx` and `OpenLoops.tsx` without `DelegationTabs`. Needs F166 stage 03 (tokens) and stage 10 (`EmptyState`). May run next to 05–10. Stage 04 waits for this stage (`OpenLoops.tsx`).

Mockup: screen `delegations`, shots `08-delegations-*`. Do not take its delegate strip (PB-7) or its "Answered or done" merge (done is in the closed list).

## Step 1 — The columns

- **Files:** `components/delegation/Delegations.tsx` (on the stage 01 hook), a new `DelegationColumn.tsx`, `DelegationRow.tsx` (card look), `DelegationCancelDialog.tsx` (look only). Delete `DelegationFilterTabs.tsx`, `lib/use-delegation-filter.ts`, `lib/use-delegation-list.ts` when nothing reads them, and the helpers and keys only they read (`FILTER_LABELS`, `FILTER_EMPTY`, `filterHref`, the `dgn_filter_*` keys except `dgn_filter_open` and `dgn_filter_closed` (`lib/loops-view.ts` reads them), `dgn_filters_label`, `dgn_empty_*`, `dgn_list_label`).
- **Decisions:** D1–D11, D18.
  - Layout D6. A column: a muted group with radius `xl`, an `h2` with icon and title in its tone, the count chip (D5), a `ul` named by the `h2` (`aria-labelledby`), then its empty line or "Show more" (`dgn_more`) with `dgn_more_error`.
  - A card: the task (bold; the retention dash stays), the subject, the delegate name, the due date, the buttons. The status badge shows only in the closed list (`showStatus` prop). Remind now `soft` at full card width, Done `outline`, Cancel `ghost`. The drafted card keeps its draft link (`dgn_open_draft`).
  - Closed list D8: a button `dgn_closed_show` / `dgn_closed_hide` ("Show closed delegations" / "Pokaż zamknięte delegacje", "Hide closed delegations" / "Ukryj zamknięte delegacje") with `aria-expanded`, then a `ul` named `dgn_col_closed` ("Closed" / "Zamknięte") with its own "Show more". `?filter=closed` opens it on load and scrolls it into view (D7).
  - One `EmptyState` (icon `Users`, `dgn_none_title` "No delegations yet" / "Brak delegacji", `dgn_none_text` "When you hand a mail to a delegate, it shows here." / "Gdy przekażesz wiadomość osobie z zespołu, pojawi się tutaj.", no button) only when the four columns are loaded and empty and the closed list is shut.
  - The status line (`role="status"`, `tabindex="-1"`) stays above the columns with every text. Focus after a reload: `focusAfterReload` (D9). `dgn_col_no_more` "No more rows in this column." / "W tej kolumnie nie ma więcej pozycji." (D4). `dgn_owner_only` stays above the columns.

## Step 2 — The Delegated tab of Open loops

- **Files:** `components/loops/OpenLoops.tsx` (wiring only), `lib/loops-view.ts`.
- **Decisions:** D12. `Delegations` loses its `below` prop and keeps `embedded`. With `delegation_pages` on, the Delegated tab renders `<Delegations embedded />`, then `<LoopsBoard kind="delegated" filter={filter} filterNav={filterNav} showHeading />`. `LOOP_FILTER_OF_DELEGATION` goes. Look of the board: stage 04.

## Tests

1. `DelegationColumn` render test: 2 rows give an `h2` with the title and a list of that name with 2 items; 0 rows give the `empty` text; `next` set gives the count `2+`.
2. `delegations.spec.ts`, the tab cases rewritten to columns on today's seed (one delegation per status; its org has `delegation_pages`, `approvals_page`, `stats_page` and not `open_loops`, `e2e-seed/seed-delegations.ts`): each seeded row is in the column of its status; done and cancelled show only after `dgn_closed_show`; `/delegations?filter=closed` opens the closed list.
3. The same spec keeps today's action cases from column cards: remind with its link and its block reasons, done, cancel with the dialog and its focus, the status line, "Show more" with focus on the first new row, member, suspended and flag-off views.
4. Mobile project, en and pl (`test.use({ locale: "pl-PL" })`): the four column headings follow each other top to bottom, and `scrollWidth <= innerWidth` (ticket acceptance 2).
5. `open-loops.spec.ts`, Delegated cases only: the columns show; the delegated loops show under `lp_list_delegated` with the filter links; `?tab=delegated&filter=closed` shows closed loops and the open closed list.
6. The a11y scans of both specs pass on both projects.
7. `demo/record.spec.ts` step 7 finds the overdue card in the overdue column (D20); the typecheck proves the compile.

## Docs

`docs/capabilities/web-panel.md` rule 9 (Delegations), `docs/capabilities/delegation.md` and `open-loops.md` where they name the tabs or the Delegated filter, `apps/docs/src/content/docs/how-to/delegate-and-follow-up.mdx` and its `pl/` copy (D19).

## Out of scope

The board look (stage 04); the Delegates page (stage 05); any API, filter or status change.

## Done when

Tests 1–7 pass; you opened the sheet pictures of `delegations`; Proof B with `delegations.spec.ts open-loops.spec.ts` prints `PROOF_OK`.
