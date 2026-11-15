# F116 · Questions and defaults

Part of [plan.md](plan.md). Each item is a default the planner took (the owner said "go with defaults"). None blocks a stage. The coordinator copies the `[important: …]` items to `docs/owner-decisions.md` when the plan lands.

1. **[important: scope] 25 stages, not about 22.** A follow-up answers the user's own sent mail, and every action row today needs an incoming mail (F2). Stages 09–11 add a second anchor (`actions.loop_id`), with a second migration in stage 09. Default: build it (D4). Option: follow-ups only in threads that hold an incoming mail; it misses every new thread the user starts.
2. **[important: user-visible] Hand forwards are loop rows, chased with the follow-up template.** A mail the user sent to an active delegate that asks for something becomes an `open_loops` row of kind `delegated`. It shows under Delegated, and the one chaser plans its follow-up (quote of the user's own mail, to the delegate) in the daily reminder set. Default: D2, D13. Option: a `delegations` row with nullable mail and action ids (the reminder template, a larger change of every delegation reader).
3. **[important: privacy] Consent bump with a send-side gate.** Loop lines and follow-up cards show recipients, the ask and the promise of the user's own sent mail. Stage 17 bumps the consent version; a user with an older consent sees only counts and a panel link until they agree again in the panel. Default: D17 (same rule as the F115 plan). Option: no bump (the owner's 2026-11-15 rule says a bump is needed).
4. **[important: privacy] "Track my sent mail" off keeps closed loop rows without text.** Off closes the open loops of the mailbox (`sent_off`), clears their texts and expires waiting follow-ups. The rows stay for M2 and the audit. Default: D18. Option: delete the rows (M2 loses the history of that mailbox).
5. **[important: user-visible] "Waiting on you" section.** `needs_reply` mail of the last 14 days that has no `\Answered` flag and no own sent mail later in its thread. With the Sent switch off only `\Answered` counts. Default: D16, stage 18.
6. **[important: user-visible] Where the Delegate button shows.** On the rows of the action section of the digest (urgent, needs reply, unsure) and on urgent notices, only when the organization has an active delegate and the mailbox is in `assist` with drafts on. Default: stage 19. Option: every row (Telegram allows at most 8 buttons per line; two rows share a line today).
7. **[important: money] Extractor eval spend.** Stage 06 runs dev and holdout with `--budget-usd 1` each, at most one rerun of each after a prompt change (≤ $4 in total), inside the lab's $1-per-run rule and the $20 month cap. No judge is needed (labels are exact). Default: stage 06.
8. **[minor] Task text of a Delegate-button delegation.** The stored triage summary of the mail, else its subject; no new LLM call. Default: stage 16.
9. **[minor] Auto-reply test.** `Auto-Submitted` other than `no`, `Precedence` `auto_reply`/`bulk`/`junk`, or a `mailer-daemon`/`postmaster` sender. `X-Autoreply` and DSN types are not captured today (F5). Default: D10.
10. **[minor] Who may tap.** Done and Later: any linked member. Draft follow-up, Drop, Reopen, Untrack, Delegate: owners. Default: D11.
11. **[minor] Promised lines** get Done and Drop only, no Later (PD-122 text). Default: stage 18.
12. **[minor] Urgent section** = urgent mail of the digest window without an own answer; the normal list leaves those rows out. Default: stage 18.
13. **[minor] Delegate picker** shows up to 8 active delegates by name; more → a panel link line. Default: stage 19.
14. **[minor] M2-surfaced for loops** = `surfaced_at` ≤ due + 1 working day, the same rule as delegations at `HEAD`. Default: stage 23.
15. **[minor] Extractor input** = the body cut to 8,000 characters. Default: D6.
16. **[minor] Job name.** `delegation.chaser` stays an alias of `loops.chaser` for `job:run` until the docs stage of the next release. Default: D3.
