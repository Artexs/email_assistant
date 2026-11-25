# F168 questions

Defaults taken by the planner (2026-11-24). None blocks a stage. The coordinator copies the `[important]` ones to `docs/owner-decisions.md`.

1. **[important: user-visible] Review correction saves on one tap.** "It is something else" opens a menu, and a pick saves at once, like the Activity picker. Today the page has a select and a Save button. Cost: a review label after a grant feeds the tripwire (`docs/capabilities/trust.md`), so one mis-tap can pause automatic moves for a category, and the card then locks. Default: one tap (plan P14, stage 08). Undo: put the select and Save back in `ReviewContent.tsx`.
2. **[important: user-visible] Lock times of the queue.** After an outcome the card stays 1.5 s with the decision buttons off; a new card's buttons arm after 0.5 s (plan D3). Default: 1500 ms and 500 ms. Undo: the two constants in `lib/approvals-queue.ts`.
3. **[minor] A settings help text changes in a file of another ticket.** The help text that says "Rate mails with ✅ or ✏️ … on the Activity page" turns false. Stage 07 changes only that value in `en-settings.ts` and `pl-settings.ts` (the settings ticket owns these files). Default: change it in stage 07.
4. **[minor] No user docs page for the review page.** None exists today. Default: add none in this ticket.
5. **[important: rule-exception] The Activity texts lose their emoji, the Telegram texts keep them.** A test ties the web texts to the core Telegram texts word for word. Default: the tie stays for the words; the test drops the core's leading emoji before it compares (plan D10, stage 07). Other option: remove the emoji in Telegram too (a change of the bot, out of scope).
6. **[important: scope] No user docs for the approvals panel in this ticket.** The page is behind the default-off flag `approvals_page`, and the docs site rule keeps the strings of a default-off flag off its pages. Default: the user docs wait for the flag removal (plan D11). This is a deviation from programme decision DB-11 for this one page.
7. **[minor] Queue order.** The queue uses the API order (newest first). Default: no client sort by expiry.
8. **[minor] Held sends are not in the queue.** They show as a second group of the waiting list ("Approved, not sent yet"), and a pick opens one with only "No". Default from the programme analysis.
9. **[minor] Review cards use two columns from `lg`, not three as in the mockup.** Three are too narrow at 1024 px with the sidebar.
10. **[minor] Activity category and mailbox filters stay selects.** Nine category values do not fit as chips at 320 px. Range and "Only not rated" become chips.
11. **[minor] Titles.** Approvals and Activity keep their titles (the mockup's "Good morning, Marta" and "What I did" break PB-8). Review becomes "Was I right?"; the Polish title has no first-person past tense.
