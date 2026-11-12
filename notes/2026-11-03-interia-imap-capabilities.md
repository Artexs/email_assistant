# Interia IMAP capabilities (S1a stage 16.3)

Run date: 2026-11-03 (UTC), on the home VPS, image from master `UIDNEXT fallback` commit.
Account: the user's only Interia account (`artekstryszowski@interia.pl`). The user chose one account for real and test use (2026-11-03),
so `TEST_MAILBOX_ADDRESS` is this address, and the `--probe` run used it too.
Servers: IMAP `poczta.interia.pl:993`, SMTP `poczta.interia.pl:465`, both TLS with a checked certificate.
Secret kind: `password` (normal mailbox password). App passwords at Interia: not checked by the user yet (open, see ADR 0010).

## `mailbox:check` (read-only)

```
capabilities: IDLE=yes MOVE=no UIDPLUS=yes CONDSTORE=no SPECIAL-USE=no KEYWORDS=no
folder INBOX \Inbox
folder Wysłane \Sent
folder Wersje robocze \Drafts
folder Wiadomości-śmieci \Junk
folder Kosz \Trash
folder Oferty -
folder Rachunki -
folder Społeczności -
```

## `mailbox:check --probe` (writes a draft and sends one mail to self)

```
search-header: no
smtp-saves-sent: no
```

The probe mail `EA probe 6a8a502f-…` stayed in INBOX; the user deletes it by hand.

## Facts and what they mean

- **No UIDNEXT on SELECT.** Interia leaves `UIDNEXT` out of the SELECT reply. The first sync failed with
  `invalid input syntax for type bigint: "NaN"`. Fix: `inboxStatus()` in `apps/server/src/modules/mail/imap/client.ts` asks `STATUS (UIDNEXT)`,
  then uses the highest UID + 1, then 1 (see `docs/known-alerts.md`).
- **No MOVE, but UIDPLUS.** S3 moves with `UID COPY` + `\Deleted` + `UID EXPUNGE` (architecture §6.1). This is safe for the user's own `\Deleted` mail.
- **No CONDSTORE.** No cheap flag-change sync. S1a does not need it.
- **No SPECIAL-USE capability**, but `imapflow` still marks `Wysłane`, `Wersje robocze`, `Wiadomości-śmieci`, `Kosz` as `\Sent`, `\Drafts`, `\Junk`, `\Trash`
  (by name or by LIST flags). The folder map works for the Polish names.
- **No custom keywords** (`PERMANENTFLAGS` without `\*`). The system cannot tag mail with its own IMAP keywords; it uses folders and the DB.
- **`SEARCH HEADER` on a custom `X-` header finds nothing.** The system cannot find its own drafts or sent mail by `X-EA-Action-Id` on the server.
- **`SEARCH HEADER Message-ID` also finds nothing** (checked 2026-11-03 with a one-off read-only script in the server container:
  3 stored INBOX mails, raw id and id without `<>` → 0 matches; `SEARCH HEADER Subject "EA seed"` → 1 match).
  So `findByMessageId` always returns null at Interia. S1a is not affected; S3 must change it before the first move
  (`tasks/planned/s3-assist-actions.md`, "Input from S1a").
- **A move keeps the UID** (checked 2026-11-04). The user moved stored mail UID 38829 to a new folder `EA-test` and back: it came back as 38829.
  The probe mail moved from INBOX (UID 38831) into the new folder kept UID 38831 there (the folder had only that mail).
  This breaks the RFC 3501 rule that UIDs only grow. The sync cursor never sees a mail that comes back to INBOX. S3 input: `tasks/planned/s3-assist-actions.md`.
- **SMTP does not save sent mail.** After a send (S4), the committer must APPEND a copy to `Wysłane`.
- **IDLE works.** Push sync can come later.

## Move probe (S3 stage 1, 2026-11-07)

`bun run mailbox:probe-move` on the pilot mailbox (Mac, direct to `poczta.interia.pl:993`). One synthetic probe mail, cleaned up; notes empty.

- delimiter `/`; namespace prefix `""`, namespace delimiter `/`; MOVE no, UIDPLUS yes.
- **Nested folders need the parent first.** `mailboxCreate(["AI", "Probe-…"])` with no `AI` → `NO [ALERT]`. After `mailboxCreate("AI")` the nested create works (`folders.nested` true, `parentCreateOk` true). `ensureFolder` creates each level, parent first.
- `copy.uidMapReturned` true (COPYUID); `copy.sameUidAsSource` false (38914 → 38915): a protocol COPY gets a new UID, unlike a webmail move (2026-11-04: UID kept).
- After a COPY: `sameSize`, `sameInternalDate`, `sameEnvelopeDate`, `sameMessageId` all true → identity mode `strict`.
- `searchSinceInFolder.found` true.
- `expunge.otherDeletedKept` true (UID EXPUNGE removes only the given UID); `inboxOtherDeleted` 0; `inboxExpungeSkipped` false; `sourceGone` true.
- `moveBack.uidMapReturned` true; `moveBack.sameAsOriginal` false; `aboveUidNext` true (38918): a COPY back to INBOX lands above the cursor.
- The probe UIDs were consecutive across folders (38914 INBOX, 38915 probe folder, 38916/38917 mails A and B, 38918 INBOX): Interia likely has one UID counter for the whole mailbox, which explains why a webmail move keeps the UID.
- Flags: `flaggedKept`, `seenKept`, `flaggedRemoved`, `seenRemoved` all true.
- Cleanup: probe mail deleted, probe folder and the created `AI` parent deleted.
- The pilot password for Mac runs is in the macOS Keychain (service `ea-interia-imap`, account = pilot address); the user allowed the agent to pipe it into the probe (2026-11-07). Never print it. Remove after S3: `security delete-generic-password -s ea-interia-imap`.
- Open: stage 19 (S3 deploy) — the real paths of the `AI/*` folders and the UID behaviour seen by the committer. See `notes/2026-11-07-assist-actions-facts.md`.

