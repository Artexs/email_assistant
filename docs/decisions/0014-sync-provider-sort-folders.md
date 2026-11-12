# 0014 — The sync reads INBOX and the provider's sort folders and spam folder

- Status: accepted (user, 2026-11-08, plan approval; checkpoint 1 on 2026-11-09 added U11)
- Date: 2026-11-09
- Amends: 0010 (the old pipeline rule 1 in `docs/architecture.md` §4.1: INBOX only)

## Context

Interia sorts new mail into tabs. A tab is an IMAP folder: `Oferty`, `Społeczności`, `Rachunki` (no special-use flag).
Its spam folder is `Wiadomości-śmieci`. The sync read only INBOX, so it never saw this mail.
In real use, a manager gets mail in all of these folders, and a valid mail can land in the spam folder by accident.
The test tool showed the same: all AgentMail test mail lands in `Oferty`.
A `UID COPY` into INBOX goes back to `Oferty` (F8). A move into INBOX is no fix.

Facts (checked 2026-11-08 and 2026-11-09; the task file holds them, one source):

- F1: the folder names and their LIST attributes. F2: Interia gives UIDVALIDITY 1 and a wrong STATUS `UIDNEXT` (1) for every folder.
- F3: one UID counter for the whole mailbox. F4: the volumes (about 10 INBOX mails and 7 sort folder mails a day; the spam folder gets almost none).
- F12: a COPY into `Oferty` is sorted into INBOX; an APPEND into `Oferty` stays; a COPY into `AI/*` and into `Wiadomości-śmieci` stays.
- Notes: `notes/2026-11-03-interia-imap-capabilities.md` (§ "Sort-folder probe") and `notes/2026-11-07-agentmail-test-mail.md` §10.

Task file with all decisions (D1–D24), user decisions (U1–U11) and the stage results: `tasks/done/sync-sort-folders.md`.

## Decision

Short form. The task file has the full text of each decision.

- **Which folders (D1, D2, U1).** The table `mailbox_folders` holds one row per synced folder: `key`, `path`, `role` (`inbox`, `sort`, `junk`), `enabled`, and its cursor.
  A provider constant `SYNC_FOLDER_DEFAULTS` (`packages/core/src/mail/sync-folders.ts`) names the defaults: `offers`, `social`, `bills` (role `sort`) and `junk` (role `junk`).
  The job inserts a row for a default path only when the server lists that exact path. It never picks `AI`, `AI/*`, Sent, Drafts, Trash or a user folder.
- **Cursor (D4, D5).** One UID cursor and one UIDVALIDITY check per folder. One run per mailbox goes folder by folder: INBOX, the `sort` rows, then `junk`.
  An error in a folder other than INBOX gives a `warn` line, and the run goes on. A folder that fails 3 runs in a row gives one `error` line.
- **Folder status (D4).** `folderStatus` returns `highestUid` (the UID of `*`) and a `uidNext` that is never below `highestUid + 1`,
  because Interia gives `UIDNEXT` 1 for every folder (F2). The cursor of an empty first sync is the highest UID.
- **Dedup (D7).** A mail that the user moves between synced folders is not stored twice. A mail in two synced folders is stored once (`cross_copy`).
  The move marker `undo_pending_at` stops the sync from storing a copy while a system move runs (D9).
- **Spam folder mail (D11, D12, U5, U6, U10).** It goes through the normal pipeline (rules, classifier, policy). `spam` stays in the spam folder.
  `info` and `notification` move into `AI/*`. `urgent`, `needs_reply` and `delegation` get a move into INBOX (the "rescue"), under the normal move gate
  (`assist`, the `move` switch, the category `auto`, not VIP). A `delegation` mail gets no draft, no send and no approval message.
- **Transfer (D12, U11, F7, F8, F12).** The rescue and an Undo into a `sort` folder use `transferByAppend` (APPEND of the raw source, then `UID EXPUNGE` of the source),
  because Interia sorts a COPY back. Other moves use MOVE or COPY as before. Undo returns a mail to its `source_folder`, not to INBOX (D10).
