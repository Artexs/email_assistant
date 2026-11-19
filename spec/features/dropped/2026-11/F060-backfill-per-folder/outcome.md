# Outcome

Dropped on 2026-11-20 (owner default, `notes/2026-11-20-replan-parallel.md` § 9 item 4). Nobody asked for old mail of a sort folder since the sort-folder sync landed (2026-11-09). The board line "folded into F110" was wrong: the earn-trust ticket's history check (F110 stage 05) reads INBOX only and lists the other folders as out of scope. Reopen a ticket when an operator needs the older mail of `offers`, `social`, `bills` or `junk`; the seam is `backfillInbox` in `apps/server/src/modules/mail/sync-backfill.ts` and `mailbox-backfill.ts`.
