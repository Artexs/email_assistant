> **Status 2026-11-08 — planned.** The user answered the questions (see "User decisions"). Left: the detailed plan (`plan-task`, handoff `~/.pi/agent/notes/2026-11-08-handoff-sync-sort-folders-plan.md`), then the build (`run-task`) and a VPS deploy.

# Sync the Interia sort folders and the spam folder (Oferty, Społeczności, Rachunki, Wiadomości-śmieci)

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

> "1. yes, but all the emails there should be treated and processed by the internal tool, i mean most of the spam emails should be rejected. but sometimes there are few valuable emails. so perhaps its good to check them also. so app will check all the emails from inbox."
> "All other answers are default ones. Your suggested answers."
> "So I assume that's a completely new plan of implementation, so you should prepare me a handoff for detailed planning session for it."

## User decisions (2026-11-08)

- **U1 Folders:** sync INBOX, `Oferty`, `Społeczności`, `Rachunki` **and** the Interia spam folder `Wiadomości-śmieci`. Every mail there goes through the
  normal pipeline (rules, classifier): most spam folder mail ends as `spam`, but a valuable mail there must be found. The app's own folders (`AI`, `AI/*`)
  and `Wysłane`, `Wersje robocze`, `Kosz` stay out.
- **U2 Actions:** the committer acts on mail from every synced folder like on INBOX mail (moves into `AI/*`); Undo returns it to the folder it came from.
- **U3 First sync of a new folder:** only mail of the last 24 hours.
- **U4 Deploy:** now (do not wait for 2026-11-14), with a note in both pilot-week tasks.

## Goal

The sync reads INBOX and the Interia sort folders, stores and triages their mail like INBOX mail, and the actions and undo work for mail from every synced folder.

## Done when

- New mail in `Oferty`, `Społeczności`, `Rachunki` or `Wiadomości-śmieci` is stored, triaged, and shows in the digest (dev with GreenMail, then the VPS).
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

## Open points for the planner

- Spam folder mail and the rules: a blocklist hit stays `spam` with no LLM call; a whitelist or VIP sender in the spam folder gets the normal category list.
  Decide whether a `spam` result for spam-folder mail moves it into `AI/Spam` or leaves it in `Wiadomości-śmieci` (fewer writes; the user decides if unclear).
- LLM cost: the spam folder can hold much mail; check the daily cap and the Gemini quota (`docs/decisions/0012-llm-data-and-cost.md`).
- Folder names differ per provider: the Interia names are fixed strings now (`SORT_FOLDER_NAMES` in `packages/core/src/testmail/delivery.ts`); the planner
  decides where the list of synced folders lives (mailbox setting, `folder_map`, or provider defaults).
- Return detection (`sync-rules.ts`, "returned below cursor") and the user-move detection must work across folders.

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
- 2026-11-08: User answers: U1 also the spam folder (all mail is checked), U2–U4 the defaults. Handoff for the planning session written.