- **No push for spam folder mail (D23).** The urgent notice skips mail from the spam folder. The mail shows in the digest.
- **No separate LLM limit (D14).** The spam folder gets almost no mail (F4), so the daily cap of 300 is enough. Follow-up: `tasks/planned/junk-llm-cap.md`.
- **Off switch and tools (D16).** `mailbox:settings sync-folder --key offers|social|bills|junk --value on|off`. INBOX has no switch.
  `mailbox:audit` and `mailbox:rescan` work per folder. `mailbox:backfill` stays INBOX-only.
- **Migration (D3, D17).** `sync_folders` only adds (the table, `emails.source_folder`, a new index). The INBOX cursor is also written to
  `mailboxes.uidvalidity` and `mailboxes.last_uid` (dual write), so the old code runs after a code rollback.
  The rule "Roll back the code, not the migration" holds.

## Consequences

- One cursor per folder. A new sort folder row starts with the last 24 hours (U3). A UIDVALIDITY change rescans only that folder (7 days).
- The Interia `UIDNEXT` rule (D4) applies to every folder. A new provider needs its own `SYNC_FOLDER_DEFAULTS` and its own check of the `UIDNEXT` and COPY behavior.
- The columns `mailboxes.uidvalidity` and `mailboxes.last_uid` and the names `emails.inbox_uid` and `emails.undo_pending_at` stay for now
  (`inbox_uid` means "the last known UID in `source_folder`"). The follow-up `tasks/planned/drop-mailbox-cursor-columns.md` renames and drops them after the pilot weeks.
- The pipeline rule 1 of `docs/architecture.md` is now: the system reads INBOX and the synced folders of `mailbox_folders`.
  It never reads `AI/*`, Sent, Drafts, Trash or the user's own folders.
- **Known limits (D24).** The system does not fix them in this change.
  - (a) A return into a synced folder that is not the row's source, below that folder's cursor, is not seen (Interia keeps the UID).
  - (b) A mail that the user moves between two synced folders in the seconds between two passes of one run is not stored.
  - (c) After a user move out of `Oferty` into INBOX, the Undo is a COPY into INBOX, which Interia sorts back.
  - (d) After a code rollback, the old code ends a `ready` move `{ folder: "inbox" }` as `bad_payload` and sends an Undo of `Oferty` mail to INBOX.
    An Undo of a rescue ends `applied` with no IMAP change, and the mail stays in INBOX.
  - (e) `mailbox:audit` shows a cross copy as `cross`, not as `missing`.
  - (f) A spam folder mail that the user moves into INBOX by hand keeps its UID, so it is below the INBOX cursor. The row keeps the old folder; the mail is fine.
  - (g) A user move between two synced folders, of a mail that the system did not move, is not seen when its UID is below the target cursor.
    The row keeps its old folder, and an action on it ends `mail_not_found`. Follow-up: `tasks/planned/sync-return-to-other-folder.md` (covers (a) and (g)).
  - (i) A rescue that goes back to `ready` and then expires (`expireStaleReady`, or `mailbox:settings switch --name move --value off`) keeps `undo_pending_at` for up to 24 h.
    The sync stores no copy of that mail meanwhile. Rare; accepted.
  - (h) The Interia SEARCH misses a mail that its sorter moved after a COPY. A locate without a UID hit, `fetchSince` and `mailbox:audit` do not see it.
- **Accepted case: a double copy after an APPEND (group review 9–11).** The rescue and an Undo into a `sort` folder run as APPEND, then `UID EXPUNGE`.
  When the final try of such a move fails after the APPEND, the mail stays in both folders. The sync (move marker set) has moved the cursor past the new copy,
  so it does not store that copy as new mail. The `action_failed` notice tells the user, and the user deletes the extra copy by hand.
