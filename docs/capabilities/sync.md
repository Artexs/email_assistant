# Sync

> Checked against the code at `949c81d`, 2026-11-14.

## What it does now

Sync brings mail from an IMAP mailbox into the `emails` table. An owner connects a mailbox on the web panel or with `bun run mailbox:connect`. Both paths test the IMAP and SMTP login first, and a failed login stores nothing. The password is stored only encrypted. Every 5 minutes the job `mail.sync` walks each `active` mailbox of every organization that is not `suspended`. It reads INBOX, then the provider sort folders, then the spam folder. Each folder has its own cursor (UIDVALIDITY and last UID). New mail becomes an `emails` row with status `pending`, and the triage worker takes it from there (`triage.md`). Sync only reads the mailbox: it never moves, flags or deletes mail. It also detects a mail that the user moves back after a system move (`emails.returned_at`). An operator can pause, resume, rescan, backfill and audit a mailbox with the CLI tools below. A login error sets the mailbox to `auth_error`; the way out is `bun run mailbox:password`.

## Rules

1. **Connect (web and CLI).** Both go through `connectMailbox`. The order is fixed:
   1. The input is validated (a bad address or port stops here).
   2. A mailbox with the same address in the organization gives `mailbox_exists` (web `409`).
   3. An organization at its mailbox limit gives `mailbox_limit` (web `409`). The check runs before any login, without a lock.
   4. The IMAP login and the SMTP login are tested (`smtpSecurity` is `tls` or `starttls`). The web route stops a check that hangs: the socket timeout is 20 s and the deadline is 25 s (`WEB_MAIL_TIMEOUTS`).
   5. One transaction takes the limit lock, checks the limit again, then inserts the `mailboxes` row, the `INBOX` row of `mailbox_folders`, the encrypted credentials, the default settings and the audit row `mailbox.connected`.

   Connect changes nothing in the mailbox: it does not create the `AI/*` folders. The committer creates them before the first move (`actions-and-undo.md`).

