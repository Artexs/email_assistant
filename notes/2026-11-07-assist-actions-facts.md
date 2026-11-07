# S3 assist actions: facts and their outcomes

Written 2026-11-07 (stage 18.2 of `tasks/active/s3-assist-actions.md`).
Sources: the stage 1 probe, the GreenMail tests, the dev mailbox connect and the code.
Stages 16, 17, 19 and 20 are not done on this date. Their facts are marked `open`. Nobody invented a result.

## Interia (stage 1, checked 2026-11-07)

Full list with the probe report fields: `notes/2026-11-03-interia-imap-capabilities.md`, section "Move probe". Short form:

| Fact                                                     | Outcome                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| Hierarchy delimiter                                      | `/`; namespace prefix empty                                   |
| Capabilities                                             | MOVE no, UIDPLUS yes (so the COPY path)                       |
| Nested folder `AI/Spam` without the parent `AI`          | `NO [ALERT]`; `ensureFolder` creates each level, parent first |
| `COPYUID` returned                                       | yes                                                           |
| UID of a COPY equals the source UID                      | no (38914 → 38915); a webmail move keeps the UID (2026-11-04) |
| COPY keeps size, INTERNALDATE, ENVELOPE date, Message-ID | yes → identity mode `strict`                                  |
| `SEARCH SINCE` in a folder other than INBOX              | works                                                         |
| `UID EXPUNGE` removes only the given UID                 | yes (`otherDeletedKept` true)                                 |
| UID of a mail copied back to INBOX                       | new UID above `UIDNEXT` (38918); `sameAsOriginal` false       |
| `\Flagged` and `\Seen` kept after a COPY                 | yes                                                           |
| `SEARCH HEADER Message-ID`                               | finds nothing (2026-11-03) → the identity locate replaces it  |

Open: stage 19 (the real paths of the `AI/*` folders at Interia, the UID behaviour the committer sees). Reason: the VPS deploy has not run.

## GreenMail 2.1.15 (tests and dev server, 2026-11-07)

- Capabilities: `MOVE` and `UIDPLUS` yes (`notes/2026-11-03-greenmail-facts.md`). The dev mailbox connect on 2026-11-07 showed MOVE=yes and UIDPLUS=yes.
- Delimiter: `.` (raw `LIST` on `127.0.0.1:3143` on 2026-11-07). The Interia delimiter is `/`. The tests accept both (`/^AI[./]Info$/`, `report.delimiter` is `.` or `/`), so no test pins the GreenMail path of `AI/Info`.
- A raw `CREATE AI/X` on GreenMail makes one flat folder named `AI/X`. Code that must create `AI/Info` goes through `ensureFolder`, which uses the server delimiter.
- The contract tests run twice: `imap-greenmail` (MOVE) and `imap-greenmail-copy-path` (`forceCopyMove`). The COPY path leaves no `\Deleted` mail in the source folder (`apps/server/test/integration/imap-contract.test.ts`).
- `probeMove` runs every write on GreenMail and cleans up, including the `AI` parent (`imap-probe-move.test.ts`).

## Postgres

- The `outbox.kind` check constraint is named `outbox_kind_check`. Source: `db/migrations/20261107000001_assist_actions.sql`.

## Not verified yet

| Item                                                                       | State                                                           |
| -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Telegram: the limit of inline buttons per message and row (digest uses 45) | open: stage 16 (the dev run with the phone)                     |
| The dev run result (stage 16): Undo on the phone, toasts, `action_failed`  | open: stage 16                                                  |
| The restore test result                                                    | open: stage 17                                                  |
| The real `AI/*` paths at Interia, UID behaviour seen by the committer      | open: stage 19                                                  |
| The one-week result of `assist` mode (N = 3 wrong moves)                   | open: stage 20                                                  |
| The `copies <c>` values of the `returned below cursor` lines               | open: stage 20 (input for `tasks/planned/copy-below-cursor.md`) |

Update this note when those stages finish.
