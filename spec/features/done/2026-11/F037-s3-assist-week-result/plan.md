> **Status 2026-11-07 — blocked until 2026-11-14T20:00Z.** The one-week `assist` run on real mail is in progress. Left: the result queries, the N ≤ 3 check, the S3 close-out lines.
> **Blocked until:** 2026-11-14T20:00Z (7 × 24 h after `<START>` = 2026-11-07T19:55:16Z). Reason: the result needs one full week of real mail. Before then an agent may only watch (`/status`, the server log, read-only SQL) and help the user with an Undo or a stop (`/pause`, `mailbox:settings mode --mode shadow`). Check `date -u` first.

# S3 one-week assist result

Scope: the last done-when item of S3 (`spec/features/done/2026-11/F005-s3-assist-actions/plan.md`, user decision P2): one week of `assist` mode with at most N = 3 wrong moves. Needs: S3 (done, deployed). The full step text is step 20.2 of `spec/features/done/2026-11/F005-s3-assist-actions/stages/stage-20-one-week-assist-run.md`.

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

From 2026-11-08 the AgentMail test tool (`spec/features/done/2026-11/F036-test-mail-traffic/plan.md`, stage 9; user decision Q1 option (b): "Run it now.") sends about 28 made-up mails
from `ea-testmail-75wd@agentmail.to` to the pilot mailbox. The server triages and moves them like real mail. The step 20.2.3 queries exclude only
`%@ea-seed.test>` mail, so add `and lower(e.from_address) is distinct from 'ea-testmail-75wd@agentmail.to'` to every `emails e` join (also in N, the wrong
moves). A `wrong` verdict on a test mail is not a wrong move of real mail.

## Sort-folder sync (2026-11-09 15:21 UTC)

From 2026-11-09 15:21 UTC the server also syncs `Oferty`, `Społeczności`, `Rachunki` and `Wiadomości-śmieci` (`spec/features/done/2026-11/F058-sync-sort-folders/plan.md`). Their mail can get moves into `AI/*` (and spam folder mail into INBOX). Report N (wrong moves) twice: for all real mail, and with `and e.source_folder = 'INBOX'` in every `emails e` join (the mail that the week started with). Spam folder mail with a `spam` result has no action.

## Plan

- [x] 1. `date -u` ≥ 2026-11-14T20:00Z. Read step 20.2 of the stage 20 file.
- [x] 2. Run the queries of step 20.2.3 with `<START>` above and the test-mail exclusion (§ "Test mail in the week"): applied by type, wrong moves (N), failed, audit coverage, returns; `mailbox:audit --since <START>` with the D18 reading; `triage:cost --days 7`.
- [x] 3. Write the tables in § Results. Tell the user N and the counts.
- [x] 4. N > 3: stop and ask the user (step 20.2.4).
- [ ] 5. (roadmap line and F005 result line written by F095 stage 09, 2026-11-14; the Keychain reminder is left for the user) Close-out: update the S3 state line in `docs/roadmap.md` (the week result); tick the done-when item in `spec/features/done/2026-11/F005-s3-assist-actions/plan.md` with a log line (a link fix in a done file is allowed; a result line is the one exception, name this task); remind the user to delete the Keychain entry on the Mac: `security delete-generic-password -s ea-interia-imap`.
- [ ] 6. `git mv` this file to `tasks/done/`.

## Results

### Week result (F095 stage 09, 2026-11-14)

Source: read-only SQL on the VPS through `ssh home_vm` at 2026-11-14 22:46 UTC, VPS commit `69473f4e`. Pilot org `ac6ed6a2-ee37-461f-9632-cc08cf549e40`, mailbox `8bc7f572-a7f5-4fa5-aaab-db16dc663e96`. Window: `<START>` = 2026-11-07T19:55:16Z to `<START>` + 7 days (decision D16: each `created_at >= <START>` has the end `created_at < <START> + interval '7 days'`). Real mail only: every `emails e` join holds `(e.message_id_header is null or e.message_id_header not ilike '%@ea-seed.test>') and lower(e.from_address) is distinct from 'ea-testmail-75wd@agentmail.to'`. Counts only; no mail row is printed. The queries are those of step 20.2.3 of the stage 20 file of F005 with the window end, plus the changes below.