## Send probe (S4 stage 1, 2026-11-07)

- `mailbox:probe-send` (run 2, the full report): folders `Wersje robocze` (`\Drafts`) and `Wysłane` (`\Sent`), none created; UIDPLUS true; SMTP PIPELINING true.
- Draft APPEND with `\Draft`: APPENDUID 38939; `SEARCH SINCE` in Drafts finds it; the FETCH of the uid returns the `x-ea-action-id` header; ENVELOPE Message-ID, RFC822.SIZE (= raw length), INTERNALDATE and the `\Draft` flag are kept; `UID EXPUNGE` deletes it and it is gone after.
- SMTP send (port 465): DATA reply 354, final reply 250, no error.
- Sent copy APPEND: APPENDUID 38940; header fetched; `SEARCH SINCE` in Sent finds it; deleted.
- Sent autosave: the SMTP server saves no copy in `Wysłane` (polled 60 s).
- Own mail back in INBOX: found after 1 s with the `X-EA-Action-Id` header intact (uid 38941); deleted.
- UIDs are consecutive across folders (38939 Drafts, 38940 Sent, 38941 INBOX): one UID counter for the mailbox (as in the S3 probe).
- Run 1 (uids 38936 draft, 38937 Sent copy) printed up to the Sent copy step only in the user's paste; its INBOX mail (subject `EA probe send …`) may still be in INBOX if that run did not end: check by hand.
- Open (S4 stage 22, VPS self-send, not done): how the draft looks in the webmail, whether `Wysłane` stays as the probe showed after a real system send, how many own mails the sync skips, and whether `MAIL FROM` with a display name in `From:` is accepted. The facts of the stage 1 probe and the nodemailer error table: `notes/2026-11-07-send-approval-facts.md`.

## S3 stage 19 facts (2026-11-07, the committer on the real mailbox)

- The `AI/*` folders: `AI/Info`, `AI/Spam`, `AI/Notifications`, `AI/Manual` (delimiter `/`).
- A system move (COPY + UID EXPUNGE, Interia has no MOVE) gives the mail a new UID in the target folder (INBOX 38942 → `AI/Spam` 38947).
- The system COPY back to INBOX (Undo) gives a new INBOX UID (38951).
- A webmail move back to INBOX keeps the folder UID (38948).

- S4 stage 22.1 (2026-11-07 22:16Z): on the VPS, `select count(*) from emails where message_id_header ilike '<ea-probe-%'` → `1` (stage 1.2 expected `0`): one probe mail from the send probe was stored (and triaged) by the pilot server. Harmless; the user may delete the `EA probe send …` mail in INBOX by hand.

## Sort-folder probe (sync-sort-folders stage 1, 2026-11-08)

Script `/tmp/ea-ssf-spike/spike.ts` (not in git), run `249f9b84` on the VPS (`fa60c7b`), 16:43–16:53Z. Two synthetic probes (`<ea-probe-ssf-249f9b84-N@ea-seed.test>`, From `probe@ea-seed.test`), COPY + UID EXPUNGE moves (`forceCopyMove`).

