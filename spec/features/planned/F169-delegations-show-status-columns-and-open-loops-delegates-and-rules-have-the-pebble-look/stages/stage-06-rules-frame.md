# F169 stage 06 — The frame of the Rules page

Part of [`../plan.md`](../plan.md). Needs F166 stage 03 (tokens), stage 08 (`web:build:dev`, `patterns.spec.ts` of Proof B) and stage 09 (`AppShell` `lead`). May run next to 01–05, 09 and 10. Stages 07 and 08 wait for this stage: they need the two spec files and the docs sections it makes.

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

- **Files:** `apps/web/e2e/tests/rules.spec.ts` becomes `rules-form.spec.ts` (stage 07 owns it) and `rules-lists.spec.ts` (stage 08 owns it). Each keeps the sign-in, `cleanUpOrg` (it deletes every rule), the CSP and console checks, the client-address blocks 70/170 and its a11y scan.
- **Decisions:** every step and assertion of today moves to one file, unchanged, except that the delete step needs its own rule:
  - `rules-form.spec.ts`: the empty VIP list, the two combobox texts (`rule_kind_vip`, `rules_all_mailboxes`), add `boss@e2e.test` and its toast, the pattern in the VIP list, the duplicate, the bad pattern, the post count.
  - `rules-lists.spec.ts`: create `boss@e2e.test` (VIP, all mailboxes) with `page.request.post("/api/rules", { headers: { origin: E2E_BASE_URL }, data })`, open `/rules`, then assert the chip shows the pattern and `rules_all_mailboxes`, then the delete step and the empty list.
  - Add one check to `rules-lists.spec.ts`: at 320 px wide and on the mobile project, `scrollWidth <= innerWidth`, in English and in Polish.
- **Which later stage changes which assertion:** stage 07 changes the two combobox texts in `rules-form.spec.ts` to `rules_sentence_kind_vip` and `rules_sentence_scope_all`. Stage 08 changes the `rules_all_mailboxes` chip assertion in `rules-lists.spec.ts` to "no scope line" (Q4). No other assertion changes.

## Step 3 — Sections of the user docs page

- **Files:** `apps/docs/src/content/docs/how-to/sender-rules.mdx` and its `pl/` copy.
- **Decisions:** D19. Rename the heading "Steps" to "Add a rule" (pl "Dodaj regułę"). Move the one sentence on removing a rule to a new section "Remove a rule" (pl "Usuń regułę") after it. Keep every other heading and sentence, and `<Shot page="rules" />`. The page has no text on the cards; stage 06 adds none (stages 09 and 10 change no docs page). Stages 07 and 08 then edit one section each. Run `bun run docs:test` if it checks this page's headings.

## Tests

1. `rules-form.spec.ts` and `rules-lists.spec.ts` together run every assertion of the old `rules.spec.ts` (compare by reading; the final message lists them), and each file passes alone.
2. The new 320 px check passes in both languages.
3. `account.spec.ts` (member has no `rules_add` button), `polish.spec.ts` (the Polish title) and the docs-shots spec of `/rules` keep their locators: the page has one `h1` with `title_rules`.

## Docs

`docs/capabilities/web-panel.md` rule 9, the Rules part: the order of the page. The table row of `/rules` stays.

## Out of scope

The add form (stage 07), the rule lists (stage 08), the urgency card (stage 09), the suggestions and newsletters cards (stage 10).

## Done when

Tests 1–3 pass; you opened the sheet pictures of `rules`; Proof B with `rules-form.spec.ts rules-lists.spec.ts account.spec.ts polish.spec.ts` prints `PROOF_OK`.