Changes against the old queries:

- Wrong moves (N): the panel writes `source = 'web'` feedback (S5e deploy section), so the main N adds `or (f.source = 'web' and f.verdict = 'wrong')`. Four values: the old query, the main N, the main N with `e.source_folder = 'INBOX'`, and the `web` wrong rows alone. The verdict uses the main N.
- Audit coverage has no `emails` join in the old text: it has the window end only.
- Returns: counts by source, the `web` source alone, and the `web` rows of the S5e smoke window (the section above says 23:54–00:03 UTC; the rows are in minutes 23:54, 00:03 and 00:04, so the window here is 2026-11-11T23:54Z to 2026-11-12T00:05Z).

**Applied by type**

```sql
select a.type, a.status, count(*) from actions a join emails e on e.id = a.email_id and e.org_id = a.org_id where a.org_id = 'ac6ed6a2-ee37-461f-9632-cc08cf549e40' and a.reverses_action_id is null and a.created_at >= '2026-11-07T19:55:16Z' and a.created_at < '2026-11-07T19:55:16Z'::timestamptz + interval '7 days' and (e.message_id_header is null or e.message_id_header not ilike '%@ea-seed.test>') and lower(e.from_address) is distinct from 'ea-testmail-75wd@agentmail.to' group by 1, 2 order by 1, 2;
```

Result:

```
type|status|count
mark_read|applied|3
move|applied|3
move|logged|37
save_summary|applied|1
(4 rows)
```

**Wrong moves N, old query**

```sql
select count(distinct f.email_id) as n_old from triage_feedback f join emails e on e.id = f.email_id and e.org_id = f.org_id where f.org_id = 'ac6ed6a2-ee37-461f-9632-cc08cf549e40' and f.created_at >= '2026-11-07T19:55:16Z' and f.created_at < '2026-11-07T19:55:16Z'::timestamptz + interval '7 days' and (e.message_id_header is null or e.message_id_header not ilike '%@ea-seed.test>') and lower(e.from_address) is distinct from 'ea-testmail-75wd@agentmail.to' and ((f.source in ('undo', 'imap_move')) or (f.source = 'telegram' and f.verdict = 'wrong')) and exists (select 1 from actions a where a.email_id = f.email_id and a.org_id = f.org_id and a.reverses_action_id is null and a.type in ('move', 'mark_read', 'flag') and a.status in ('applied', 'undone') and a.created_at >= '2026-11-07T19:55:16Z' and a.created_at < '2026-11-07T19:55:16Z'::timestamptz + interval '7 days');
```

Result:

```
n_old
0
(1 row)
```

**Wrong moves N, main (adds `web` wrong)**

```sql
select count(distinct f.email_id) as n_main from triage_feedback f join emails e on e.id = f.email_id and e.org_id = f.org_id where f.org_id = 'ac6ed6a2-ee37-461f-9632-cc08cf549e40' and f.created_at >= '2026-11-07T19:55:16Z' and f.created_at < '2026-11-07T19:55:16Z'::timestamptz + interval '7 days' and (e.message_id_header is null or e.message_id_header not ilike '%@ea-seed.test>') and lower(e.from_address) is distinct from 'ea-testmail-75wd@agentmail.to' and ((f.source in ('undo', 'imap_move')) or (f.source = 'telegram' and f.verdict = 'wrong') or (f.source = 'web' and f.verdict = 'wrong')) and exists (select 1 from actions a where a.email_id = f.email_id and a.org_id = f.org_id and a.reverses_action_id is null and a.type in ('move', 'mark_read', 'flag') and a.status in ('applied', 'undone') and a.created_at >= '2026-11-07T19:55:16Z' and a.created_at < '2026-11-07T19:55:16Z'::timestamptz + interval '7 days');
```

Result:

```
n_main
0
(1 row)
```

