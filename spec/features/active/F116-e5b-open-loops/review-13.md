# F116 stage 13 review (Opus 5.5, PASS a8adebec)

Model: Opus 5.5, because the stage is [risky] (a false close hides a slip; sending, exactly-once). No BLOCKING. Locks proven: `applyToLoop` locks the loop, decides again on the locked row, closes, audits and expires sends in one transaction; app role, table owner and mixed pairs pass; the race against `onSentOff` and the committer shows no deadlock. `expireFollowUpSends` without a card edit is safe (an expired send cannot be approved; a claimed one stops at `isOpen`); the card edit stays with stage 11. Six surviving worker mutations are equivalent (m11/m12 pair, m25/m26 pair, m18 and m22 by composite FKs); reviewer mutation r4 (no `isOrgSuspended`) is equivalent too.

Fixed in a Sonnet continue (no re-review): TG1 (own-address mail in the thread with `isOpen`: test), TG2 (committer race test asserts `applied === 0` and no SMTP send), r5 (the received-order test uses ids that sort against received order), N1 (`MAX_CANDIDATES = 200` hides a reply forever: run the thread/Message-ID query and the recipient query apart, each with its own limit; probe test), N3 (out-of-office subjects without Auto-Submitted: Automatic reply, Autoreply, Out of office, Odpowiedź automatyczna, Nieobecność prefixes count as auto), N4 (subject prefixes AW, SV, WG, TR, Antw, Re[2], `[EXT]` tag, trailing dot: safe direction, add), N5 (mail in a Junk folder or spam category never closes a loop).

Carry-over (not done here):
- N2 (a false close, owner question): a reply from an alias of the user (not a mailbox address) closes the loop. The plan defines own addresses as the org's mailbox addresses only. Idea without a new table: count as own every From address seen in the mailbox's own Sent rows. Decide in stage 14 or ask the owner.
- N6: a reply that arrives during the SMTP call falls before the new `wait_from_at` and is not counted (very small window).
- Stage 11/14: the card edit on expiry.

## Update from stage 14 (worker)

N2 is done in stage 14: own addresses are the mailbox addresses of the organization and every From address of the Sent rows of the mailbox (`ownAddressesOf(db, ctx, mailboxId)` in `loops/match.ts`; tests `loops-match-aliases.test.ts`). It fits the stage: no new table, one read per run, and a wrong entry only hides a reply. N6 (the SMTP window) stays open.
