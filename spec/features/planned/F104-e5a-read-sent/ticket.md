---
opened: 2026-11-13
---

# F104 · E5a Read Sent

## Outcome

The assistant knows what the executive sent: it reads the Sent folder of each mailbox, never changes it, and keeps that mail apart from incoming mail. The owner sees a switch "Track my sent mail" per mailbox, on for new mailboxes with one plain line at connect, off for existing ones. Later features (open loops, the history check, reply drafts, sender context) read one "answered by the user" mark and the sent times. The whole feature stays off for an organization until its flag `sent_sync` is on (ADR 0029).

## Scope

- Row 10 of `docs/product/stage-2/05-execution-plan.md` §2.1; decisions in `docs/product/stage-2/epics/E05-open-loops.md` § Discovery, `E05-discovery-notes.md` §4.1, PD-115–PD-117, PD-129, ADR 0029.
- Start at the `mail.sync` job (`apps/server/src/modules/mail/jobs.ts`): one read-only pass over the Sent folder per run, with its own cursor and table.
- The switch in the mailbox settings (web, CLI, connect), the 7-day "no sent mail seen" notice, retention, docs, the pilot deploy.
- Decisions, stages and seams: [plan.md](plan.md).

## Out of scope

- The open-loop features built on this data (sent-mail analysis by the LLM, loops, follow-ups, the "needs you today" brief): E5b, F116.
- The Sent pass right before a system send of a reply draft: the reply-draft ticket (E6a, F115) wires it into the committer.
- The DSR address map and the organization-delete test of the account-data ticket (E7-T3, F106): this plan names the new columns for it.

## Acceptance

- With the flag and the switch on, a sync run stores the sent mail of the last 30 days (text for the last 14 days); a GreenMail test shows the Sent mail keeps its flags and UIDs.
- A system send in Sent is linked to its action and never counts as the user's mail.
- An incoming mail that the user answered from a mail app reads as "answered by the user" with the reply time.
- The settings page shows the switch and a status line; turning it off deletes the stored sent mail.
- A mailbox with the switch on and no sent mail for 7 days gets one Telegram notice per owner.
- On the pilot mailbox, after the owner turns the switch on, `bun run mailbox:settings show` prints a stored count above 0.

## Slices

One worker job per stage, 01 → 12, each after the one before has landed (`plan.md` § How to run). Stages 01 and 11 add a migration: never next to another migration in build. Stage 12 is a coordinator runbook on the VPS with owner step U1 (the owner turns the pilot switch on).

## Sequenced

- Plan after: none (the plan uses only landed code: the `sent_sync` flag and the content capture of the measure ticket, F100 stage 02).
- Build after: F095 (E1), F099 (E7-T2), both in `spec/features/done/`.
- Gate: —
