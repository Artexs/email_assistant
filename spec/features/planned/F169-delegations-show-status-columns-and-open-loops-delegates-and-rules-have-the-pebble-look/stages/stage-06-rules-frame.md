# F169 stage 06 — The frame of the Rules page

Part of [`../plan.md`](../plan.md). Needs F166 stage 03 (tokens) and stage 09 (`AppShell` `lead`). May run next to 01–05, 09 and 10. Stages 07 and 08 wait for this stage: they need the two spec files and the docs sections it makes.

Rule 2 of § Rules for width: this stage fixes the layout and the shared files of the page, so its sections can run next to each other. Mockup: screen `rules`, shots `04a-rules-*`.

## Step 1 — Layout and page head

- **Files:** `islands/RulesPage.tsx`.
- **Decisions:**
  - Lead `rules_lead` "Sender rules run before the AI." / "Reguły nadawców działają przed AI." No page head action.
  - Order from the top: a compact bar with the mailbox filter (`#rules-filter`, label `rules_filter_label`), the "updated at" line and Refresh; the add form (owners) or the owner-only line; the three rule lists; then the urgency, suggestions and newsletters cards in today's order and with today's flags.
  - The three lists sit in one grid: three columns from `lg`, one column below (DB-6). This stage gives each `RuleList` its grid cell; stage 08 changes what is inside.
  - Content width: the page drops `max-w-3xl`; the lists grid and the cards share one width of at most 72 rem.
  - Loading and error states keep their texts (`rules_load_error`, Retry) with `Skeleton` blocks in the shape of the new layout.
  - Keep `rulesVersion`, the keyed `RulesBody`, `reloadMe` and every prop that a card gets.
- **Texts:** `rules_lead` next to `title_rules` in `texts/en-approvals.ts` and `pl-approvals.ts`.

## Step 2 — Split the Rules spec

- **Files:** `apps/web/e2e/tests/rules.spec.ts` becomes `rules-form.spec.ts` (add, a duplicate, a bad pattern) and `rules-lists.spec.ts` (delete); each keeps its a11y scan.
- **Decisions:** a move with no change of a step or an assertion, so stage 07 owns the first file and stage 08 the second. Add one check to `rules-lists.spec.ts`: at 320 px wide and on the mobile project, `scrollWidth <= innerWidth`, in English and in Polish.

## Step 3 — Sections of the user docs page

- **Files:** `apps/docs/src/content/docs/how-to/sender-rules.mdx` and its `pl/` copy.
- **Decisions:** D19. Group the existing text under three headings, "Add a rule", "Remove a rule", "Cards" (pl "Dodaj regułę", "Usuń regułę", "Karty"), with no change of a sentence. Stages 07 and 08 then edit one section each. Keep `<Shot page="rules" />`. If `docs:test` checks the headings of this page, run it.

## Tests

1. `rules-form.spec.ts` and `rules-lists.spec.ts` together run every step and assertion of the old `rules.spec.ts` (compare by reading; the final message lists them).
2. The new 320 px check passes in both languages.
3. `account.spec.ts` (member has no `rules_add` button), `polish.spec.ts` (the Polish title) and the docs-shots spec of `/rules` keep their locators: the page has one `h1` with `title_rules`.

## Docs

`docs/capabilities/web-panel.md` rule 9, the Rules part: the order of the page. The table row of `/rules` stays.

## Out of scope

The add form (stage 07), the rule lists (stage 08), the urgency card (stage 09), the suggestions and newsletters cards (stage 10).

## Done when

Tests 1–3 pass; you opened the sheet pictures of `rules`; Proof B with `rules-form.spec.ts rules-lists.spec.ts account.spec.ts polish.spec.ts` prints `PROOF_OK`.
