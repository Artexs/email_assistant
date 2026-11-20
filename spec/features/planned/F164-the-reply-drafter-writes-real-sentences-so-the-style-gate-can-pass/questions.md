# F164 · Questions (defaults taken)

No blocking question. Each item is a default the plan builds on; the owner can undo it.

1. **[important: user-visible]** P2: drafter-v5 becomes the production drafter when its holdout gate passes, the injection set passes 14 of 14 and the commitment traps show 0 invented commitments, also when the style smoke fails. Reason: full sentences are the first outcome of the ticket; the owner called the v4 skeletons possibly "too bare" (F115 `tuning-4.md`). Undo: keep `prompts.drafter` on `drafter-v4` (one line and its test).
2. **[important: production]** D10: the pointer change reaches the VPS with the next normal release, also before or during the F115 pilot; the flag `reply_drafts` is off for every organization, so the pilot gets v5 drafts from its first day. Undo: hold the release, or revert the pointer before it.
3. **[important: money]** P3: at most $2.00 of model runs for the ticket ($1.10 stage 04, $0.60 stage 05), on the shared OpenAI key, at 2 parallel calls and 30 per minute; the first HTTP 429 stops the run. Undo: raise or lower the caps in the stage files.
4. **[important: scope]** P4: no style holdout runs and no full `eval:style-gate` in this ticket. When the smoke passes, the next step is a new ticket that runs the F122 holdout A/B (about $0.90) with drafter-v5. Undo: add those runs to stage 05 and its cap.
5. **[minor]** D3: the `reply-facts` set runs with no judge bar, because the judge does not see the instruction line. The worker reads its 12 drafts for added commitments instead. A judge that sees the instruction is a separate judge ticket.
6. **[minor]** D6: the smoke stays at the 20 dev cases and the style file of F122 run 4, so the v4 result (1.85 / 1.85) is the base. The 20 cases are seen during tuning; the report says so.
7. **[minor]** D9: the lab-01 holdout gets its fifth drafter use. No rule limits the count; a later drafter change may need a fresh holdout (a corpus question for the lab, not this ticket).
