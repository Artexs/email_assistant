> **Status 2026-11-12 — part A open (needs the user's phone); part B blocked until 2026-11-14T22:40Z.** S4 code is done and deployed (`spec/features/done/2026-11/F006-s4-drafts-approvals-delegation/plan.md`). Left: the real-mail checks that S4 closed without: part A (the first real round trip, no result yet), part B (the one-week counts).
> **Blocked until:** part A: nothing (since 2026-11-08T06:00Z; keep approvals out of quiet hours 22:00–07:00 Warsaw). Part B from 2026-11-14T22:40Z (7 × 24 h after `<START>`). Before part B an agent may only watch (`/status`, the server log, read-only SQL) and help the user stop sends (`SEND_SCOPE=off` + restart, or `/pause`). Check `date -u` first.

# S4 pilot week: real-mail checks of drafts, approvals, delegation

Scope: the S4 checks that need the real Interia server, the real phone and real mail. S4 closed on 2026-11-07 with the code done, all tests and reviews PASS, and a dev run on GreenMail with `tools/fake-telegram` (stage 19). The full step text is in `spec/features/done/2026-11/F006-s4-drafts-approvals-delegation/stages/stage-22-vps-deploy-self-send.md` (step 22.2) and `stage-23-first-real-delegation.md` (step 23.2).
Git mode: master.

## Goal

Prove S4 on real mail: a real draft in `Wersje robocze`, a real approval on the phone, a real SMTP send with the Sent copy, a reply that marks the delegation answered, a reminder; then one week of counts.

## Input

- VPS: `ssh home_vm`, `cd ~/email_assistant`, `C="docker compose -f deploy/compose.yaml --env-file .env"`. Read-only SQL: `$C exec -T db psql -U postgres -d email_assistant -c "<SQL>"`. Never print or edit `.env` (the user edits it).
- Pilot ids: org `<ORG>` = `ac6ed6a2-ee37-461f-9632-cc08cf549e40`, mailbox `<MB>` = `8bc7f572-a7f5-4fa5-aaab-db16dc663e96`.
- VPS state (2026-11-07 22:40Z): `master` `fa60c7b`, S4 migration applied, `SEND_SCOPE=all` (the user's decision; the user skipped the `self` round trip of stage 22.2), `SEND_TEST_ADDRESSES` = the user's Gmail, `ACTIONS_SCOPE=all`, mode `assist`, `create_draft` on.
- The only delegate: "Test delegate" `3532bf8f-0e43-4da5-bc55-05a578261f5a` = the user's own Gmail (tags `test`). No other person is a delegate (the user's choice).
- `<START>` = 2026-11-07T22:40:00Z.
- Risk (live since `<START>`): with `SEND_SCOPE=all`, a clarification question can go to a real external sender after the user's tap. The user checks the recipient before each tap.

## Done when

- Part A: the user confirms in webmail, Gmail and on the phone: the draft in `Wersje robocze`, the approval message, the send (Gmail got it, the copy is in `Wysłane`, the draft is gone), the reply → `answered` → `✅ Done`, one reminder after `📤 Send all`, one reject (the draft removed). The facts are in § Results and in `notes/2026-11-03-interia-imap-capabilities.md`.
- Part B: the step 23.2.3 queries ran after `<START>` + 7 days; their tables (counts only) are in § Results; injection incidents = the user's answer (expected 0).
- The S4 state line in `docs/roadmap.md` holds the week result.

## Test mail in the week (2026-11-08)

From 2026-11-08 the AgentMail test tool (`spec/features/done/2026-11/F036-test-mail-traffic/plan.md`, stage 9; user decision Q1 option (b): "Run it now.") sends about 28 made-up mails
from `ea-testmail-75wd@agentmail.to` to the pilot mailbox. The server acts on them like on real mail: `needs_reply` or `delegation` test mail can get a draft and
an approval message. Never approve a send for a test mail: reject it (`✖️ Reject`) or let it expire.

- A1: approvals of test mail do not count in `Approvals: 0 waiting`.
- B2: add `and lower(e.from_address) is distinct from 'ea-testmail-75wd@agentmail.to'` to every `emails e` join of the step 23.2.3 queries.

## Sort-folder sync (2026-11-09 15:21 UTC)

From 2026-11-09 15:21 UTC the server also syncs `Oferty`, `Społeczności`, `Rachunki` and `Wiadomości-śmieci` (`spec/features/done/2026-11/F058-sync-sort-folders/plan.md`). Their mail can get moves into `AI/*` (and spam folder mail into INBOX). Count drafts, approvals and sends for all mail and with `e.source_folder = 'INBOX'`.

## Plan

- [x] A1. `date -u` ≥ 2026-11-08T06:00Z. `/status` on the phone: `Send: real delegates of the test mailbox (SEND_SCOPE=all)`, `Approvals: 0 waiting`.
- [x] A2. Step 22.2 steps 1–10 of the stage 22 file, with the Gmail as both the task sender and the delegate: task mail `Oferta dla firmy X` from Gmail to the pilot address; SQL and webmail checks; tap `📤 Send`; reply `Zrobione.`; reminder (`due_at` back 1 day, `job:run --name delegation.chaser --force`); a third mail → `✖️ Reject`; logs with no `error`, address, subject or task text; `mailbox:audit --since <t0>`. (done 2026-11-14 with deviations: AgentMail was the task sender; the reject step was skipped by the owner; see § Results.)
- [x] A3. Write the facts into § Results and the Interia note (the 250 line shape, `sent_copy`, how Interia shows the draft, the `From` display in Gmail; check Gmail spam).
- [ ] B1. Daily: `/status`, the digest lines, `$C logs --since 24h server | grep -cE "\[(actions|delegation)\].*error"` → 0.
- [ ] B2. `date -u` ≥ 2026-11-14T22:40Z. Run the step 23.2.3 queries with `<START>` and the test-mail exclusion (§ "Test mail in the week") (sends by outcome, delegations by status, approval time, notices; real mail only); `triage:cost --days 7`; ask the user for wrong drafts and injection incidents.
- [ ] B3. Write the tables in § Results; update the S4 state line in `docs/roadmap.md`; add a result line to `spec/features/done/2026-11/F006-s4-drafts-approvals-delegation/plan.md` (the one allowed edit of a done file; name this task).
- [ ] B4 (owner answer recorded 2026-11-14: keep `SEND_SCOPE=all`; the move to `done/` is the coordinator's). Ask the user: keep `SEND_SCOPE=all`, add real delegates, or go back to `self`. Then `git mv` this file to `tasks/done/`.

## Results

### Part A: one real delegation round trip (2026-11-14, F095 stage 10)

Source: the owner's U1 session on the phone, raw facts in a local file outside the repo (`/tmp/f095-u1/u1-facts.md`, not committed). VPS commit at the start: `2edbfef`; at the end: `65164fde` (the server restarted at 11:42Z, a coordinator deploy). Time at the start: 12:08 Warsaw (inside 07:00–21:00).

**Result: passed, with item 8 (reject) skipped by the owner.** The owner decided at 12:43 to skip it ("skip as many as possible"); the reject path was not tested in part A.

Deviation from the runbook: the task mails (items 4, 7) came from the AgentMail test inbox, not from the owner's Gmail (owner choice). The reply (item 6) came from the delegate Gmail. The bot message showed the "external sender" warning (expected for an AgentMail sender).

| Item | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–2  | State before: test delegate `active = t` (the `delegates` table has an `active` column, no status column); `send` actions in `awaiting_approval` or `approved`: 0; `SEND_SCOPE=all`; db and server healthy; `llm:check` exit 0. Owner `/status` at 12:14: `SEND_SCOPE=all`, 0 approvals, 0 delegations waiting, 0 overdue.                                                                                                                                                                                                                                                                                                    |
| 3–4  | Mail 1 received 11:16:47Z. Triage `delegation` (`direct_request`); `create_draft` `applied`, `provider_result` folder `Wersje robocze`; `send` `awaiting_approval`; delegation `drafted`. Owner check: the draft is in the Interia webmail folder **`Kopie robocze`** (not `Wersje robocze`); it opens as a compose window with the owner name and address in From, `Test delegate` in To, subject `Fwd: …`, the quote in the body.                                                                                                                                                                                           |
| 5    | Tap `📤 Send` at 12:23. `send` `applied`; `sent_copy` = `appended`; SMTP line `250 OK. ID: <id>`; delegation `sent`; reverse draft row `applied`. Phone notice `Sent to Test delegate` at 12:24. Owner checks: Gmail got the mail in Inbox (not spam); From shows the owner name and address, "signed-by/sent from interia.pl", standard TLS; quote present; Interia `Wysłane` holds the copy (thread with 2 items: the 12:20 draft and the 12:24 sent mail); `Kopie robocze` empty after the send.                                                                                                                           |
| 6    | The owner replied `zrobione` (lowercase, no full stop) from the delegate Gmail at 12:28 in the thread. The delegation became `answered` (`answered_at` and `answered_notified_at` set) within about 2 minutes. The phone showed `Test delegate answered … Tap Done`; the owner tapped `✅ Done` at 12:31; delegation `done`.                                                                                                                                                                                                                                                                                                  |
| 7    | Mail 2 sent 11:31:09Z; second delegation `drafted`; draft visible in `Kopie robocze`; approved at 12:36 (`sent_copy` = `appended`, delegation `sent`, default `due_at` = +3 days). Backup first: `backup ok ea-20261114T113901Z.dump.age 395087`. At 12:39 the two pre-approved writes: `due_at` back 1 day (`UPDATE 1`), then `delegation.chaser --force` logged `due 1, overdue 1, reminders 1`. Owner tapped `📤 Send all`: reminder `send` `applied` (`approved_via` telegram, `sent_copy` `appended`); delegation `overdue`, `reminders_sent` = 1, `last_reminder_at` set. Gmail got the reminder, subject `Re: Fwd: …`. |
| 8    | **Skipped by the owner.** Mail 3 was sent at 11:41:30Z; its approval stays pending on the phone (nobody taps it). It must not be approved (§ "Test mail in the week").                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 9    | Logs, last 60 minutes at 12:44: 17 lines; error lines 0; lines with `@`: 1 (the Telegram startup line with the bot username, no mail address; a false positive, logged at 11:42Z).                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Open points (observed, not explained; no check was run on them in this stage):

- The reminder shows in the Gmail list as its own row, separate from the 12:36 `Fwd:` row. The runbook expected one thread. The owner did not say whether Gmail grouped them in the conversation view.
- Mail 2 has an extra `create_draft` row with status `undone` (the reverse draft; for mail 1 the reverse draft row was `applied`). The cause is not known.
- The draft text of mail 2 differed in wording from mail 1 (the LLM wording varies).
- The `provider_result` folder value is `Wersje robocze`, but Interia webmail shows the folder as `Kopie robocze`.

### Part B: owner answers (asked in the U1 session, 2026-11-14 12:46)

The week tables (D16 window, counts only) are written by F095 stage 09.

- Wrong drafts in the pilot week: 0 ("all are fine").
- Injection incidents: 0 ("zero or all are fine").
- B4, keep `SEND_SCOPE=all` and the one test delegate: "I suppose yes … I didn't change it for a few days". The owner did not re-check the setting; `/status` at 12:14 showed `SEND_SCOPE=all`. Treated as keep (default Q5 of F095).

## S5e deploy (2026-11-11 23:37:21 UTC)

- The web panel deploy restarted the server at T = 2026-11-11 23:37:21 UTC (commit `8f6a8b2`). The jobs are crash-safe; sync ticks ran as before and there were 0 `error` lines in the first 150 minutes (digest and committer ticks were not checked one by one).
- The pilot mailbox was paused at 23:46:15 UTC and resumed at 23:46:17 UTC (smoke of the panel; 2 seconds).
- New feedback source: `triage_feedback.source = 'web'` (the panel's ✅, ✏️ and ↩️). Count it together with `telegram` for the feedback numbers. 39 `web` ✅ rows (verdict `right`) exist from the smoke at 23:54–00:03 UTC (about 14 seconds per mail; the user did not say whether each category was checked, so treat them as unverified and consider excluding that window).

## Log

- 2026-11-07: created at the S4 close (the user's decision): the real-mail checks of S4 stages 22.2 and 23.2 moved here.
