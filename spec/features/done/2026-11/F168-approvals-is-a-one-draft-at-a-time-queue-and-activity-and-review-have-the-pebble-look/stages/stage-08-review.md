# F168 stage 08 — The review page ("Was I right?")

Needs F166 stage 06: `CategoryPill`, `ProgressRing`. Needs F166 stage 09: `AppShell` `lead`. Needs F166 stage 10: `EmptyState`. May run next to 01, 02, 03, 04, 06.

Part of [`../plan.md`](../plan.md): P14, D7. Stage 07 waits for this stage. The page reached from the report ("Check 10 decisions" today) gets the Pebble look: cards, a progress ring, category pills and a one-tap correction menu.

## Step 1 — Head, progress and states

- **Files:** `islands/ReviewPage.tsx`, `components/review/ReviewContent.tsx`, `i18n/texts/en-reply.ts`, `pl-reply.ts` (the `rv_*` keys and `title_review`).
- **Decisions:**
  - Title: "Was I right?" in `en`. The Polish title has no first-person past tense (PB-8), for example "Czy to była trafna ocena?". The shell keeps `active="settings"`: the page has no nav item (PB-4).
  - `lead` = today's `rv_intro` text, as one line; the intro paragraph in the content goes.
  - At the top of the content: a `ProgressRing` with `value` = answered, `max` = total, its `label` = the `rv_progress` text, and the text beside it. The element keeps `data-review="progress"`.
  - Empty sample: `EmptyState` with the `rv_empty` text and the back link to the report as its button; the element keeps `data-review="empty"`. The done state: `EmptyState` with the `rv_thanks` text and `rv_back`; it keeps `data-review="thanks"` and `role="status"`.
  - No mailbox: `EmptyState` with `rv_no_mailbox` and the button to `/mailboxes`. Flag off (`rep_off`): `EmptyState`, no button. The mailbox selector stays above the cards when there are 2 or more mailboxes.
  - `data-review-state` on the root keeps its values.
- **Test:** (1) the existing `lib/review-view.test.tsx` passes with only text changes. (2) A render test: 10 items, 2 answered → the ring has the accessible name "2 of 10 answered" (`en`).

## Step 2 — Cards and the correction menu

- **Files:** `components/review/ReviewContent.tsx` (the card), the same text files.
- **Decisions (mockup `03-review-*`):**
  - Cards in one column below `lg`, two columns from `lg` (DB-6; three columns are too narrow at 1024 px with the sidebar). Each card: a `CategoryPill` with the category name (`act_cat_*`, no emoji), the confidence text `rv_sure` as today (no dots), time and sender, the subject as the card title, the AI text when present. The card root keeps `data-review-item` with the email id.
  - "Right" (`default`, `Check` icon; `rv_right` loses its emoji) shows under today's `canConfirm` rule.
  - "It is something else" (`secondary`, a chevron) opens a `DropdownMenu` of `pickCategories()` (today's list, with today's delegation rule). Each item shows its `CategoryPill`. A pick saves at once (P14; `questions.md` Q1); the menu closes and the card shows its answer line (`data-review="answer"`, `role="status"`). `rv_pick_label` names the menu button for screen readers; `rv_pick_none` and the Save button go (no reader).
  - An answered card gets the soft teal tint (`bg-primary-soft`) and locks, as today. The "Done" button (`rv_done`) and its rule stay.
  - D7: this stage reads `categoryName` (`act_cat_*`), not `categoryTagText`. It edits no Activity file and deletes nothing there (stage 07 does).
- **Test:** (3) in `lib/review-view.test.tsx`: no value of a `rv_*` key or of `title_review` in `en` or `pl` matches `/\p{Extended_Pictographic}/u`; break one value once and see it fail. (4) A render test: an item with category `unsure` has no "Right" button; the menu of a sample with `delegation: false` and a non-delegation item lists 5 categories without `delegation`.

## Spec, docs

`e2e/tests/review.spec.ts`: RV1–RV7 keep their meaning; the correction steps use the menu (`menuitem` named by the category) in place of the select and Save. `report.spec.ts` (the link to the page) passes unchanged. `docs/capabilities/web-panel.md`: the review rules. The new page name also replaces "Check 10 decisions" in `docs/capabilities/trust.md` and `triage.md`. No user docs page covers this page today; add none (`questions.md` Q4).

## Out of scope

The report page and its link (F170). The Telegram `/review` command. A new metric or "approved this week" (PB-7).

## Done when

- Tests 1–4 pass; contact sheet pictures of `review` read next to `03-review-*`.
- Proof of `../plan.md` with the specs `review.spec.ts report.spec.ts` prints `PROOF_OK`.
