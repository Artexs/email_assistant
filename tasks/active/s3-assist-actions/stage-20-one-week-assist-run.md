# s3-assist-actions — Stage 20

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 20 — One week of `assist` on real mail, results [risky]

Preconditions: stage 19 is done; `tasks/done/s1b-shadow-run.md` stage 40 is done (the go/no-go table exists; on 2026-11-06 it says no-go for every category: notification 96.2%, spam 83.6% precision, "Results" of that file); the user chose the categories that go live (P5: at least `urgent` flag; `auto` for `info`, `notification`, `spam` only where the table says `go`, or by the user's own choice with `--force`; with today's table only the `--force` choice moves mail, else the week runs with flag only); the user says go. Shell and ids as in stage 19.

**Risk (name it to the user before the go):** from this stage on the system moves the user's real mail. Every move has Undo for 7 days; a user move back writes feedback; N = 3 wrong moves in the week is the bar (P2). To stop at once: `/pause` (no sync, no triage, no new actions, no Undo until `/resume`), or the user sets `ACTIONS_SCOPE=off` and restarts the server (`ready` rows wait and expire after 24 h, D21; an Undo tap answers "not possible now"), or `mailbox:settings mode --mode shadow` (new triage becomes `logged`, and the `ready` mailbox actions expire at once in the same transaction, D13; only a row that a committer run holds at that second still finishes, with Undo).

- [ ] **20.1 Start: `auto` from the go/no-go table, scope `all`**
  - Goal: the policy gate reflects the S1b table; the committer applies real mail.
  - Files: this task file ("Results", log line).
  - Steps:
    1. `$C run --rm -T server bun run mailbox:settings auto --org-id <ORG> --mailbox-id <MB> --category <c> --value on` for each `go` category (no `--force`: the gate line must print `go`; a category that the user forces gets `--force`, and the gate line with `FORCED` goes into "Results"); `--value off` for the categories the user does not want (the stage 19 `--force` flags come off here unless the user keeps them: write the choice and the gate lines in "Results"). `show` → the final table.
    2. Expire the real-mail rows of the stage 19 days (B3): the committer reads no settings, so without this step every `ready` real-mail row younger than 24 h would move in the first 15 s after the scope change, also in the categories that step 1 turned off. `$C run --rm -T server bun run mailbox:settings expire-ready --org-id <ORG> --mailbox-id <MB>` → `expired <n> ready actions`, `ready mailbox actions left: 0`. Check by SQL: `select count(*) from actions a join emails e on e.id = a.email_id where e.mailbox_id = '<MB>' and a.status = 'ready' and a.type <> 'save_summary' and a.reverses_action_id is null;` → 0 (else run `expire-ready` again after 15 s). Do step 3 right after this check.
    3. The user changes the VPS `.env` line to `ACTIONS_SCOPE=all` (`TEST_MAILBOX_ADDRESS` is set since S1a) and the main session restarts the server: `$C up -d --wait` (no build). Log: `actions committer applies mailbox changes to the real mail of the TEST_MAILBOX_ADDRESS mailbox (ACTIONS_SCOPE=all)`. `/status` → `Actions: real mail of the test mailbox (ACTIONS_SCOPE=all)`.
    4. Write `<START>` (UTC) in the log. `select status_reason, count(*) from actions where status = 'expired' group by 1;` → the `stale`, `policy_changed` and `manual` rows of the stage 19 days (write the counts: they never moved).
  - Check: the `expire-ready` output and the SQL count 0 of step 2, the log line and `/status`.
  - Done when: the user confirms the start.

- [ ] **20.2 The week: watch, count, close**
  - Goal: the done-when item "one week of `assist` with at most N = 3 wrong moves" is measured and written down; the task closes.
  - Files: this task file ("Results", done-when ticks, log), `docs/roadmap.md` (S3 state line, by the main session at the close).
  - Steps:
    1. Daily (the user, or the main session on request): `/status` (failed count), the digest lines (`done: …`), the `action_failed` notices if any; `$C logs --since 24h server | grep -cE "\[actions\].*error"` → 0 expected; the S1b query QC (old waiting mail) → 0.
    2. The user uses Undo or moves mail back whenever a move is wrong; ✏️ on a digest line of a moved mail also counts.
    3. After 7 × 24 h from `<START>`, right after a sync, SQL:
       - Real mail only (m18): every query below that joins `emails e` keeps `(e.message_id_header is null or e.message_id_header not ilike '%@ea-seed.test>')`, so seed mail does not change the counts.
       - **Applied by type:** `select a.type, a.status, count(*) from actions a join emails e on e.id = a.email_id and e.org_id = a.org_id where a.org_id = '<ORG>' and a.reverses_action_id is null and a.created_at >= '<START>' and (e.message_id_header is null or e.message_id_header not ilike '%@ea-seed.test>') group by 1, 2 order by 1, 2;`
       - **Wrong moves (N):** `select count(distinct f.email_id) from triage_feedback f join emails e on e.id = f.email_id and e.org_id = f.org_id where f.org_id = '<ORG>' and f.created_at >= '<START>' and (e.message_id_header is null or e.message_id_header not ilike '%@ea-seed.test>') and ((f.source in ('undo', 'imap_move')) or (f.source = 'telegram' and f.verdict = 'wrong')) and exists (select 1 from actions a where a.email_id = f.email_id and a.org_id = f.org_id and a.reverses_action_id is null and a.type in ('move', 'mark_read', 'flag') and a.status in ('applied', 'undone') and a.created_at >= '<START>');` → N ≤ 3 passes.
       - **Failed:** `select a.status_reason, count(*) from actions a join emails e on e.id = a.email_id and e.org_id = a.org_id where a.org_id = '<ORG>' and a.status = 'failed' and a.created_at >= '<START>' and (e.message_id_header is null or e.message_id_header not ilike '%@ea-seed.test>') group by 1;`
       - **Audit coverage (done-when):** `select count(*) from actions a where a.org_id = '<ORG>' and a.status in ('applied', 'undone') and a.created_at >= '<START>' and not exists (select 1 from audit_log l where l.action_id = a.id and l.org_id = a.org_id and l.event = 'action.applied');` → 0.
       - **Returns:** `select source, count(*) from triage_feedback where org_id = '<ORG>' and created_at >= '<START>' group by 1;`
       - `mailbox:audit --since <START>` with the D18 reading; `triage:cost --days 7` (unchanged by S3; the figure goes to the S1b results if stage 40 is still open).
    4. Write the tables in "Results" (counts only). N > 3 → the user decides: a category goes back to `auto off` and the week starts again, or S3 closes with the number and a follow-up task.
    5. Done-checklist of the task file: tick each item with its command and output in the log; the main session updates `docs/roadmap.md` (S3 state) and `git mv`s the task file and its folder to `tasks/done/` after the user's confirmation. Remind the user to delete the Keychain entry: `security delete-generic-password -s ea-interia-imap`.
  - Test: none (operations).
  - Check: the queries of step 3 give the results above; N ≤ 3.
  - Done when: the user confirms the result and the task is in `tasks/done/`.
  - Out of scope: drafts and send (S4); the web panel (S5).
