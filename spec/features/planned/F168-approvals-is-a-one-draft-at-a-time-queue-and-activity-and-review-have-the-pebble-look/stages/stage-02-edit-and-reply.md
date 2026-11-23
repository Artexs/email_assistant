# F168 stage 02 — Edit dialog and reply-draft controls

Needs F166 stage 03: tokens. Needs F166 stage 10: `FactBox`, `RowList`, `Row`. May run next to 01, 03, 06, 07, 08.

Part of [`../plan.md`](../plan.md). This stage changes the look of the "Change" dialog and of the controls of a reply draft. Their props, their requests and their rules do not change: the page (stages 01 and 04) mounts them as today.

## Step 1 — The edit dialog

- **Files:** `components/approvals/ApprovalEditDialog.tsx`.
- **Decisions (patterns of the mockup; the dialog has no drawing, PB-3):**
  - The dialog title stays `appr_edit_title`; the discard dialog stays `appr_edit_discard_title` (specs read both).
  - Fields: subject `Input`, body `Textarea` (at least 12 rows from `lg`, 8 below; `text-base`), the delegate `Select` of a delegation edit. Each with a visible `Label`, its limit text under it.
  - Below `lg` the dialog fills the screen width with a 16 px margin and scrolls inside; Save and Cancel stay at its bottom edge.
  - Save is the `default` button; Cancel is `ghost`. Every error text, the 409 `changed` path ("open the newest version") and the closed-send path keep their behaviour and keys.
  - The note `appr_edit_no_remove` (the old Drafts copy stays) and the quote note are `FactBox` notes.
- **Test:** (1) the existing tests of `lib/approvals-edit.test.ts` pass unchanged (no rule moves). (2) A render test: the dialog of a delegation with 2 delegates shows a labelled subject field, a labelled body field and a delegate select whose name is its label.

## Step 2 — Reply-draft controls

- **Files:** `components/approvals/ReplyControls.tsx`, `i18n/texts/en-reply-panel.ts`, `pl-reply-panel.ts` (only the keys these controls read).
- **Decisions:**
  - The controls sit in a `RowList` inside the card, under the draft body: row 1 "Redraft with a line" (the instruction field, then the Redraft button, `secondary`); row 2 the recipient buttons of today (`rp_reply_all`, `rp_use_reply_to`), shown only as today's rules say. The `replyAllAdds` addresses show in the row hint before the tap, as today.
  - The redraft limit (`redraftsLeft`) is a row hint; at 0 the field and the button are off and the hint says why (today's key).
  - "Drafting…" while a redraft waits: the button shows a spinner icon and the text, and stays off (today's `waiting`).
  - The DOM order stays: instruction field, Redraft, then (later in the card) the decision bar. `reply-panel.spec.ts` T4 checks the keyboard order.
- **Test:** (3) a render test: `redraftsLeft: 0` turns the field and the Redraft button off and shows the limit text. (4) With `replyAllAdds: ["b@example.com", "c@example.com"]` the hint lists both addresses before the Reply all button.

## Spec

- **Files:** `e2e/tests/reply-panel.spec.ts` (this stage owns it until stage 04 takes it over).
- Change locators only where the look changed the role or the name. T5–T7 (the Draft reply action on an Activity row) do not change here.

## Out of scope

The card, the list, the decision bar (stages 01 and 04). The props of both components and `use-reply-actions.ts`. The Activity `DraftReplyAction` (stage 07).

## Done when

- `reply-panel.spec.ts` and `approvals.spec.ts` pass on both projects.
- The contact sheet pictures of `approvals` with a reply draft and with the edit dialog open (if the sheet has no state with the dialog open, say so in the final message and give a screenshot from the spec run instead).
- Proof of `../plan.md` with the specs `approvals.spec.ts reply-panel.spec.ts` prints `PROOF_OK`.