- **`AI/Info` and `AI/Manual` do not exist** at Interia today (LIST: `AI`, `AI/Spam`, `AI/Notifications` only; `folder_map` names all four, `ensureFolder` creates them on the first move). The spike used `AI/Notifications` for both probes, so it created no folder.
- APPEND into `Oferty` and into `Wiadomości-śmieci` stays (90 s).
- COPY `Oferty` → `AI/Notifications` and `Wiadomości-śmieci` → `AI/Notifications` stays (120 s; new UIDs 38973, 38974). NV1 "out": as expected.
- COPY `AI/Notifications` → `Wiadomości-śmieci` stays (UID 38976). NV1 "back" for the spam folder: as expected.
- **COPY `AI/Notifications` → `Oferty` does not stay:** Interia sorted the copy (COPYUID 38975 in `Oferty`) into **INBOX with the same UID 38975** within about 4 minutes. The old VPS sync stored it at 16:50:00Z (`emails` row `d8c247e6-…`, folder INBOX, triage `info`, `save_summary` applied, `move ai_info` logged). NV1 "back" for a sort folder: **not as expected**. Reading: Interia runs its sorter on a COPY that arrives in INBOX or a tab folder (F8 is the same effect the other way); a synthetic probe was never sorted into `Oferty` by Interia, so the sorter gave INBOX. Step D2 (a mail that Interia itself sorted into `Oferty`, out and back) did not run: part 1 stopped at step D.
- **SEARCH misses a re-sorted mail:** at 16:53Z, UID 38975 in INBOX FETCHed fine (envelope = the probe, INTERNALDATE 16:43:22Z, 368 bytes), but `UID SEARCH SINCE <2 days ago>` in INBOX (22 hits) did not return it. So `locateMessage` without a UID hint (`searchSinceIn`) does not find such a mail. Not known: whether this is an index delay or permanent.
- APPEND transfer `Wiadomości-śmieci` → INBOX (step E, NV2): stays; size 368, INTERNALDATE and `Message-ID` kept; source UID EXPUNGE true; flags of P2 were empty. SEARCH found the APPENDed copy.
- STATUS (NV3), read while `AI/Notifications` was selected: `UIDNEXT` INBOX 2, `Oferty`/`Społeczności`/`Rachunki`/`Wiadomości-śmieci` 1; `MESSAGES` `Oferty` 0, `Społeczności` 0, `Rachunki` 0 (wrong), INBOX 14319, `Wiadomości-śmieci` 7. EXAMINE gives no UIDNEXT (`null`). Highest UIDs: INBOX 38975 (before the cleanup), `Oferty` 38970, `Społeczności` 35156, `Rachunki` 32543, `Wiadomości-śmieci` 38892. UIDVALIDITY 1 everywhere. So D4 (`highestUid + 1`) is needed; STATUS `MESSAGES` is not usable either.
- `listedExactly` (`===`, no normalization): `Oferty`, `Społeczności`, `Rachunki`, `Wiadomości-śmieci` all true.
- Cleanup: P2 and the step-E copy deleted by part 2; P1 (INBOX 38975) deleted by a one-off `cleanup` run after a FETCH check of its Message-ID and From. The smoke mail `piotr-re-termin` was not moved and is in `Oferty`. VPS log: 0 lines with the word `error` in 30 min. The row `d8c247e6-…` stays (harmless: `@ea-seed.test>` is out of the week queries; an action on it ends `mail_not_found`).
- **Step D2, run alone after the user's yes (17:09–17:20Z):** the smoke mail `piotr-re-termin` (Interia sorted it into `Oferty` on arrival, UID 38961) → COPY into `AI/Notifications` stays (UID 38978, 5 min). COPY back into `Oferty` (COPYUID 38979) → **Interia sorted it into INBOX with the same UID 38979** (5 min). SEARCH SINCE in INBOX missed it again; a FETCH by UID found it. The old VPS sync stored it at 17:15:00Z (row `3cf26e47-…`, triage `needs_reply`, no action, no outbox row). So a COPY into `Oferty` is re-sorted also for a mail that Interia itself put into `Oferty`.
- **APPEND back into `Oferty` stays (17:20–17:25Z):** the raw source of INBOX UID 38979 (4447 bytes, `\Seen`) APPENDed into `Oferty` with the same INTERNALDATE (APPENDUID 38980), then UID EXPUNGE in INBOX. After 5 min: only in `Oferty`, same size and INTERNALDATE; SEARCH SINCE finds it. The row `3cf26e47-…` now points at a gone INBOX UID (harmless: an action on it ends `mail_not_found`).
- Rule that follows: at Interia a COPY into INBOX or into a tab folder (`Oferty`, probably also `Społeczności`, `Rachunki`) runs the sorter again; an APPEND does not. A COPY into `AI/*` and into `Wiadomości-śmieci` stays.

## Folder facts for the sort-folder sync (sync-sort-folders, read-only VPS count 2026-11-08)

Source of the full text: `tasks/done/sync-sort-folders.md`, "Facts checked" (F1–F4, F12). Short form for later agents:

- **F1 Folders.** Delimiter `/`. `Wiadomości-śmieci` has the LIST attribute `\Spam`, but imapflow gives it no special use. `AI/Spam` gets `\Junk` (by name). `Oferty` and `Społeczności` are `\Noinferiors`.
- **F2 UIDVALIDITY and UIDNEXT.** UIDVALIDITY is 1 in all 12 folders. SELECT and EXAMINE give no UIDNEXT. STATUS gives `UIDNEXT 1` for every folder, which is wrong. The sync uses the highest UID + 1 (D4).
- **F3 One UID counter.** All folders of the mailbox share one UID counter. A webmail move keeps the UID.
- **F4 Volumes (8 days).** INBOX 83, `Oferty` 56 (about 7 a day), `Społeczności` 0, `Rachunki` 0, `Wiadomości-śmieci` 3.
- **F12 Sorter on COPY.** See "Sort-folder probe" above: a COPY into INBOX or `Oferty` is sorted again, an APPEND is not.
