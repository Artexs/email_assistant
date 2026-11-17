# F116 stage 19: Telegram taps (worker notes)

Decisions the worker took where the stage text left a gap. The coordinator may change any of them.

1. **Which message a tap edits.** The Telegram update carries the id of the tapped message. `UpdateHandlers.callback(link, data, source?)` now gets
   `source.messageId` (`TapSource`, `channels/port.ts`). The handler finds the stored digest row by `external_message_id`, the user and the
   link time, and edits one line plus its buttons. The edit is stored back in `outbox.text` / `outbox.buttons`, so a second tap on another line
   keeps the first mark.
2. **Which line.** The digest view has a new optional key `lineOf` (loop or delegation id → line number, numbers only; no text). A digest
   queued before this stage has none: the tap still acts, the buttons go, the text stays. Retention and erase set the view to `{}`, which clears it.
3. **`dd:` on a ⏳ delegation line only while the delegation is `overdue`.** `closeDelegation` closes only `answered` and `overdue`. A `sent` delegation
   would answer "not answered yet" on every tap, so it has no button. The stage text said "Delegation lines: [✓ Done]". The dd tap on a digest
   never uses the edit of the "delegation answered" notice (its text would replace the digest).
4. **🔴 urgent and ✍️ waiting-on-you lines have no buttons** (stage text names none). An urgent mail in the brief leaves the normal list, so it has no
   `[👥 n]` in that digest; the urgent notice has `[👥 Delegate]`. Review 18 N9 (🔴 rows lose the feedback buttons) is the same gap and stays open.
5. **The button rule for Delegate** also needs "no suspicious reason", read with `suspiciousReasonsOf` (flag-independent, as `delegateMail` does), so the
   button is hidden for the mails that the command refuses.
6. **Draft button** = mailbox in `assist` with `create_draft` on, no follow-up waiting for a tap, fewer than two sent, loop kind not `promised`.
7. **Review 18 N4** (digest ended `failed` gives its marks back): done in `failOutbox` and `cancelPendingOutboxOfOrg` (`releaseBriefMarks`): the mark goes back
   only when it equals the time of that digest and no other digest that is not `failed` names the loop. The expiry sweep and `clearLoopCards` do not release.
8. **Review 18 N5** (first digest of the day): decided by the date of the slot (`isFirstDigestOfDay(trx, ctx, { userId, slotDate })`), no clock arithmetic, so a
   20:00 slot run at 01:00 is not a second brief and a missing midnight needs no `localInstants`. The older tests of the local day were rewritten.
9. **Review 18 N6** (several members): kept as it is. The ⌛ mark is one column, so only the first digest that commits shows a ⌛ line. The others see the closed loop in the
   panel. A per-member mark needs a table; ask the owner if this is not enough.
10. **Role texts.** Not-allowed answers of Draft, Drop and Reopen use the owner-only text of the loop taps ("Only an owner can do this."); the role check runs before
    any query, so an unknown id gets the same text for a member.

Open items, not done in this stage: no visual check of the live Telegram chat (stage 25); Reopen refusal text exists ("This loop cannot be reopened.");
the panel text for the same refusal is for stages 20-22.
