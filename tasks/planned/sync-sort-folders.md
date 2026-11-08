> **Status 2026-11-08 — planned.** The user chose this on 2026-11-08. Left: the user's answers to the questions below, then the plan (`plan-task`), then the build (`run-task`) and a VPS deploy.

# Sync the Interia sort folders (Oferty, Społeczności, Rachunki)

Scope: product change of the mail sync (S1a sync, S3 actions). Source: `tasks/active/test-mail-traffic.md` stage 9.1 and `notes/2026-11-07-agentmail-test-mail.md` §10.
Needs: nothing. Blocks: `test-mail-traffic` stage 9 (its test mail lands in `Oferty`).
Git mode: worktree.

## Why

Interia sorts new mail into tabs that are IMAP folders: `Oferty`, `Społeczności`, `Rachunki` (no special-use flag). The app reads only INBOX
(`docs/architecture.md` §"Pipeline rules" 1: "The system reads only INBOX"), so it never sees mail that Interia sorts into these folders.
In real use a manager gets mail in all of them. The test tool also showed it: all AgentMail test mail lands in `Oferty`, and an IMAP `UID COPY`
into INBOX goes back to `Oferty` (notes §10). So a move into INBOX is no fix.

## User words (2026-11-08)

> "Third point is definitely okay to read the offerty. I mean, in the real scenarios there will be more emails across the inbox, so all of them have to be read.
> So, go with option 3. And also all other sources of emails that are available in the inbox."

## Goal

The sync reads INBOX and the Interia sort folders, stores and triages their mail like INBOX mail, and the actions and undo work for mail from every synced folder.

## Done when

- New mail in `Oferty`, `Społeczności` or `Rachunki` is stored, triaged, and shows in the digest (dev with GreenMail, then the VPS).
- Each synced folder has its own UID cursor and UIDVALIDITY check; a mail that the user moves between synced folders is not stored twice.
- A move action takes the mail from the folder where it is; Undo brings it back to that folder, not to INBOX.
- The test-mail flow works without `deliver`: `test-mail-traffic` stage 9 runs to the end.
- An ADR replaces the rule "The system reads only INBOX" (`docs/architecture.md`), and the docs say which folders the sync reads.

## Known facts (from the code, 2026-11-08)

- One cursor per mailbox: `mailboxes.last_uid` (`db/migrations/20261103100001_mail.sql`); `emails.folder` exists (default `INBOX`).
- The port has folder-aware reads (`searchSinceIn`, `fetchByUidsIn`, `fetchMetaIn`) but the sync uses INBOX-only calls (`fetchAbove`, `searchInboxSince`, `fetchByUids`).
- `actions/apply.ts` and `actions/undo.ts` assume INBOX as the start and the Undo target (`apply.ts:284-343`).
- `\Junk` is `AI/Spam` now (S3 set the flag); `Wiadomości-śmieci` has no flag (notes §10).
- The S3 and S4 pilot weeks measure the live sync until 2026-11-14T22:40Z (`tasks/planned/s3-assist-week-result.md`, `tasks/planned/s4-pilot-week.md`).

## Questions for the user

1. **Folders.** Sync `Oferty`, `Społeczności`, `Rachunki`. Also the Interia spam folder `Wiadomości-śmieci`? Default: no (spam stays where Interia put it).
2. **Actions on sort-folder mail.** The committer moves it into `AI/*` like INBOX mail, and Undo returns it to its own folder. Default: yes.
3. **First sync of a new folder.** Only mail of the last 24 hours, like the first connect (`docs/architecture.md` "First connect"). Default: yes.
4. **Deploy time.** A sync change on the VPS changes what the S3 and S4 pilot weeks measure. Deploy after 2026-11-14T22:40Z, or now? Default: now, with a note in both week tasks.

## Plan

Written with `plan-task` after the answers. Expected areas: migration (cursor per folder), sync loop per folder, dedup across folders, actions and undo
source folder, audit and check per folder, digest, ADR, docs, VPS deploy.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built; the new ADR is accepted.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-08: Created from the `test-mail-traffic` stage 9.1 finding. The user chose "sync the sort folders" over the APPEND move and the webmail filter.