2. **Host guard.** Every IMAP and SMTP connection resolves its host through `resolveMailHost` and connects to the checked address, so a second DNS answer cannot redirect it. A host that is, or resolves to, a local, private, Tailscale, benchmark, multicast, reserved, NAT64, site-local or 6to4 address gives `HostNotAllowedError` (web `400 host_not_allowed`). A DNS failure is a soft error. `MAIL_ALLOW_LOCAL_HOSTS=true` (or the old `WEB_MAIL_ALLOW_LOCAL`) turns the guard off for tests and local servers. The web connect route also refuses a local host name before any network call, unless local hosts are allowed.
3. **Presets.** The web form accepts a preset (`interia`, `gmail`, `onet`, `wp`, `o2`, `icloud`) or explicit hosts. `mailbox:connect` takes the hosts as flags.
4. **Capability check.** `bun run mailbox:check` reads the server capabilities (IDLE, MOVE, UIDPLUS, CONDSTORE, SPECIAL-USE, KEYWORDS) and the folder list. With `--probe` it also adds one draft and sends one mail to the mailbox itself, to test `SEARCH HEADER` and the auto-save of sent mail. Use `--probe` only on a test account. Connect stores the capabilities in `mailboxes.capabilities`.
5. **Folder keys (ADR 0014).** The keys are `inbox`, `offers`, `social`, `bills` and `junk`. At Interia the defaults are `Oferty`, `Społeczności`, `Rachunki` (role `sort`) and `Wiadomości-śmieci` (role `junk`). At each run the job adds a row for each default name that the server lists exactly. It never adds a folder that is Drafts, Sent, Trash, an `AI/*` folder or the `AI` root. Sync reads INBOX and the enabled rows of `mailbox_folders` only; it never reads `AI/*`, Sent, Drafts, Trash or the user's own folders, so that mail is never touched. The run goes folder by folder: INBOX, the `sort` folders, then the spam folder. An error in a folder other than INBOX gives a warning and the run goes on; the third failed run in a row for one folder gives one `error` line. A folder row that the server does not list is skipped. `bun run mailbox:settings sync-folder --key offers|social|bills|junk --value on|off` switches a folder (INBOX has no switch); switching on again clears its cursor, so the folder starts with a new 24 h first sync. The web panel does the same with `PATCH /api/settings/:mailboxId/sync-folders/:key` (owner only). Details of the folder rules: `docs/architecture.md` §6.1.
6. **The `mail.sync` job.** Cron `*/5 * * * *`. The target list is `listSyncTargets`: mailboxes with status `active` of organizations whose plan is not `suspended`. The job checks the plan before each mailbox, so a suspend during a run stops at the next mailbox. After a good run it sets `mailboxes.last_synced_at`. The log lines hold the mailbox id and counts only.
7. **Cursor and first sync.** The cursor of a folder is `uidvalidity` and `last_uid` in its `mailbox_folders` row. An incremental run fetches the UIDs above the cursor and drops the UIDs at or below it (`UID FETCH n:*` also returns the highest message). The mode is `initial` when the folder has no cursor (only mail of the last 24 h), `incremental` when UIDVALIDITY is unchanged, and `rescan` when it changed (mail of the last 7 days; the dedup key stops duplicates). `bun run mailbox:rescan` forces a rescan of every synced folder of one mailbox. The INBOX cursor is also written to `mailboxes.uidvalidity` and `last_uid` (a rollback aid). The UIDNEXT of a folder is the largest of the STATUS value, the SELECT value and the highest UID + 1, because Interia gives a wrong STATUS value.
8. **Dedup key.** `Message-ID` plus `content_hash` (SHA-256 of the `From` address, the `Date` header, else INTERNALDATE, and RFC822.SIZE). A mail without a `Message-ID` uses the hash only. The same `Message-ID` with another hash is a new mail. A second identical copy gets the key with `#2`, `#3`, and so on. The unique index is `(mailbox_id, dedup_key)`. Exact rules: `docs/architecture.md` §6.1.
9. **Own mail is skipped.** A message whose `X-EA-Action-Id` header matches an `actions` row of the mailbox is the system's own draft or sent mail: sync does not store it (`isOwnActionId`). `From:` with the owner's address is not a reason to skip.
10. **Known mail is never triaged again.** `update_uid` and `returned` never change `emails.status`.
11. **Returned mail.** When the user moves a mail that the system moved back to a synced folder, sync sets `emails.returned_at`, `folder` and `source_folder` (the mail is gone from the folder it was moved to). The job `triage.returned` then writes the feedback row (`triage.md`). At the end of each incremental run, sync also looks at the mail that the system moved in the last 7 days (at most 500, newest first) in the folder it came from, for a return that kept its UID below the cursor. A mail that sits in two synced folders (a cross copy) is counted and not stored. While a system move runs (`emails.undo_pending_at` younger than 24 h), sync stores no copy of the mail.
12. **Mailbox statuses.** `active`: synced. `paused`: not synced and not triaged; the owner sets it on the web panel (`POST /api/mailboxes/:id/pause`, `.../resume`) or with Telegram `/pause` and `/resume` (owner only). `auth_error`: set by the job when a login fails; a pause or resume on an `auth_error` mailbox answers `409 wrong_status` on the web. Each change writes an audit row (`mailbox.paused`, `mailbox.resumed`).
13. **Mailbox errors** (moved from `docs/architecture.md` §8). IMAP/SMTP login error → mailbox `auth_error`, a Telegram notice to the linked owners (one per `status_changed_at`), other mailboxes continue. The way out is `bun run mailbox:password` (new password on stdin, login test, `auth_error` → `active`). Connection errors → a warning; the next 5-minute tick tries again.
    - A hard error is logged as an `error` line. A cursor that moved during a run (`CursorMovedError`) is a soft error like a connection error.
    - `updateMailboxPassword` tests the IMAP and SMTP login with the new password first; a failed login stores nothing. An `auth_error` mailbox becomes `active`; a `paused` one stays paused. The web route is `POST /api/mailboxes/:id/password` (owner only).
