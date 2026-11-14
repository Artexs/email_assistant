# F095 stage 09 — Pilot results on the VPS (read-only): F077 day check, F037 week, F047 part B

Part of [`../plan.md`](../plan.md). Decisions D13, D16, D17, D18, D20. Facts F1–F5; not verified NV1–NV4. Read "Rules for every stage" first.

The open MVP proofs get their numbers. Four steps. Read-only on the VPS; results are counts, codes, dates and the pilot ids only.

**Gate:** `date -u +%FT%TZ` must be at or after `2026-11-14T22:40:00Z`. Before that: stop at once, commit nothing, and say so.

**Shell.** On this machine: `ssh home_vm '<command>'`. On the VPS: `cd ~/email_assistant`; `C="docker compose -f deploy/compose.yaml --env-file .env"`; SQL: `$C exec -T db psql -U postgres -d email_assistant -At -F '|' -c "<select …>"`. Allowed commands: D13 only. Never `cat`, `grep` or `source` the `.env` file; never print an environment value.

**Ids.** `<ORG>` = `ac6ed6a2-ee37-461f-9632-cc08cf549e40`, `<MB>` = `8bc7f572-a7f5-4fa5-aaab-db16dc663e96`. F037 `<START37>` = `2026-11-07T19:55:16Z`; F047 `<START47>` = `2026-11-07T22:40:00Z`.

**Real mail filter** (`<REAL>`, on every join to `emails e`): `(e.message_id_header is null or e.message_id_header not ilike '%@ea-seed.test>') and lower(e.from_address) is distinct from 'ea-testmail-75wd@agentmail.to'`. **Week window** (`<WEEK37>`, D16): `<col> >= '<START37>' and <col> < '<START37>'::timestamptz + interval '7 days'`; `<WEEK47>` the same with `<START47>`. `<col>` is the `created_at` of the table the old query filters.

## Step 1 — Preflight

- **Goal:** the job can reach the VPS, knows the code and the log form there, and knows that the queries fit the schema.
- **Commands (paste each result, without secrets):**
  1. `ssh -o BatchMode=yes -o ConnectTimeout=10 home_vm true` → exit 0. If not 0: stop and report "NV1: no ssh from the job"; the coordinator runs this stage's commands (plan.md "How to run" item 7).
  2. `ssh home_vm 'cd ~/email_assistant && git rev-parse --short HEAD && git merge-base --is-ancestor cab134f HEAD && echo HAS_S6A'`.
  3. Log form (NV2): find the F089 land commit on this machine (`git log --oneline --grep "F089" master | tail -n 1`, or the merge that added `apps/server/src/platform/log-fields.ts`: `git log --diff-filter=A --format=%h -- apps/server/src/platform/log-fields.ts`), then on the VPS `git merge-base --is-ancestor <that sha> HEAD && echo JSON_LOGS || echo OLD_LOGS`. JSON form: an error line holds `"level":"error"`; old form: `error` after the time stamp.
  4. Schema: `\d outbox`, `\d actions`, `\d delegations`, `\d triage_feedback` through `psql -c` (column lists only). Compare with the columns the queries of steps 3 and 4 use (NV3). A missing column or kind: read the migrations in `db/migrations/` on this machine, fix the query, and note the change.
  5. Script flags (NV4): `bun run triage:cost` needs `--org-id <ORG> --mailbox-id <MB> [--days 7]` and counts back from now (`apps/server/src/scripts/triage-cost.ts:14`). `bun run mailbox:audit` needs `--org-id --mailbox-id --since`; read `auditMailbox` in `apps/server/src/modules/mail/audit.ts` first and run it only if it makes no IMAP write (no `move`, `append`, `delete`, `flag`); else skip it and say why.
- **Done when:** items 1–5 have a result.

## Step 2 — F077 day check (D20)

- **Goal:** the S6a deploy is recorded with its health after the first days.
- **Commands:** `$C ps --format '{{.Service}} {{.Status}}'`; `$C exec -T server bun run org:status` (keep only the pilot org line: `plan=…`, `max_mailboxes=…`, `mailboxes total=… active=…`); `curl -fsS http://127.0.0.1:8080/health | head -c 300` (on the VPS; print only status fields, not mailbox addresses: if the body holds an address, print only the HTTP code with `-o /dev/null -w '%{http_code}'`); error and warn counts of the last 24 h by log form (step 1.3), grouped by module or event code only (JSON: `jq -r 'select(.level=="error" or .level=="warn") | "\(.level) \(.module) \(.event)"' | sort | uniq -c`; old form: the count only); SQL: triage results and sent digests in the last 24 h (`select count(*) from triage_results where created_at > now() - interval '24 hours'`; the digest count from `outbox` by its digest kind, found in step 1.4).
- **Write:** append a section `## Day check (F095 stage 09, YYYY-MM-DD)` to `notes/2026-11-12-s6a-deploy-log.md` with: VPS commit and `HAS_S6A`, the container states, the pilot org line, `/health` status, the 24 h counts. Close the note's "Open" line items that the check answers (one day of the pilot), and leave the rest (F069 check 3, F059 cleanup).
- **Done when:** the section exists with every item.

