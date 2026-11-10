> **Status 2026-11-07 — planned.** Idea from the S3 stage 5 review (Opus, high).

# Sync: a return of a later copy when two copies are in one folder

`decideIncoming` (`apps/server/src/modules/mail/sync-rules.ts`, S1a rule, kept by S3) checks only the lowest-numbered known copy in a folder. Case: rows `#1` and `#2` of one identity are both in `AI/Spam`; the user moves `#2`'s copy back to INBOX while `#1` stays. The sync then stores the incoming mail as `#3` and triages it again; `#2` keeps a stale location and gets no `returned_at`.

Rare (two identical copies moved to one folder, then one put back). Possible fix: in `check_folder`, when the chosen copy is still there, also try the other copies in folders (with `excludeUids`) before `new #n`. Add a sync test for the case first.

Update 2026-11-09: the rules are per synced folder now (a cursor for each folder of `mailbox_folders`); see [`../active/sync-sort-folders.md`](../active/sync-sort-folders.md).