**Wrong moves N, main, INBOX only**

```sql
select count(distinct f.email_id) as n_main_inbox from triage_feedback f join emails e on e.id = f.email_id and e.org_id = f.org_id where f.org_id = 'ac6ed6a2-ee37-461f-9632-cc08cf549e40' and f.created_at >= '2026-11-07T19:55:16Z' and f.created_at < '2026-11-07T19:55:16Z'::timestamptz + interval '7 days' and (e.message_id_header is null or e.message_id_header not ilike '%@ea-seed.test>') and lower(e.from_address) is distinct from 'ea-testmail-75wd@agentmail.to' and e.source_folder = 'INBOX' and ((f.source in ('undo', 'imap_move')) or (f.source = 'telegram' and f.verdict = 'wrong') or (f.source = 'web' and f.verdict = 'wrong')) and exists (select 1 from actions a where a.email_id = f.email_id and a.org_id = f.org_id and a.reverses_action_id is null and a.type in ('move', 'mark_read', 'flag') and a.status in ('applied', 'undone') and a.created_at >= '2026-11-07T19:55:16Z' and a.created_at < '2026-11-07T19:55:16Z'::timestamptz + interval '7 days');
```

Result:

```
n_main_inbox
0
(1 row)
```

**Wrong moves N, `web` wrong rows alone**

```sql
select count(distinct f.email_id) as n_web_wrong from triage_feedback f join emails e on e.id = f.email_id and e.org_id = f.org_id where f.org_id = 'ac6ed6a2-ee37-461f-9632-cc08cf549e40' and f.created_at >= '2026-11-07T19:55:16Z' and f.created_at < '2026-11-07T19:55:16Z'::timestamptz + interval '7 days' and (e.message_id_header is null or e.message_id_header not ilike '%@ea-seed.test>') and lower(e.from_address) is distinct from 'ea-testmail-75wd@agentmail.to' and f.source = 'web' and f.verdict = 'wrong' and exists (select 1 from actions a where a.email_id = f.email_id and a.org_id = f.org_id and a.reverses_action_id is null and a.type in ('move', 'mark_read', 'flag') and a.status in ('applied', 'undone') and a.created_at >= '2026-11-07T19:55:16Z' and a.created_at < '2026-11-07T19:55:16Z'::timestamptz + interval '7 days');
```

Result:

```
n_web_wrong
0
(1 row)
```

**Failed**

```sql
select a.status_reason, count(*) from actions a join emails e on e.id = a.email_id and e.org_id = a.org_id where a.org_id = 'ac6ed6a2-ee37-461f-9632-cc08cf549e40' and a.status = 'failed' and a.created_at >= '2026-11-07T19:55:16Z' and a.created_at < '2026-11-07T19:55:16Z'::timestamptz + interval '7 days' and (e.message_id_header is null or e.message_id_header not ilike '%@ea-seed.test>') and lower(e.from_address) is distinct from 'ea-testmail-75wd@agentmail.to' group by 1;
```

Result:

```
status_reason|count
(0 rows)
```

**Audit coverage (expected 0)**

```sql
select count(*) from actions a where a.org_id = 'ac6ed6a2-ee37-461f-9632-cc08cf549e40' and a.status in ('applied', 'undone') and a.created_at >= '2026-11-07T19:55:16Z' and a.created_at < '2026-11-07T19:55:16Z'::timestamptz + interval '7 days' and not exists (select 1 from audit_log l where l.action_id = a.id and l.org_id = a.org_id and l.event = 'action.applied');
```

Result:

```
count
0
(1 row)
```

**Returns by source**

```sql
select source, count(*) from triage_feedback where org_id = 'ac6ed6a2-ee37-461f-9632-cc08cf549e40' and created_at >= '2026-11-07T19:55:16Z' and created_at < '2026-11-07T19:55:16Z'::timestamptz + interval '7 days' group by 1 order by 1;
```

Result:

```
source|count
web|39
(1 row)
```

**Returns, `web` only**

