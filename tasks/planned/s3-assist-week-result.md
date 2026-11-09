> **Status 2026-11-07 — blocked until 2026-11-14T20:00Z.** The one-week `assist` run on real mail is in progress. Left: the result queries, the N ≤ 3 check, the S3 close-out lines.
> **Blocked until:** 2026-11-14T20:00Z (7 × 24 h after `<START>` = 2026-11-07T19:55:16Z). Reason: the result needs one full week of real mail. Before then an agent may only watch (`/status`, the server log, read-only SQL) and help the user with an Undo or a stop (`/pause`, `mailbox:settings mode --mode shadow`). Check `date -u` first.

# S3 one-week assist result

Scope: the last done-when item of S3 (`tasks/done/s3-assist-actions.md`, user decision P2): one week of `assist` mode with at most N = 3 wrong moves. Needs: S3 (done, deployed). The full step text is step 20.2 of `tasks/done/s3-assist-actions/stage-20-one-week-assist-run.md`.

## Goal

Measure the first week of `assist` on the pilot mailbox and decide: S3 passes (N ≤ 3), or the user changes the categories and the week runs again.

## Input

- VPS: `ssh home_vm`, `cd ~/email_assistant`, `C="docker compose -f deploy/compose.yaml --env-file .env"`. Read-only SQL: `$C exec -T db psql -U postgres -d email_assistant -c "<SQL>"`. Never print or edit `.env`.
- Pilot ids: org `<ORG>` = `ac6ed6a2-ee37-461f-9632-cc08cf549e40`, mailbox `<MB>` = `8bc7f572-a7f5-4fa5-aaab-db16dc663e96`.
- `<START>` = 2026-11-07T19:55:16Z. `ACTIONS_SCOPE=all` in the VPS `.env`. Mode `assist`.
- Categories (S3 step 20.1, the user took the default option B): `urgent` flag; `notification` `auto` on with `--force` (go/no-go no-go, precision 0.962, kept 53); `info` and `spam` `auto` off.
- The VPS runs the detached commit `00588d7` (all of S3, no S4 code). The S4 deploy must `git checkout master` first.

## Done when

- The step 20.2 queries ran after `<START>` + 7 days, right after a sync, and their tables (counts only) are in § Results.
- N (wrong moves of real mail) is written down: N ≤ 3 → S3 passes; N > 3 → the user decides (a category back to `auto off` and a new week, or S3 closes with the number and a follow-up task).
- Audit coverage query → 0 (every applied action has an `action.applied` row).

## Test mail in the week (2026-11-08)

From 2026-11-08 the AgentMail test tool (`tasks/active/test-mail-traffic.md`, stage 9; user decision Q1 option (b): "Run it now.") sends about 28 made-up mails
from `ea-testmail-75wd@agentmail.to` to the pilot mailbox. The server triages and moves them like real mail. The step 20.2.3 queries exclude only
`%@ea-seed.test>` mail, so add `and lower(e.from_address) is distinct from 'ea-testmail-75wd@agentmail.to'` to every `emails e` join (also in N, the wrong
moves). A `wrong` verdict on a test mail is not a wrong move of real mail.

## Sort-folder sync (TBD)

From TBD (UTC) the server also syncs `Oferty`, `Społeczności`, `Rachunki` and `Wiadomości-śmieci` (`tasks/active/sync-sort-folders.md`). Their mail can get moves into `AI/*` (and spam folder mail into INBOX). Report N (wrong moves) twice: for all real mail, and with `and e.source_folder = 'INBOX'` in every `emails e` join (the mail that the week started with). Spam folder mail with a `spam` result has no action.

## Plan

- [ ] 1. `date -u` ≥ 2026-11-14T20:00Z. Read step 20.2 of the stage 20 file.
- [ ] 2. Run the queries of step 20.2.3 with `<START>` above and the test-mail exclusion (§ "Test mail in the week"): applied by type, wrong moves (N), failed, audit coverage, returns; `mailbox:audit --since <START>` with the D18 reading; `triage:cost --days 7`.
- [ ] 3. Write the tables in § Results. Tell the user N and the counts.
- [ ] 4. N > 3: stop and ask the user (step 20.2.4).
- [ ] 5. Close-out: update the S3 state line in `docs/roadmap.md` (the week result); tick the done-when item in `tasks/done/s3-assist-actions.md` with a log line (a link fix in a done file is allowed; a result line is the one exception, name this task); remind the user to delete the Keychain entry on the Mac: `security delete-generic-password -s ea-interia-imap`.
- [ ] 6. `git mv` this file to `tasks/done/`.

## Results

(empty until the week ends)

## Log

- 2026-11-07: Created when S3 closed; the week started at `<START>`.
