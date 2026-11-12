> **Status 2026-11-07 — blocked until 2026-11-08T06:00Z (part A), 2026-11-14T22:40Z (part B).** S4 code is done and deployed (`tasks/done/s4-drafts-approvals-delegation.md`). Left: the real-mail checks that S4 closed without: part A (the first real round trip), part B (the one-week counts).
> **Blocked until:** part A from 2026-11-08T06:00Z (07:00 Warsaw: quiet hours 22:00–07:00 hold approval messages before then). Part B from 2026-11-14T22:40Z (7 × 24 h after `<START>`). Before then an agent may only watch (`/status`, the server log, read-only SQL) and help the user stop sends (`SEND_SCOPE=off` + restart, or `/pause`). Check `date -u` first.

# S4 pilot week: real-mail checks of drafts, approvals, delegation

Scope: the S4 checks that need the real Interia server, the real phone and real mail. S4 closed on 2026-11-07 with the code done, all tests and reviews PASS, and a dev run on GreenMail with `tools/fake-telegram` (stage 19). The full step text is in `tasks/done/s4-drafts-approvals-delegation/stage-22-vps-deploy-self-send.md` (step 22.2) and `stage-23-first-real-delegation.md` (step 23.2).
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

From 2026-11-08 the AgentMail test tool (`tasks/done/test-mail-traffic.md`, stage 9; user decision Q1 option (b): "Run it now.") sends about 28 made-up mails
from `ea-testmail-75wd@agentmail.to` to the pilot mailbox. The server acts on them like on real mail: `needs_reply` or `delegation` test mail can get a draft and
an approval message. Never approve a send for a test mail: reject it (`✖️ Reject`) or let it expire.

- A1: approvals of test mail do not count in `Approvals: 0 waiting`.
- B2: add `and lower(e.from_address) is distinct from 'ea-testmail-75wd@agentmail.to'` to every `emails e` join of the step 23.2.3 queries.

## Sort-folder sync (2026-11-09 15:21 UTC)

From 2026-11-09 15:21 UTC the server also syncs `Oferty`, `Społeczności`, `Rachunki` and `Wiadomości-śmieci` (`tasks/done/sync-sort-folders.md`). Their mail can get moves into `AI/*` (and spam folder mail into INBOX). Count drafts, approvals and sends for all mail and with `e.source_folder = 'INBOX'`.

## Plan

- [ ] A1. `date -u` ≥ 2026-11-08T06:00Z. `/status` on the phone: `Send: real delegates of the test mailbox (SEND_SCOPE=all)`, `Approvals: 0 waiting`.
- [ ] A2. Step 22.2 steps 1–10 of the stage 22 file, with the Gmail as both the task sender and the delegate: task mail `Oferta dla firmy X` from Gmail to the pilot address; SQL and webmail checks; tap `📤 Send`; reply `Zrobione.`; reminder (`due_at` back 1 day, `job:run --name delegation.chaser --force`); a third mail → `✖️ Reject`; logs with no `error`, address, subject or task text; `mailbox:audit --since <t0>`.
- [ ] A3. Write the facts into § Results and the Interia note (the 250 line shape, `sent_copy`, how Interia shows the draft, the `From` display in Gmail; check Gmail spam).
- [ ] B1. Daily: `/status`, the digest lines, `$C logs --since 24h server | grep -cE "\[(actions|delegation)\].*error"` → 0.
- [ ] B2. `date -u` ≥ 2026-11-14T22:40Z. Run the step 23.2.3 queries with `<START>` and the test-mail exclusion (§ "Test mail in the week") (sends by outcome, delegations by status, approval time, notices; real mail only); `triage:cost --days 7`; ask the user for wrong drafts and injection incidents.
- [ ] B3. Write the tables in § Results; update the S4 state line in `docs/roadmap.md`; add a result line to `tasks/done/s4-drafts-approvals-delegation.md` (the one allowed edit of a done file; name this task).
- [ ] B4. Ask the user: keep `SEND_SCOPE=all`, add real delegates, or go back to `self`. Then `git mv` this file to `tasks/done/`.

## Results

(empty until part A runs)

## S5e deploy (2026-11-11 23:37:21 UTC)

- The web panel deploy restarted the server at T = 2026-11-11 23:37:21 UTC (commit `8f6a8b2`). The jobs are crash-safe; sync ticks ran as before and there were 0 `error` lines in the first 150 minutes (digest and committer ticks were not checked one by one).
- The pilot mailbox was paused at 23:46:15 UTC and resumed at 23:46:17 UTC (smoke of the panel; 2 seconds).
- New feedback source: `triage_feedback.source = 'web'` (the panel's ✅, ✏️ and ↩️). Count it together with `telegram` for the feedback numbers. 39 `web` ✅ rows (verdict `right`) exist from the smoke at 23:54–00:03 UTC.

## Log

- 2026-11-07: created at the S4 close (the user's decision): the real-mail checks of S4 stages 22.2 and 23.2 moved here.
