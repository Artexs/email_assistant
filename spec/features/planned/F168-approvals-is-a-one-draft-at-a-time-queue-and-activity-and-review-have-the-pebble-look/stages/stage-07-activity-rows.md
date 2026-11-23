# F168 stage 07 — Activity rows, actions, panel and picker

Needs stage 06: `ActivityList` day groups (`li[data-email-id]` renders `ActivityRow`) and `activity.spec.ts` (shared file). Needs F166 stage 06: `CategoryPill`, `categoryLook`. May run next to 01, 02, 03, 04, 05, 08.

Part of [`../plan.md`](../plan.md): P13, D7, D8. The inside of a row, its actions, the side panel and the correction picker get the Pebble look; emoji leave the Activity texts.

## Step 1 — The row and its actions

- **Files:** `components/activity/ActivityRow.tsx`, `ActionButtons.tsx`, `DelegateAction.tsx`, `DraftReplyAction.tsx`, `lib/activity-text.ts`, `i18n/texts/*-activity.ts`, the two `rp_draft_reply*` values in `*-reply-panel.ts`.
- **Decisions (mockup `05-activity-*`):**
  - Leading: an icon tile in the category look (`categoryLook[category]`: its icon, its tone, `aria-hidden`). Line 1: the subject, bold. Line 2: the sender, then the phrase of what was done. Then a `CategoryPill` with the category name (`act_cat_*`), the confidence and the badges of today (sender rule, delegation, undo pending) as `Badge`s. The time sits at the end of line 1.
  - Actions stay on the row (P13), in today's order and with today's show rules: Right (`Check` icon), Correct (`Pencil`), Undo (`Undo2` icon and the visible text "Undo", `soft`), Delegate (`Users`), Draft reply (`PenLine` and its text). Icon-only buttons keep their `aria-label` keys and get a `Tooltip` with the same text. Each is 44 px (`icon-sm`, `sm`). Below `sm` the actions wrap to a line under the text; no sideways scroll at 320 px (DB-7).
  - A click on the row body still opens the panel; a click on an action does not.
  - `act_icon_right`, `act_icon_edit`, `act_icon_undo` go (no reader). The values of `act_tag_*`, `act_toast_right`, `act_toast_picked`, `undo_started`, `rp_draft_reply`, `rp_draft_reply_for` lose their emoji in `en` and `pl`.
  - D7: if no reader of `categoryTagText` and `act_tag_*` is left after your merge of `master`, delete them; while the Review page still reads them, keep them without emoji.
- **Test:** (1) in `lib/activity-text.test.ts`: no value of a key that starts with `act_`, of `undo_started` or of `rp_draft_reply*` in `en` or `pl` matches `/\p{Extended_Pictographic}/u`. Break one value once and see it fail. (2) The existing feedback-toast tests pass with the new values.

## Step 2 — Panel and picker

- **Files:** `components/activity/ActivityPanel.tsx`, `CategoryPicker.tsx`.
- **Decisions:**
  - The panel stays a `Sheet` (right from `lg`, bottom below). Its sections become `SectionCard`-like blocks with an `h3` each: why (the AI text, or `act_no_reason`, and the rule line, in a `FactBox`), what the assistant did, the delegation, your answer. The actions of step 1 sit at its end.
  - The picker stays a `Dialog` titled `act_pick_title`. Each allowed category is a full-width button with its `CategoryPill`; the AI's category says `act_pick_ai`. Cancel is `ghost`.
- **Test:** (3) a render test: the picker for an item with category `info` shows 5 category buttons (the `labelCategories` list of `@ea/core`) and one of them names the AI choice.

## Step 3 — The settings help text (D8)

- **Files:** `i18n/texts/en-settings.ts`, `pl-settings.ts`: only the value of the key that says "Rate mails with ✅ or ✏️ in Telegram or on the Activity page". The new value keeps the Telegram buttons as they are and names the Activity buttons by their text. Nothing else in these files (F170 owns them).

## Spec, docs

`activity.spec.ts`: the row and action tests change only their locators. `reply-panel.spec.ts` T5–T7 and the demo step 8 (Undo on `/activity`) must pass unchanged; a needed change there is a question. User docs: the Activity steps of `how-to/correct-a-category.mdx` and `explanation/shadow-and-assist.mdx` (and `pl/`) that show `✅`/`✏️` for the panel; the Telegram lines keep their emoji. `docs/capabilities/web-panel.md`: the Activity row rules.

## Out of scope

Filters, day groups, empty states (stage 06). The Telegram texts in `packages/core`. The Review page (stage 08).

## Done when

- Tests 1–3 pass; contact sheet pictures of `activity` read next to `05-activity-*`, with the panel open on one phone picture.
- Proof of `../plan.md` with the specs `activity.spec.ts reply-panel.spec.ts polish.spec.ts` prints `PROOF_OK`.
