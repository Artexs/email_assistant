---
title: How the email assistant server works (S1a)
chrome: title
width: wide
---

Today the server does one job: every 5 minutes it [reads new mail from INBOX and the synced folders](#mail->imap) and [stores it in Postgres](#mail->postgres). The [mail module](#mail) holds almost all the logic. The code uses factory functions and TypeScript interfaces, not class hierarchies: only the IMAP adapter and the error types are real classes.

```figure
id: system
layout: zones
title: Parts and data flow
grid: [5, 3]
nodes:
  cli:       { label: Operator CLI, at: [0, 0], kind: actor, about: "The `bun run` scripts in `apps/server/src/scripts/`. They create orgs, connect and seed mailboxes, and run audits and rescans." }
  scheduler: { label: Scheduler, sub: every 5 min, at: [1, 1], about: "Runs the `mail.sync` and `platform.heartbeat` jobs from `main.ts`. A tick never overlaps the previous one, and a job that throws does not stop the next tick." }
  tenancy:   { label: Tenancy + config, at: [2, 0], about: "Creates an organization with its owner, and stores the per-mailbox settings. New mailboxes get mode `shadow`, so the system moves no mail." }
  mail:      { label: Mail module, at: [2, 1], focal: true, about: "Connects mailboxes, runs the incremental sync, and removes duplicates. It talks to IMAP only through the `MailProvider` port." }
  heartbeat: { label: Heartbeat, at: [2, 2], about: "Checks the database, then pings Healthchecks.io. When the database is down it sends no ping, so the alert comes from the missing ping." }
  postgres:  { label: Postgres, at: [3, 1], kind: store, about: "Holds orgs, mailboxes, encrypted credentials and stored emails. The server connects with an app role that `assertAppRole` checks at start-up." }
  imap:      { label: Mail server, sub: IMAP / SMTP, at: [4, 1], kind: external, about: "The user's mailbox, for the pilot at Interia. TLS is always on for a remote host; plain IMAP is allowed only on loopback for GreenMail tests." }
  b2:        { label: Backblaze B2, at: [4, 0], kind: external, about: "Gets the nightly encrypted database backup from `deploy/backup.sh`. The B2 key can write but not read." }
  hc:        { label: Healthchecks.io, at: [4, 2], kind: external, about: "Alerts the user when the heartbeat ping stops. The heartbeat is off when `HEARTBEAT_URL` is not set." }
edges:
  - cli -> tenancy: creates org
  - cli -> mail: connects mailbox
  - scheduler -> mail
  - scheduler -> heartbeat: tick
  - tenancy -> postgres
  - mail => imap: reads INBOX and the synced folders
  - mail -> postgres
  - heartbeat -> postgres: checks db
  - heartbeat => hc: pings
  - { from: postgres, to: b2, kind: link, about: "`deploy/backup.sh` runs every night. It encrypts the dump before the upload." }
groups:
  vps: { label: Home VPS (Docker), from: [1, 0], to: [3, 2], kind: trust, about: "The `db` and `server` containers from `deploy/compose.yaml`. No port is open except SSH." }
notes:
  - { on: mail, text: "All mailbox data enters through this module. It never changes the mailbox in S1a." }
  - { on: mail->imap, text: "The only connector that reads user mail. The password is decrypted just before this call." }
caveat: "The `/health` HTTP route, `apps/web` (an Astro placeholder) and `packages/core` (shared role enums) are left out. Gemini and Telegram come in S1b and S2."
```

## One sync tick

The [job](#t-job) loops over every active mailbox. For each one, [syncMailbox](#t-sync) plans a chunk of 50 mails with reads only, then [writes the chunk in one transaction](#m10). The transaction first checks that the cursor did not move, so two runs can never store the same mail twice.

```figure
id: tick
layout: sequence
title: Data flow of mail.sync for one mailbox
actors:
  t-scheduler: { label: Scheduler, about: "Calls `run()` of the mail sync job every 5 minutes. It waits for the previous run to finish before it starts a new one." }
  t-job:       { label: MailSyncJob, about: "From `createMailSyncJob` in `jobs.ts`. It decrypts the password, opens the provider, and turns errors into a mailbox status or a log line." }
  t-sync:      { label: syncMailbox, focal: true, about: "In `sync.ts`. It selects the mode (initial, incremental or rescan), fetches mail, and applies the dedup rules from `sync-rules.ts`." }
  t-imap:      { label: ImapMailProvider, kind: external, about: "The IMAP adapter behind the `MailProvider` port. Tests use the in-memory fake provider through the same port." }
  t-db:        { label: Postgres, kind: store, about: "Every read and write goes through Kysely repo functions that take a `TenantContext`, so each query filters by `org_id`." }
messages:
  - t-scheduler -> t-job: run()
  - t-job -> t-db: lists mailboxes
  - { from: t-job, to: t-db, label: reads credentials, about: "The job decrypts the password with AES-256-GCM. The AAD is `mailbox:<id>`, so a ciphertext copied to another mailbox does not decrypt." }
  - t-job => t-imap: logs in
  - t-job -> t-sync: syncMailbox()
  - { from: t-sync, to: t-imap, kind: link, label: folder status, about: "UIDVALIDITY and UIDNEXT. A new UIDVALIDITY starts a 7-day rescan; no cursor starts a 1-day initial sync." }
  - { from: t-sync, to: t-imap, kind: link, label: fetches headers, about: "Incremental mode fetches every UID above `last_uid`. The other modes search by date." }
  - { from: t-sync, to: t-db, label: finds copies, about: "Looks for rows with the same Message-ID and content hash. The pure `decideIncoming` rule then picks insert, update the UID, or check the old folder." }
  - t-sync => t-imap: fetches body
  - { from: t-sync, to: t-db, label: writes chunk, about: "One transaction per chunk. It locks the mailbox row, inserts emails with status `pending`, and moves the cursor only when it is still the expected value." }
  - t-sync --> t-job: returns counts
  - t-job -> t-db: marks synced
notes:
  - { on: m10, text: "Plan first, write second: provider calls never run inside an open transaction." }
  - { on: m4, text: "A login failure sets the mailbox to `auth_error`. A network error only waits for the next tick." }
caveat: "The UIDVALIDITY rescan, the folder check for mail that the user moved back, and the provider close are not drawn."
```

## Types and classes

The [MailProvider](#types-mailprovider) port separates the sync logic from IMAP. [Error classes](#errors-softerror) tell the job what to do next: a soft error retries on the next tick, a hard error stops.

```uml
id: types
title: The mail port and its dependencies
classes:
  MailProvider:
    at: [1, 2]
    span: 2
    stereotype: interface
    focal: true
    operations: ["+folderStatus(folder): FolderStatus", "+fetchAbove(folder, lastUid): MessageMeta[]", "+fetchBodyText(folder, uid): string", "+transferByAppend(from, uid, to)", "+close()"]
    about: The only way the code reads a mailbox. Every adapter must pass the contract suite in `test/contract/mail-provider.ts`.
  ImapMailProvider:
    at: [0, 5]
    span: 2
    attributes: ["-client: ImapFlow", "-bodyLimitBytes: number"]
    about: The real adapter on imapflow, made by `openImapProvider`. It locks the folder for each call and maps IMAP errors to typed errors.
  FakeMailProvider:
    at: [2, 5]
    span: 2
    stereotype: interface
    operations: ["+deliver(folder, msg): number", "+userMove(from, uid, to)", "+resetUidValidity(n)", "+failOn(method, error)"]
    about: An in-memory mailbox for unit tests, made by `createFakeMailProvider`. It can act like a user and inject failures.
  MessageMeta:
    at: [3, 2]
    span: 2
    attributes: ["+uid: number", "+messageId: string", "+internalDate: Date", "+from: string", "+actionId: string"]
    about: The headers of one mail, without the body. The sync builds the dedup key and the thread key from these fields.
  SyncDeps:
    at: [0, 0]
    span: 2
    attributes: ["+db: Db", "+provider: MailProvider", "+now(): Date"]
    about: What `syncMailbox` needs, passed in as one object. Tests give it a fake provider and a fixed clock.
  MailSyncJobDeps:
    at: [2, 0]
    span: 2
    attributes: ["+db: Db", "+secrets: SecretBox", "+openProvider(opts)"]
    about: What the scheduled job needs. It opens a new provider for each mailbox in each tick, and closes it after the sync.
relations:
  - MailProvider <|.. ImapMailProvider
  - MailProvider <|-- FakeMailProvider
  - 'MailProvider ..> MessageMeta : returns'
  - SyncDeps --> MailProvider
  - 'MailSyncJobDeps ..> MailProvider : opens'
notes:
  - { on: types-mailprovider, text: "Sync code depends on this interface only, so the same tests run against the fake, GreenMail and Interia." }
caveat: Only the members that the data flow uses are shown.
```

```uml
id: errors
title: Error classes
classes:
  Error:
    at: [1, 0]
    about: The built-in JavaScript error. All own error classes extend it and set their own `name`.
  SoftError:
    at: [0, 2]
    focal: true
    about: A temporary failure, such as a network timeout. The job logs a warning and the next tick tries again.
  HardError:
    at: [2, 2]
    about: A failure that a retry does not fix, such as a bad TLS setting or a missing mailbox row.
  CursorMovedError:
    at: [0, 4]
    about: Another run moved the mailbox cursor during this sync. The transaction rolls back and the next tick tries again.
  MailAuthError:
    at: [2, 4]
    about: The IMAP or SMTP login failed. The job sets the mailbox status to `auth_error`, so it is not synced until the user fixes it.
relations:
  - Error <|-- SoftError
  - Error <|-- HardError
  - SoftError <|-- CursorMovedError
  - HardError <|-- MailAuthError
caveat: "`ConfigError`, `CryptoError` and `DbRoleError` also extend `Error` directly. They stop the server at start-up."
```

## Database tables

Every mail table points at [mailboxes](#mail-db-mailboxes) through a composite key `(mailbox_id, org_id)`, so a row can never belong to a mailbox of another org. The [dedup_key](#mail-db-emails-dedup-key) is unique per mailbox and stops duplicate mail.

```schema
id: mail-db
title: Mail tables (db/migrations/20261103100001_mail.sql)
tables:
  organizations:
    at: [0, 0]
    about: One customer. All other tables carry its `org_id`.
    columns:
      - id uuid pk: The tenant id in every `TenantContext`.
      - timezone text: Used for digest times later.
  mailboxes:
    at: [2, 0]
    focal: true
    about: One connected mailbox and its sync cursor.
    columns:
      - id uuid pk: Also the AAD for the encrypted password.
      - org_id uuid fk organizations.id cascade: The owner org.
      - status text: One of active, auth_error or paused. Only active mailboxes are synced.
      - uidvalidity bigint null: Null until the first sync. A change starts a rescan.
      - last_uid bigint null: The highest stored UID; the incremental sync starts above it.
  mailbox_credentials:
    at: [0, 2]
    about: The encrypted IMAP and SMTP password, one row per mailbox.
    columns:
      - mailbox_id uuid pk fk mailboxes.id cascade unique: Composite key with org_id.
      - encrypted_secret text: AES-256-GCM ciphertext, never the plain password.
      - key_version int: Lets the key rotate without a new column.
  mailbox_settings:
    at: [0, 4]
    about: How much the assistant may do in this mailbox.
    columns:
      - mailbox_id uuid pk fk mailboxes.id cascade unique: Composite key with org_id.
      - mode text: shadow (record only) or assist.
  emails:
    at: [3, 2]
    about: One stored mail, waiting for triage.
    columns:
      - id uuid pk: The email id in logs and later actions.
      - mailbox_id uuid fk mailboxes.id cascade: Composite key with org_id.
      - dedup_key text: Message-ID plus content hash, unique per mailbox.
      - uid bigint: The current IMAP UID; it changes when the mail moves.
      - thread_key text: First reference, else In-Reply-To, else the own Message-ID.
      - status text: pending after the sync; S1b triage moves it on.
notes:
  - { on: mail-db-emails-dedup-key, text: "A second identical copy gets `#2` at the end of its key, so it is stored and not lost." }
caveat: "Only the key columns and the columns the sync uses are shown. Tenancy tables `users` and `memberships` (role owner or assistant) are left out."
```