14. **Remove.** `DELETE /api/mailboxes/:id` (owner only) needs the typed address (`confirm_mismatch` gives `400`). The mailbox is paused first; then one transaction runs `delete_mailbox`, writes the audit row `mailbox.removed` and queues the owners' notice. A deadlock is retried once. On any other error a mailbox that this call paused returns to `active`.
15. **Backfill (one-off).** `bun run mailbox:backfill --org-id <uuid> --mailbox-id <uuid> [--days 1-180]` (default 30) reads INBOX mail of the last days, stores the missing mail with `emails.backfilled_at` set, and never moves the cursor. It changes nothing in the mailbox. It refuses a window above 180 days, a mailbox that was never synced, a changed UIDVALIDITY (wait for the regular rescan) and a suspended organization. After the store it re-queues real mail of the window that the worker skipped as `too_old` (`triage.md`).
16. **Operator tools.** `bun run mailbox:seed` appends synthetic mail into INBOX or a sync folder; it refuses every mailbox except the one in `TEST_MAILBOX_ADDRESS`. `bun run mailbox:audit --org-id <uuid> --mailbox-id <uuid> --since <ISO time>` is read-only: it compares the mail of each enabled synced folder on the server with the stored rows (exit 0 no difference in INBOX, exit 2 lost or duplicate INBOX mail). Run it right after a sync, because mail of the last 5 minutes can show as missing. `bun run mailbox:signals --org-id <uuid> --mailbox-id <uuid> [--days 30]` is read-only: it prints counts of INBOX mail of the window (`\Answered`, `\Seen`, `\Flagged`, `Authentication-Results`, `List-Unsubscribe`) and the mail server names of `Authentication-Results`; it prints no subject, address or UID and writes nothing.
17. **Mailbox limit.** `organizations.max_mailboxes` caps the mailboxes; connect checks it twice (rule 1). See [tenancy-and-plans.md](tenancy-and-plans.md).

## Entry points

| Kind     | Name                                                        | Where                                          |
| -------- | ----------------------------------------------------------- | ---------------------------------------------- |
| job      | `mail.sync` (`*/5 * * * *`)                                 | `apps/server/src/modules/mail/jobs.ts`         |
| route    | `GET /api/mailboxes`                                        | `apps/server/src/modules/mail/routes.ts`       |
| route    | `POST /api/mailboxes` (owner)                               | `apps/server/src/modules/mail/routes.ts`       |
| route    | `POST /api/mailboxes/:id/password` (owner)                  | `apps/server/src/modules/mail/routes.ts`       |
| route    | `POST /api/mailboxes/:id/pause`, `POST .../resume` (owner)  | `apps/server/src/modules/mail/routes.ts`       |
| route    | `DELETE /api/mailboxes/:id` (owner)                         | `apps/server/src/modules/mail/routes.ts`       |
| route    | `PATCH /api/settings/:mailboxId/sync-folders/:key` (owner)  | `apps/server/src/modules/config/routes.ts`     |
| Telegram | `/pause`, `/resume` (owner)                                 | `apps/server/src/modules/channels/commands.ts` |
| CLI      | `bun run mailbox:connect`                                   | `apps/server/src/scripts/mailbox-connect.ts`   |
| CLI      | `bun run mailbox:check`                                     | `apps/server/src/scripts/mailbox-check.ts`     |
| CLI      | `bun run mailbox:password`                                  | `apps/server/src/scripts/mailbox-password.ts`  |
| CLI      | `bun run mailbox:rescan`                                    | `apps/server/src/scripts/mailbox-rescan.ts`    |
| CLI      | `bun run mailbox:backfill`                                  | `apps/server/src/scripts/mailbox-backfill.ts`  |
| CLI      | `bun run mailbox:seed`                                      | `apps/server/src/scripts/mailbox-seed.ts`      |
| CLI      | `bun run mailbox:audit`                                     | `apps/server/src/scripts/mailbox-audit.ts`     |
| CLI      | `bun run mailbox:signals`                                   | `apps/server/src/scripts/mailbox-signals.ts`   |
| CLI      | `bun run mailbox:settings` (`sync-folder`)                  | `apps/server/src/scripts/mailbox-settings.ts`  |
| function | `syncMailbox`, `backfillInbox`                              | `apps/server/src/modules/mail/sync.ts`         |
| function | `connectMailbox`, `updateMailboxPassword`, `buildFolderMap` | `apps/server/src/modules/mail/connect.ts`      |
| function | `resolveMailHost`, `configureMailHosts`                     | `apps/server/src/modules/mail/host-guard.ts`   |
| function | `checkMailbox`                                              | `apps/server/src/modules/mail/check.ts`        |
| function | `removeMailbox`                                             | `apps/server/src/modules/mail/remove.ts`       |
| function | `switchMailboxStatus`                                       | `apps/server/src/modules/mail/status.ts`       |
| function | `ensureSyncFolders`                                         | `apps/server/src/modules/mail/folders.ts`      |
| function | `locateMessage`, `locateByActionId`                         | `apps/server/src/modules/mail/locate.ts`       |

