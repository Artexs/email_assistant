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
- **SMTP does not save sent mail.** After a send (S4), the committer must APPEND a copy to `Wysłane`.
- **IDLE works.** Push sync can come later.
