# F110 stage 21 — "What is urgent for me" editor

Part of [`../plan.md`](../plan.md). Web stage. Flag `urgency_editor`. Polish text: review by `claude-opus-5-5`.

## Step 1 — The card on the Rules page

- **Goal:** an owner edits the urgency profile of a mailbox in the panel (P7, PD-017; E4 discovery decision 13).
- **Files:** a new card in `RulesPage.tsx` (or a component next to it); page keys en and pl. The server side exists: `PUT /settings/:mailboxId/urgency` (owner only, `urgencyBodySchema`), and `urgencyProfile` in the settings view (scout 4, seam b).
- **Decisions:**
  - Per mailbox (the classifier works per mailbox): a mailbox select when the org has several.
  - Topics: a label (1–80) and up to 10 keywords (1–40 each); deadlines: a label (1–80) and a date. At most 20 of each (`URGENCY_MAX_ITEMS`). The limits come from `urgencyProfileSchema`; the card validates with the same schema before it sends.
  - A deadline whose date has passed shows struck out with the text "ended"; the card does not delete it. (The prompt use drops it after its date: E3b's code; read `triage/classifier.ts` to confirm and say so in the final message.)
  - VIP people: a line "VIP people are your VIP sender rules" with a link to the VIP rules on the same page (no second list).
  - "Clear all" sends `{ profile: null }` after a confirm dialog.
  - A member sees the card read-only (as other Rules cards).
  - The text the user writes reaches the prompt through the untrusted-text marking (E3b, landed); no new rule here.
- **Test:**
  1. e2e: add one topic with 2 keywords and one deadline, save, reload → both show; the settings view returns them.
  2. e2e: a label of 81 characters → the form shows the error and sends nothing.
  3. e2e: a seeded deadline of yesterday → struck out with "ended".
  4. e2e: member login → no save button.
  5. `expectNoA11yViolations` on the Rules page with the card; keyboard reaches add, remove and save.

## Done when

- Flag off → the Rules page looks as today.
- Proof (`s21`, with the web part) prints `PROOF_OK`.

## Out of scope

Prompt changes, urgent recall measures (E3b). VIP rule editing (exists).
