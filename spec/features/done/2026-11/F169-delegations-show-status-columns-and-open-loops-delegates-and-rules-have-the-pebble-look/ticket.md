---
opened: 2026-11-23
landed: 2026-11-25
---

# F169 · Delegations show status columns, and Open loops, Delegates and Rules have the Pebble look

## Outcome

Delegations show the user's handed-over work as status columns (overdue, waiting for approval, sent, answered) on a desktop and as sections on a phone. The Open loops board, the Delegates tab and the Rules page have the Pebble look. A sender rule is added through a sentence-style form that reads correctly in English and in Polish.

## Scope

- The delegations page with and without the open-loops flag: columns, row actions (remind, done, cancel), paging per column, the closed items.
- The open-loops board and its tabs, the delegates list and its dialogs.
- The rules page: the sentence form, the rule lists as chips, and the newsletters, suggestions and urgency cards.
- The e2e specs and the capability and user docs of these pages.

## Out of scope

- A change of the delegation or loop API, filters or statuses.
- Counts on delegate cards (programme decision PB-7).
- Drag and drop between columns.

## Acceptance

- Every delegation status has exactly one column or the closed list; a test fails when a status has none.
- On a Pixel 7 the four groups stack with no sideways scroll, in English and in Polish.
- Remind, done and cancel work from a column card and keep their limits and dialogs.
- With the open-loops flag on, the page shows the loops board in the new look; with only the delegation flag on, it shows the columns.
- The rule sentence has a different slot order in Polish where the grammar needs it, and each slot has a label for a screen reader.
- A removed rule chip can be put back from the toast, or the remove asks first, as today.

## Slices

Stages come from the plan, by the programme page § Rules for width.

## Sequenced

- Plan after: F166 (its `interfaces.md`).
- Build after: none. Gate: the stages need F166 stages 03 (tokens), 04 (Button `soft` and `destructive-soft`, 48 px fields), 06 and 10 (patterns), 08 (pattern page and its spec) and 09 (page head contract). May build next to F167, F168 and F170.

## Notes

Programme page: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md).
