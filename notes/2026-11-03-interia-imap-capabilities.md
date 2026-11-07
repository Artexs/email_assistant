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
