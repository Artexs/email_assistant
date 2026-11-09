# Live test of the sort-folder sync with AgentMail test mail

> Written 2026-11-09 by the sync-sort-folders session. For the agent that runs `tasks/active/test-mail-traffic.md` stage 9 and verifies the new sync on real Interia mail.

## Why this exists

The server now also syncs the Interia folders `Oferty`, `Społeczności`, `Rachunki` and the spam folder `Wiadomości-śmieci` (task `tasks/active/sync-sort-folders.md`, ADR `docs/decisions/0014-sync-provider-sort-folders.md`). It is deployed on the VPS since **2026-11-09 15:21 UTC** (`master` `0d39663`; this note on a later commit). Only 4 spam mails have arrived in `Oferty` since. No move on a synced-folder mail has run on Interia yet. Your test mail is the first real traffic that can show whether the sync, the triage plan and the moves work, and whether Interia sorts a moved mail back (F12). One task needs your results to close: `sync-sort-folders` stage 17.

## What the user decided

- The `test-mail-traffic` block is lifted (user, 2026-11-09: use the test mail to verify the new sync). `deliver` is not needed: the sync reads the folders. Stage 9 of your task starts now. Q1 is answered (option b, "Run it now.", log of 2026-11-08): the exclusion lines are in both pilot-week files. Check them once.
- Never tap approve for a test mail in Telegram. The rest of the sync-sort-folders task is closed by another agent; you do not edit `tasks/active/sync-sort-folders.md`.

## What to do (in this order)

1. In your worktree: `git merge origin/master` (use `GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes"` for fetch and push). Read `notes/2026-11-03-interia-imap-capabilities.md` § "Folder facts for the sort-folder sync" and `docs/known-alerts.md` (the new sync alerts).
2. Check the VPS read-only: `ssh home_vm`, `~/email_assistant`, `git log -1` = the merge `0d39663` or later, `max(version)` in `schema_migrations` = `20261109083501`, `select key, enabled, last_uid from mailbox_folders where mailbox_id = '8bc7f572-a7f5-4fa5-aaab-db16dc663e96'` shows 5 rows (inbox, offers, social, bills, junk), all enabled.
3. Run your stage 9.1 smoke batch (3 mails). Then a wider batch with these categories, so the sync meets every path: `needs_reply`, `urgent`, `info`, `notification`, `spam` (obvious marketing), and one VIP-like sender if your tool has one. Several mails of the same kind help: Interia, not you, decides the folder.
4. Wait about 10 minutes (the sync runs at minute 0, 5, 10 … of every hour; triage runs every 15 s; the committer every 15 s). Then for each test mail write down **where Interia put it** (`emails.source_folder`) and what the server did. Read-only SQL on the VPS (`C="docker compose -f deploy/compose.yaml --env-file .env"`; `$C exec -T db psql -U postgres -d email_assistant …`; never print `.env`):
   - `select e.source_folder, e.folder, t.category, a.type, a.status, a.payload->>'folder' as target from emails e join triage_results t on t.email_id = e.id left join actions a on a.email_id = e.id where e.created_at > '2026-11-09T15:21:00Z' and <your test-mail filter> order by 1, 3, 4;`
   - Match mail to your batch with your tool's `compare` (`bun run testmail:remote compare --batch <id>`) and the test-mail filter of the pilot-week notes; write counts and categories, never a subject or address.
5. Compare with what the plan says (D11, D12, U5–U7 in the task file; stage 14 Results show the same on GreenMail):
   - Mail in `Oferty`/`Społeczności`/`Rachunki` is planned like INBOX mail: `urgent` → `flag`; `needs_reply` → no action; `info` → `save_summary` + move to the `AI` info folder; `notification` → `mark_read` + move to `AI/Notifications` (only when `auto` is on for it; otherwise the move is `logged`); `spam` → move `ai_spam` `logged` (auto off).
   - Mail in `Wiadomości-śmieci` (only if Interia puts a test mail there): `spam` → no action, the mail stays; `urgent`/`needs_reply`/`delegation` → one move `inbox` (`logged`, or `applied` when `auto` is on for the category), no flag, no draft, no send; no urgent notice for it (D23).
   - The digest (`/digest` in Telegram, or the `outbox` rows) shows `· 📁 <folder>` on non-INBOX mail, and `→ stays in <folder>` for a mail that stays. An urgent mail from `Oferty` gets an urgent notice `🔴 Urgent mail · 📁 Oferty`.
   - A `needs_reply`/`delegation` mail from INBOX may get a draft and an approval prompt (S4). Do not approve.
