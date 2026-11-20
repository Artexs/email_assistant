# F122 · Questions (defaults taken, owner to confirm)

Part of [plan.md](plan.md). No blocking question. Each item: the default and how to undo it.

1. **[important: user-visible]** D5: fewer than 5 usable sent mails (after the quote cut) gives "Not enough sent mail yet" and no model call. Undo: change `STYLE_MIN_SAMPLES`.
2. **[important: money]** D9: at most 3 suggestion runs per mailbox per quota day; each run counts in `LLM_DAILY_CAP` as a tap. Undo: change the limit constant in stage 02.
3. **[important: privacy]** D3, D6: only the cut body text goes to the model; no subject, address, date or id. Recipient addresses are read only for the name check in our code. Undo: none needed; a wider input is a new decision.
4. **[important: privacy]** D10: when "Track my sent mail" goes off while a suggestion runs, the answer is dropped and the panel shows the switch-off text. Undo: remove the second switch read.
5. **[important: user-visible]** D14: after the contract step a new mailbox has no inherited organization signature; the fallback is the owner name. Existing mailboxes keep the copied text. Undo: none after the drop; before stage 05, keep the copy at mailbox create.
6. **[important: user-visible]** D13: `PATCH /api/organization` answers 400 for `styleText` after stage 04. The panel sends it no more since F115 stage 11. Undo: accept and ignore the key.
7. **[important: scope]** D15: the gate compares "no writing style" with the suggested style. It does not compare with a hand-written style. Reason: the suggestion is a cold start for a user with no style text. Undo: add a config C run (about $0.45 more).
8. **[important: money]** D15, stage 08 bars: gain = Wilson 95% lower bound of the win share of `style_match` (B over A, ties out) above 0.5, mean gain ≥ 0.1, at least 20 untied cases; no loss on facts by absolute bars and paired flip tests, as stage 08 lists. Undo: change the bars in `eval:style-gate` before the run.
9. **[important: user-visible]** D17: when the gate fails, the flag stays off and the code stays. No drafter change in this ticket. Undo: a new ticket for a drafter that shows style.
10. **[important: user-visible]** D6: the suggestion is written in the panel language of the owner who taps (pl or en), like the guided form. Undo: write it in the language of most samples.
11. **[minor]** D1: role name `stylist`, tier `light`, effort `low`.
12. **[minor]** D4: each sample ≤ 1,500 characters, all ≤ 60,000.
13. **[important: money]** D16: after the 20-case dev smoke, when the suggested style does not beat no style there, stage 09 stops before the holdout runs (saves about $0.88); the verdict is `fail (smoke)`. Undo: drop the futility stop and run the holdout anyway.
14. **[important: privacy]** D8: any owner of the organization may ask for a suggestion from any of its mailboxes, as with the mailbox profile. A mailbox has no owning user yet (F115 gap). Undo: limit it when the mailbox → user link exists.
15. **[important: rule-exception]** P3: `stylist-v1` lands in stage 01 without a gate file; stage 09 writes its evidence; the flag stays off until then. Undo: hold stage 01 until stage 09 passes (the prompt cannot be measured before it exists).
16. **[important: irreversible]** D13: stage 04 empties `organizations.style_text` after the copy. An organization with a signature text and no mailbox loses it (it signs no mail). Undo: none after the run; before it, keep the column filled until stage 05.