```sql
select count(*) from triage_feedback where org_id = 'ac6ed6a2-ee37-461f-9632-cc08cf549e40' and source = 'web' and created_at >= '2026-11-07T19:55:16Z' and created_at < '2026-11-07T19:55:16Z'::timestamptz + interval '7 days';
```

Result:

```
count
39
(1 row)
```

**Returns, `web` rows of 2026-11-11 23:54 to 2026-11-12 00:03 (as the S5e section states it)**

```sql
select count(*) from triage_feedback where org_id = 'ac6ed6a2-ee37-461f-9632-cc08cf549e40' and source = 'web' and created_at >= '2026-11-11T23:54:00Z' and created_at < '2026-11-12T00:03:00Z';
```

Result:

```
count
3
(1 row)
```

**Extra check, S5e window (as run on 2026-11-14)**

```sql
select count(*) from triage_feedback where org_id = 'ac6ed6a2-ee37-461f-9632-cc08cf549e40' and source = 'web' and created_at >= '2026-11-11T23:54:00Z' and created_at < '2026-11-12T00:05:00Z';
```

Result: 39 (all of the `web` rows of the week have verdict `right`: 3 in minute 23:54, 15 in 00:03, 21 in 00:04).

**triage:cost** (`bun run triage:cost --org-id <ORG> --mailbox-id <MB> --days 7`, run on 2026-11-14 22:46 UTC; it counts back from now, so its window is 2026-11-07T22:46Z to 2026-11-14T22:46Z, not `<START>` + 7 days): model `gpt-6-luna`, 77 LLM results (11.00 per day), average tokens in/out 2445 / 74, latency p50 / p95 3098 ms / 5073 ms, average cost per mail $0.0003, $0.0929 per mailbox per month at 11 mails per day, $1.6891 at 200 mails per day.

**mailbox:audit** (`bun run mailbox:audit --org-id <ORG> --mailbox-id <MB> --since 2026-11-07T19:55:16Z`; read-only: it uses IMAP search and fetch, no move, append, delete or flag; exit code 2):

```
inbox:  mail=11 stored=13 missing=0 duplicates=2 cross=0
offers: mail=65 stored=53 missing=10 duplicates=0 cross=2
social: mail=0 stored=0 missing=0 duplicates=0 cross=0
bills:  mail=0 stored=0 missing=0 duplicates=0 cross=0
junk:   mail=3 stored=3 missing=0 duplicates=0 cross=0
```

Observed, not explained: exit 2 means the audit found "lost or duplicate INBOX mail" (script usage text). INBOX shows 0 missing and 2 duplicates; the `offers` folder shows 10 missing (the usage text says this can happen for mail of the last sync interval; the `offers` folder has no effect on the exit code). No check of the cause was run in this stage.

**Verdict.** Main N = 0 wrong moves of real mail (INBOX only: 0; old query: 0; `web` wrong rows: 0). Bar N ≤ 3: **S3 passes.** Failed actions: 0 rows. Audit coverage: 0.

The audit exit code 2 is an open observation, not part of the N verdict.

## S5e deploy (2026-11-11 23:37:21 UTC)

- The web panel deploy restarted the server at T = 2026-11-11 23:37:21 UTC (commit `8f6a8b2`). The jobs are crash-safe; sync ticks ran as before and there were 0 `error` lines in the first 150 minutes (digest and committer ticks were not checked one by one).
- The pilot mailbox was paused at 23:46:15 UTC and resumed at 23:46:17 UTC (smoke of the panel; 2 seconds).
- New feedback source: `triage_feedback.source = 'web'` (the panel's ✅, ✏️ and ↩️). Count it together with `telegram` for the feedback numbers. 39 `web` ✅ rows (verdict `right`) exist from the smoke at 23:54–00:03 UTC (about 14 seconds per mail; the user did not say whether each category was checked, so treat them as unverified and consider excluding that window).

## Log

- 2026-11-07: Created when S3 closed; the week started at `<START>`.
- 2026-11-14: week result written by F095 stage 09: N = 0, S3 passes.
