# F169 stage 08 — Rule lists as chips, and Undo after a remove

Part of [`../plan.md`](../plan.md). Needs stage 06: `rules-lists.spec.ts`, the grid cell of each list and the "Remove a rule" section of `sender-rules.mdx`. Needs F166 stage 03 (tokens) and stage 10 (`SectionCard`, `EmptyState`). May run next to 01–05, 07, 09 and 10.

Mockup: the `.rulecols` cards and `.chip` of screen `rules`.

## Step 1 — Chips

- **Files:** `components/rules/RuleList.tsx`, `lib/rules-view.ts` if a helper changes.
- **Decisions:** D17.
  - One `SectionCard` per kind (icons: VIP `Shield`, whitelist `Check`, blocklist `Ban`), title `kindTitles`, lead `rules_<kind>_text`, a `Badge` `secondary` with the rule count in the title row. The root keeps `data-kind` and, for VIP, `id={vipCardId}` (the urgency card links to it).
  - The rules are a `ul` named by the card title; each `li` is a chip: the pattern (breaks anywhere, never widens the card), then the scope as a second muted line only when the rule is for one mailbox (`scopeLabel`), then the remove button (owner only; `icon-sm`, `X` icon, `aria-label` `rules_delete` with the pattern, as today).
  - An empty kind shows `EmptyState` with `headingLevel={3}`, icon of the kind, title `rules_empty`, no button.

## Step 2 — Remove and Undo

- **Files:** `components/rules/RuleList.tsx`, `islands/RulesPage.tsx` (only the callback prop).
- **Interface:** `RuleListProps` replaces `onDeleted(id)` with `onChanged(): void` (the page passes its reload; one callback for remove and Undo).
- **Decisions (default, owner to confirm: `../questions.md` Q1):**
  - A click deletes at once with `DELETE /api/rules/:id`, as today. On success the toast `rule_deleted_toast` has the action `rule_undo` "Undo" / "Cofnij" and lasts 10 s.
  - Undo posts `{ kind, pattern, mailboxId? }` of the deleted rule to `POST /api/rules` (the same body as the add form; `ruleBodySchema`). Answers: success → toast `rule_restored_toast` "Rule put back." / "Reguła przywrócona."; 409 `rule_exists` → the same text (the rule is there); 404 → `err_not_found`; any other → `errorText`. Then `onChanged()`. Two clicks send one request (single flight).
  - The restored rule has a new id; nothing else (no other page) keeps the old one.
  - Focus after a remove: the remove button of the next chip in the same card, else of the one before, else the card root (`tabIndex={-1}` on the `SectionCard` root). Never the page body.
  - A 404 on the delete keeps today's rule: toast `err_not_found` and the list reloads.
  - Undo is for the owner who removed: the toast lives in that browser only. A member never sees a remove button.
- **Texts:** `rule_undo`, `rule_restored_toast` next to `rule_deleted_toast` in `texts/en-settings.ts` and `pl-settings.ts`.

## Tests

1. `rules-view.test.ts` or a new render test: a VIP card with 2 rules has an `h2` "VIP", a count badge "2", a list of 2 chips, and the root has `id="rules-vip"` and `data-kind="vip"`.
2. A chip of a rule for one mailbox shows its address; a rule for all mailboxes shows no scope line.
3. A pure helper test (`undoBody(rule)`): a rule with `mailboxId: null` gives `{ kind, pattern }`; with an id, `{ kind, pattern, mailboxId }`; the result passes `ruleBodySchema`.
4. `rules-lists.spec.ts`: add a blocklist rule, remove it, the chip is gone and the focus is on the card root or a remove button (not `body`); click Undo in the toast; the chip is back and `rule_restored_toast` shows.
5. The same spec: remove a rule, wait past the toast (poll until it is gone, no fixed sleep), the chip stays gone after a reload.
6. The same spec keeps its old delete case, its a11y scan and the 320 px check of stage 06.

## Docs

The "Remove a rule" section of `sender-rules.mdx` (en, pl): Undo in the message for 10 seconds. `docs/capabilities/web-panel.md` rule 9, the Rules part: chips and Undo.

## Out of scope

The add form (stage 07); a confirm question before a remove; a remove of several rules at once.

## Done when

Tests 1–6 pass; you opened the sheet pictures of `rules`; Proof B with `rules-lists.spec.ts` prints `PROOF_OK`.
