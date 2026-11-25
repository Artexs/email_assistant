# F169 stage 09 — The urgency card in the Pebble look

Part of [`../plan.md`](../plan.md). Needs F166 stage 03 (tokens), stage 04 (Button `soft`, `destructive-soft`, 48 px fields) and stage 10 (`SectionCard`, `RowList`, `Row`). May run next to every other stage of this ticket: it owns only the urgency files.

The mockup has no urgency card (PB-3): use the `.sec` cards and `.line` rows of screen `settings`.

## Step 1 — Card, topics and deadlines

- **Files:** `components/rules/UrgencyCard.tsx`, `components/rules/UrgencyReadOnly.tsx`.
- **Decisions:**
  - The card is a `SectionCard` (icon `Flame` or `AlertTriangle`, title `urg_title`, lead as today) that keeps `data-card="urgency"`. Flag `urgency_editor` and its place on the page do not change (stage 06 owns the page).
  - The mailbox select keeps its label and behaviour.
  - Topics and deadlines keep their `h3` headings with their ids (`urg-topics-title`, `urg-deadlines-title`) and are `RowList`s: one `Row` per topic or deadline, the fields inside, the remove button at the end. Every `aria-label` stays (`urg_topic_name_label`, `urg_topic_keywords_label`, `urg_deadline_*`, `urg_topic_remove`), and `data-ended` stays on an ended deadline.
  - Inputs and buttons take the primitive sizes (48 px; `icon-sm` for a remove). Save is `default`, Add a topic and Add a deadline are `soft`, Clear all is `destructive-soft` and keeps its dialog (texts, first focus, the `pending` lock).
  - The member view (`UrgencyReadOnly`, `VipLine`) uses the same rows with plain text; its link to the VIP card (`#rules-vip`) stays.
  - The dirty-state logic (`useDraft`, `isDirty`), the toasts and the error texts do not change.
  - Below `sm` the fields of a row stack; no sideways scroll at 320 px.
- **Texts:** none new expected. Remove emoji from the `urg_*` texts if any are there.

## Tests

1. `urgency-card.test.tsx` keeps its cases; add one: the owner form renders the two `h3` headings by id and one remove button per topic with the accessible name `urg_topic_remove`.
2. `urgency.spec.ts` and `urgencyzz-review.spec.ts` pass with today's locators (`data-card="urgency"`, the aria labels, `data-ended`). A locator that must change is named in the final message.
3. Their a11y scans pass on both projects; mobile project: `scrollWidth <= innerWidth` on `/rules` with two topics.

## Docs

`docs/capabilities/web-panel.md` rule 9 and `trust.md` only if a sentence names the look. No user docs page (D19).

## Out of scope

The urgency profile, its API and its checks; the page frame (stage 06).

## Done when

Tests 1–3 pass; you opened the sheet pictures of `rules` with the flag `urgency_editor` on, or the e2e pictures of `urgency.spec.ts` if the sheet has no such state (say which); Proof B with `urgency.spec.ts urgencyzz-review.spec.ts` prints `PROOF_OK`.
