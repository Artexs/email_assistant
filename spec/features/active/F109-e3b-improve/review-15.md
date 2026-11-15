# F109 stage 15 review (Opus 5.5, PASS 98624330)

Model: Opus 5.5, because the stage sends a message to people and has Polish text. No BLOCKING.

Fixed in one Sonnet continue (no re-review): merge conflict in `main.ts` (N1: master removed `configHint` and `provider` of `createLlmPause`); TG1 (the `status = pending` filter of `listWaitingFromSenders` had no test); TG2 (a sender on both a whitelist and a blocklist gets a notice: whitelist wins, as in `applyHardRules`).

Verified: org scope of all 3 reads, view holds only emailId, mailboxId and sender (address cut to 40 chars), no log line holds address or subject, consent: NO bump (the consent text names the sender), `pausedSince` is the first trip, flag `degraded_notice` off by default (only in `LAB_FLAGS_ON`), en/pl text, kind lists and renderer, no new migration.

Notes:
- N2: `not-triaged.ts` sends to every linked member and does not check `linkedAt` (urgent.ts does). Deliberate; the notice tells the current state.
- N3 (plausible): `pausedSince` is cleared only by `reset()` after an LLM answer. If the released mail is deleted before the retry, a later pause keeps the old `since`, so it can get fewer than 5 notices (fails toward fewer messages).
- N4: D17 says "at most 5 rows per mailbox"; the code caps at 5 mails per mailbox and each member gets a row per mail. Stage 16 docs must say "5 mails".
- N5: a row queued shortly before quiet hours is held until 07:00 and may be out of date by then (accepted).
- The worker's 10 mutation logs do not record their edits (names only); judged plausible.