## Step 3 — F037: the S3 assist week

- **Goal:** the S3 bar "at most N = 3 wrong moves in one week of `assist`" is measured.
- **Queries:** the five queries of `spec/features/done/2026-11/F005-s3-assist-actions/stages/stage-20-one-week-assist-run.md` step 20.2.3 (Applied by type, Wrong moves N, Failed, Audit coverage, Returns), with `<ORG>`, `<REAL>` on each `emails e` join and `<WEEK37>` in place of each `>= '<START>'` (D16). Run "Wrong moves (N)" twice: as written, and with `and e.source_folder = 'INBOX'` (F037 § "Sort-folder sync"). Returns: also count the `web` source separately and the `web` rows of 2026-11-11 23:54–2026-11-12 00:03 UTC (F037 § "S5e deploy"). Then `triage:cost --days 7` and, if allowed (step 1.5), `mailbox:audit --since <START37>`.
- **Write:** in `spec/features/planned/F037-s3-assist-week-result/plan.md` § Results: the date, the VPS commit, each query (as run) and its table (counts only); N for all real mail and for INBOX only; the verdict: N ≤ 3 → "S3 passes"; N > 3 → D17 text ("S3 bar missed: N = <n>; follow-up in E3a (F100) and E3b (F109)"). Tick plan items 1–4; item 5: write the roadmap line (below) and the F005 result line; leave item 6 (the coordinator closes F037). In `docs/roadmap.md`, append to the line `S3 state (2026-11-07): …`: ` Week result (F037, YYYY-MM-DD): N = <n> wrong moves of real mail (<m> INBOX only); bar N ≤ 3 <passed | missed>.` In `spec/features/done/2026-11/F005-s3-assist-actions/plan.md` § Log (the one result line F037 allows): `- YYYY-MM-DD: one-week assist result (F037 via F095 stage 09): N = <n>; <passed | missed>.`
- **Done when:** the Results section, the roadmap line and the F005 line exist.

## Step 4 — F047 part B: the S4 pilot week counts

- **Goal:** the S4 week counts are measured.
- **Queries:** step 23.2.3 of `spec/features/done/2026-11/F006-s4-drafts-approvals-delegation/stages/stage-23-first-real-delegation.md`: Sends by outcome, Delegations by status, Approval time, Notices (the outbox kinds as found in step 1.4), with `<ORG>`, `<REAL>` on each `emails e` join and `<WEEK47>`. Count sends, drafts and approvals also with `e.source_folder = 'INBOX'` (F047 § "Sort-folder sync"). Rejected sends = the SQL part of "wrong drafts". Daily error counts (F047 B1) are not available for past days: write "not collected daily; 24 h count of step 2".
- **Write:** in `spec/features/planned/F047-s4-pilot-week/plan.md` § Results: a part B section with the date, the VPS commit, each query and its table (counts only), "wrong drafts: <rejected count> rejected; owner count: asked at stage 10", "injection incidents: asked at stage 10" (D18). Tick B2; tick B3 except the owner parts; leave B4 (D18 default: no change; stage 10 records it). In `docs/roadmap.md`, append to the line `S4 state (2026-11-07): …`: ` Pilot week (F047 part B, YYYY-MM-DD): <sends applied> sends, <delegations> delegations (<answered> answered), median approval time <t>; part A pending.` In `spec/features/done/2026-11/F006-s4-drafts-approvals-delegation/plan.md` § Log: `- YYYY-MM-DD: pilot week counts (F047 part B via F095 stage 09): see spec/features/planned/F047-s4-pilot-week/plan.md § Results.`
- **Done when:** the part B section, the roadmap line and the F006 line exist.

## Rules of this stage

- The only edits in `spec/features/done/` are the two Log lines named above (F005, F006): their tickets name a result line as the one allowed edit of a done file.
- A query that returns a row with an address, a subject or a name: do not save it; change the query to counts.
- No `update`, `insert`, `delete`, restart, `up`, `down`, `run --build` on the VPS.

## Review focus

Privacy: no address, subject, name or mail text in the four changed files or the job log. Every week query has both window ends (D16) and the real-mail filter. N is computed as the old query defines it. The commands used on the VPS are all in the D13 list.

## Done when

- Steps 1–4 hold.
- The Proof command of `plan.md` (`/tmp/f095-s09`, files: `notes/2026-11-12-s6a-deploy-log.md spec/features/planned/F037-s3-assist-week-result/plan.md spec/features/planned/F047-s4-pilot-week/plan.md docs/roadmap.md spec/features/done/2026-11/F005-s3-assist-actions/plan.md spec/features/done/2026-11/F006-s4-drafts-approvals-delegation/plan.md`) prints `PROOF_OK`.
