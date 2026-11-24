# F169 stage 08 — Rule lists as chips, and Undo after a remove

Part of [`../plan.md`](../plan.md). Needs stage 06: `rules-lists.spec.ts`, the list grid cells, the "Remove a rule" docs section. Needs F166 stage 03 (tokens) and stage 10 (`SectionCard`, `EmptyState`). May run next to 01–05, 07, 09 and 10.

Mockup: `.rulecols` and `.chip` of screen `rules`.

## Step 1 — Chips

- **Files:** `components/rules/RuleList.tsx`, `lib/rules-view.ts` if a helper changes.
- **Decisions:** D17.
  - One `SectionCard` per kind (icons: VIP `Shield`, whitelist `Check`, blocklist `Ban`), title `kindTitles`, lead `rules_<kind>_text`, a `Badge` `secondary` with the rule count in the title row. The root keeps `data-kind` and, for VIP, `id={vipCardId}` (the urgency card links to it).
  - The rules are a `ul` named by the card title; each `li` is a chip: the pattern (breaks anywhere, never widens the card), then the scope as a second muted line only when the rule is for one mailbox (`scopeLabel`; a rule for all mailboxes loses today's `rules_all_mailboxes` line: default, `../questions.md` Q4), then the remove button (owner only; `icon-sm`, `X` icon, `aria-label` `rules_delete` with the pattern, as today).
  - An empty kind shows `EmptyState` with `headingLevel={3}`, icon of the kind, title `rules_empty`, no button.

## Step 2 — Remove and Undo

- **Files:** `components/rules/RuleList.tsx`, `islands/RulesPage.tsx` (the callback only).
- **Interface:** `RuleListProps` replaces `onDeleted(id)` with `onChanged(): void`, one callback for remove and Undo. `Rules` (above the keyed `RulesBody`) gives it: it raises `rulesVersion` and calls `reloadMe`, so an Undo after a mailbox filter change still reloads the list on screen.
- **Decisions (default, owner to confirm: `../questions.md` Q1):**
  - A click deletes at once with `DELETE /api/rules/:id`, as today. On success the toast `rule_deleted_toast` has the action `rule_undo` "Undo" / "Cofnij" and lasts 10 s.
  - Undo posts `{ kind, pattern, mailboxId? }` of the deleted rule to `POST /api/rules` (the add form's body, `ruleBodySchema`). Answers: success or 409 `rule_exists` → toast `rule_restored_toast` "Rule put back." / "Reguła przywrócona."; 404 → `err_not_found`; any other → `errorText`. Then `onChanged()`. Two clicks send one request (single flight).
  - Focus after a remove: the remove button of the next chip in the same card, else of the one before, else the card root with `tabIndex={-1}` if `SectionCard` passes `ref` and `tabIndex` to its root (F166 `interfaces.md` says only "div props"), else a focusable card heading. Never the page body.
  - A 404 on the delete: toast `err_not_found`, the list reloads (as today).
  - Undo lives in the toast of the owner who removed; a member has no remove button.
- **Texts:** `rule_undo`, `rule_restored_toast` next to `rule_deleted_toast` in `texts/en-settings.ts` and `pl-settings.ts`.

## Tests

1. `rules-view.test.ts` or a new render test: a VIP card with 2 rules has an `h2` "VIP", a count badge "2", a list of 2 chips, and the root has `id="rules-vip"` and `data-kind="vip"`.
2. A chip of a rule for one mailbox shows its address; a rule for all mailboxes shows no scope line.
3. A pure helper test (`undoBody(rule)`): a rule with `mailboxId: null` gives `{ kind, pattern }`; with an id, `{ kind, pattern, mailboxId }`; the result passes `ruleBodySchema`.
4. `rules-lists.spec.ts`: create a blocklist rule with `POST /api/rules` (not the form: stage 07 changes it), remove it, the chip is gone and the focus is on the card root, its heading or a remove button (not `body`); click Undo in the toast; the chip is back and `rule_restored_toast` shows.
5. The same spec: remove a rule, wait past the toast (poll, no fixed sleep), the chip stays gone after a reload.
6. The same spec keeps the delete case of stage 06 (its rule comes from the API), its a11y scan and the 320 px check. Its one changed assertion: the chip of `boss@e2e.test` shows no `rules_all_mailboxes` text.

## Docs

The "Remove a rule" section of `sender-rules.mdx` (en, pl): Undo in the message for 10 seconds. `docs/capabilities/web-panel.md` rule 9, the Rules part: chips and Undo.

## Out of scope

The add form (stage 07); a confirm question; a bulk remove.

## Done when

Tests 1–6 pass; you opened the sheet pictures of `rules`; Proof B with `rules-lists.spec.ts rules-form.spec.ts` (the form spec reads the VIP list too) prints `PROOF_OK`.
