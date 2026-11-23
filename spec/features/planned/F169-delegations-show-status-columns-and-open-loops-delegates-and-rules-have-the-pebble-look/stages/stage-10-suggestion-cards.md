# F169 stage 10 — The suggestions and newsletters cards in the Pebble look

Part of [`../plan.md`](../plan.md). Needs F166 stage 03 (tokens) and stage 10 (`SectionCard`, `RowList`, `Row`, `EmptyState`). May run next to every other stage of this ticket: it owns only these two cards.

The mockup has neither card (PB-3): use the `.sec` cards and `.line` rows of screen `settings`.

## Step 1 — Suggestions card

- **Files:** `components/rules/SuggestionsCard.tsx`, `lib/suggestions-view.ts` if a helper changes.
- **Decisions:**
  - A `SectionCard` (icon `Sparkles`, title as today) that keeps `data-card="suggestions"`. It shows and hides on the same rules as today (a 404 drops one mailbox; no mailbox left, no card).
  - The mailbox select keeps its label. Rows are a `RowList`: the pattern as the title, the kind as `Badge` `secondary` (`kindTitles`), the reason of counts as the hint, Accept (`soft`) and Dismiss (`ghost`) at the end for an owner who can write. Rows keep `data-pattern`, `data-suggestion-kind` and the names `sg_accept_for`, `sg_dismiss_for`.
  - Focus after an Accept or a Dismiss: today it goes to the card heading. If `SectionCard` passes `ref` and `tabIndex` to its root, the focus goes to the root with `tabIndex={-1}` and `aria-label` = the card title; else keep a focusable heading inside the card. Never the page body.
  - `onRulesChanged` is called as today, so the rule lists reload and the add form keeps its typed text.
  - An empty list is one muted line as today (a card with nothing to suggest is not a page-level empty state).

## Step 2 — Newsletters card

- **Files:** `components/rules/NewslettersCard.tsx`, `lib/newsletters-view.ts` if a helper changes.
- **Decisions:**
  - A `SectionCard` (icon `Newspaper`, title `nl_title`) that keeps `data-card="newsletters"` and the flag `bulk_unsubscribe`.
  - Rows are a `RowList`: the sender (`senderLower`) as the title, the method and the request state as the hint (state as `Badge`), the one-click button (`soft`) or the link at the end for an owner. Rows keep `data-sender`, `data-method` and the names `nl_unsubscribe_for`, `nl_open_link_for`. The count line keeps its plural (`nl_count`).
  - Toasts and their texts do not change.
- **Texts:** none new expected. Remove emoji from `sg_*` and `nl_*` texts if any are there.

## Tests

1. `suggestions-view.test.tsx` keeps its cases; add one: a row for an owner has Accept and Dismiss with the accessible names of `sg_accept_for` and `sg_dismiss_for` and the kind badge text.
2. `newsletters-view.test.tsx` keeps its cases; add one: a row with the one-click method has the button named `nl_unsubscribe_for` and a member row has no button.
3. `suggestions.spec.ts` and `newsletters.spec.ts` pass with today's locators; the suggestions spec still keeps the half-typed add-form text after an Accept. A locator that must change is named in the final message.
4. Their a11y scans pass on both projects; mobile project: `scrollWidth <= innerWidth` on `/rules` with both cards shown.

## Docs

`docs/capabilities/web-panel.md` rule 9 only if a sentence names the look. No user docs page (D19).

## Out of scope

The suggestion and unsubscribe APIs and rules; the rule lists (stage 08); the add form (stage 07).

## Done when

Tests 1–4 pass; you opened the e2e or sheet pictures of `/rules` with both cards (say which); Proof B with `suggestions.spec.ts newsletters.spec.ts` prints `PROOF_OK`.