6. **Re-sort watch (the main risk).** 15 and 60 minutes after the first applied move: `select count(*) from audit_log a join emails e on e.id = a.email_id and e.org_id = a.org_id where a.event = 'email.returned' and a.created_at > '2026-11-09T15:21:00Z';` and `select count(*) from triage_feedback where source = 'imap_move' and created_at > '2026-11-09T15:21:00Z';` → both 0. A count above 0 with no user action = Interia sorted a moved mail back. Then switch moves off at once (`$C run --rm server bun run mailbox:settings switch --org-id ac6ed6a2-ee37-461f-9632-cc08cf549e40 --mailbox-id 8bc7f572-a7f5-4fa5-aaab-db16dc663e96 --name move --value off`), write the fact, and stop for the user.
7. Rescue check (NV2): if a test mail ends in `Wiadomości-śmieci` and gets a move `inbox` `applied`, check that its row has `folder` = INBOX, `source_folder` = `Wiadomości-śmieci`, and that it is still in INBOX after 1 hour.
8. `$C logs --since 1h server | grep -E 'failed|tries again|not on the server|in a row|auth_error'` → expect nothing (`createLog` prints no level word, so grep message patterns). Look at `docs/known-alerts.md` for any line you find.
9. `$C run --rm server bun run mailbox:audit --org-id <ORG> --mailbox-id <MB> --since 2026-11-09T15:21:00Z` → the INBOX line `missing=0 duplicates=0`; per folder lines `missing=0`; `cross` is not a problem (exit code 0).

## What to hand back

Write `notes/2026-11-09-sort-folders-live-test-results.md` in the repo (master mode, a temporary detached worktree of `origin/master`; the main checkout holds other sessions' work; push `git push origin HEAD:master`). Content, counts only (no subject, no address, no token):

- the batch id, the number of mails per category, and a table: landing folder (`source_folder`) × category × action × status;
- each difference from step 5 (a finding = what, how many, which stage of the plan it contradicts);
- re-sort watch counts at 15 and 60 minutes; the rescue check; the log grep; the audit lines;
- the time of your last check.
  Tell the user in max 4 lines: pass or findings. A finding is a fix task in `tasks/planned/` and a stop for the user, not a hot fix.

## Closing sync-sort-folders (stage 17)

The close needs 24 h after the deploy: from **2026-11-10 15:21 UTC**. The handoff for it is `~/.pi/agent/notes/2026-11-09-handoff-sync-sort-folders-finish.md`. If you are still working then, you may do stage 17 yourself with your results (the handoff has all steps; edit only in a temporary detached worktree of `origin/master`). Otherwise the user starts a new agent with that handoff file; your results note is its evidence.

## Traps

- Each test mail costs one classifier call and shows in the user's Telegram digest; urgent ones send an urgent notice. Start with the smoke batch; keep the wide batch to about 15–20 mails.
- Do not run this while S3 or S4 VPS stages (19, 20) run. The S3 and S4 pilot weeks end 2026-11-14 (S3 20:00Z, S4 part B 22:40Z); the pilot-week notes already count test mail apart.
- `ACTIONS_SCOPE=all` and `SEND_SCOPE=all` on the VPS: test mail gets real moves; never approve a send.
- The VPS disk is 90 % used (2.3 GB free). Do not build big images on it; `docker compose run --rm` one-offs only, no deploy.
- Interia re-sorts a COPY into `Oferty` or INBOX after about 4–5 minutes (F12). That is why the Undo into a sort folder uses APPEND. An Undo tap needs the real Telegram: only the user can tap ↩️.