## Data

- `mailboxes`: `address`, hosts and ports, `smtp_security`, `status` (`active`, `auth_error`, `paused`), `status_changed_at`, `last_synced_at`, `capabilities`, `folder_map` (Drafts, Sent, Trash and Junk paths from the special-use flags, plus the `AI/*` names), and the INBOX cursor copy `uidvalidity`, `last_uid`. A unique index on `(org_id, lower(address))`.
- `mailbox_credentials`: the encrypted secret, `secret_kind` (`password` or `app_password`), `key_version` (ADR 0009).
- `mailbox_folders`: one row per synced folder: `key`, `path`, `role` (`inbox`, `sort`, `junk`), `enabled`, `uidvalidity`, `last_uid`. At most one `junk` row per mailbox. The INBOX row is always `INBOX` and enabled.
- `emails` written by sync: `dedup_key`, `message_id_header`, `content_hash`, `uid`, `folder`, `source_folder`, `thread_key`, headers, `body_text` (at most 100 000 characters), `received_at`, `returned_at`, `backfilled_at`, and status `pending`. The status flow of `emails` after the insert is in `triage.md`.
- Audit events: `mailbox.connected`, `mailbox.paused`, `mailbox.resumed`, `mailbox.password_changed`, `mailbox.removed`, `mailbox.sync_folder_added`, `mailbox.sync_folder_changed`.

## Limits

- Polling every 5 minutes, no IMAP IDLE: IDLE is an E8 Should item; E3a (F100) moves the poll to 2 minutes.
- No read of the Sent folder: E5a (F104).
- Password only, no OAuth: E9a (F117).
- `F029-sync-return-of-a-later-copy`: a later copy that returns while two identical copies sit in one folder stores a new `#n` row and triages it again.
- `F032-copy-below-cursor`: a copy that lands below the cursor is logged and counted, not stored.
- `F064-sync-return-to-other-folder`: a move into another synced folder with a UID below that folder's cursor is not seen, so an action on that row can end `mail_not_found`.
- `F062-drop-mailbox-cursor-columns`: the INBOX cursor is still written twice (`mailboxes` and `mailbox_folders`).
- `F085-a-mailbox-whose-host-the-guard-refuses-gets-a-status-and-a-notice`: a refused host gives only a log line at each run, no status and no notice.
- `F060-backfill-per-folder`: `mailbox:backfill` reads INBOX only; a new synced folder gets only the 24 h first sync.
- The mailbox limit is a count only (`tenancy-and-plans.md`).

## Decisions

- ADR 0009 (encrypted credentials), ADR 0010 (IMAP first), ADR 0014 (sync of provider sort folders).
- `docs/architecture.md` §6.1 keeps the IMAP rules (dedup, move, locate, Interia facts).

## Tests

- `apps/server/test/integration/mail-sync.test.ts`
- `apps/server/test/integration/imap-sync-greenmail.test.ts`
- `apps/server/test/integration/imap-contract.test.ts`
- `apps/server/test/integration/mail-connect.test.ts`
- `apps/server/test/integration/mail-host-guard.test.ts`
- `apps/server/test/integration/mail-password.test.ts`
- `apps/server/test/integration/mail-remove.test.ts`
- `apps/server/test/integration/mail-jobs.test.ts`
- `apps/server/src/modules/mail/sync-rules.test.ts`
- `apps/server/src/modules/mail/host-guard.test.ts`
- `apps/server/src/modules/mail/host-check.test.ts`
- `apps/server/src/modules/mail/locate.test.ts`
- `apps/server/src/modules/mail/uid-next.test.ts`
- `apps/server/src/modules/mail/routes.test.ts`
- `packages/core/src/mail/sync-folders.test.ts`
