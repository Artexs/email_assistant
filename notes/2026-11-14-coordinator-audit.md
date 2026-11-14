# Coordinator audit, 2026-11-14 (about 10:40 Warsaw)

Read-only check of the Limen coordinator (Herdr pane w1:p1) over 2026-11-13 and 2026-11-14.
Sources: `git log`, `gh run list`, `limen jobs --all`, `.limen/jobs/*/{model,open-checks,note.md}`, `spec/build.md`, the feature folders, the Limen manual `/home/artek/Documents/repos/limen/templates/agents.md`, local Postgres.
The auditor changed nothing except this file.

## Scale
- 449 commits on `master` since 2026-11-13 00:00, 88 of them merges. About 200 Limen jobs in two days.
- Landed: the foundation group F086–F091 and F093, F078, F030, F082, F096; F095 stages 01–08; F099 stages 01–02; F098 stage 01.

## Categories and verdicts

### 1. Order and gates — mostly correct, one rule break
- Correct: F098 and F099 build after F082 and F091 (both in `done/`). One migration in build at a time (F099 s02 only).
- Break: the owner order rule (2026-11-14, `spec/build.md` NEXT) says "plan a ticket only after the tickets it needs have landed". F101 (needs E1) plan landed at 10:16 and the F103 (needs E1) planner runs now. F095 (E1) is not in `done/`. The coordinator wrote the rule and the resume order for F101 and F103 in the same handoff note (`notes/2026-11-14-handoff-after-compaction.md`).
- Risk: low in substance (the capability pages that the plans read already exist). F101 moved to `active/`, but its `## Sequenced` says build after F095 is in `done/`. Watch that its build does not start before E1 closes.

### 2. Reviews — done, but verdicts are not filed
- Correct: every plan got a cold review (`plan-review-1.md` in each folder). Stage reviews follow the plan lists (for example F099 plan line 200: review stages 02, 03, 05, 06, 07, 08, 09, 12). Open checks of the reviewers are real and specific (for example "full e2e suite not run" on F098 s01).
- Gap: the Limen manual step 6 says to file each stage review verbatim as `review-<n>.md` in the feature folder. No stage review file exists in F086–F099 (only `plan-review-1.md` and one `review-group-c1.md`). The verdicts live only in `.limen/jobs/`, which `limen prune --retire` deletes.

### 3. CI health — rule not followed
- `docs/code-patterns.md:226`: a test that fails twice in CI on `master` without a code change is quarantined the same day, with a ticket.
- `main-start-log.test.ts` "writes JSON event lines" failed 3 times today (06:08, 06:25, 06:45 UTC). The file did not change.
- `mail-folders-cli.test.ts` "sync-folder off, then on with a plain Db" failed 2 times (01:32, 09:19 UTC). The file did not change.
- No quarantine commit and no ticket. `spec/build.md` TRACK still says "CI on master: green since 2026-11-13".

### 4. Board truth (`spec/build.md`) — behind the work
- TRACK: "Now: S6 pre-sale moves to Limen …" is old. "Bun pin 1.3.14" is wrong (`.bun-version` is 1.4.4). "CI green" is wrong (see 3). Reviewer model "claude-sonnet-5-5" does not match the runs (see 6).
- NEXT: F095, F098, F099 say PLANNED but are active and building. F096 says PLANNED but is PROVEN. F101 has no status mark. F092 says "needs plan" and "waits for the owner's yes", but its planner ran on the default yes.
- F095 stage 08 wrote the full new NEXT body (`spec/features/active/F095-e1-close-the-mvp/next.md`). The coordinator has not applied it.
- At 10:40 the coordinator had an uncommitted `spec/build.md` edit that removes the F091 line. So it repairs the board, but late.

### 5. VPS and deploys — correct
- `notes/2026-11-14-f094-vps-deploy.md`: each update names a rollback commit and image tag, takes an encrypted backup first, and verifies (Bun version, `/health`, start log, disk, `mailbox:check`). The next-day check has a wake rule.

### 6. Models and quota — off the board
- `spec/build.md` TRACK names Sonnet 5.5 for worker and reviewer. Stage reviews and planners ran on Opus 5.5. The planner note (`notes/2026-11-13-limen-planner-role.md:8`) records an owner decision for Opus on plan reviews only.
- Overnight, 2 of 8 hours were productive; the 5-hour limit stopped 11 jobs (`notes/2026-11-14-overnight-summary.md`). The coordinator wrote the lesson and a wake rule. It did not lower the number of Opus jobs.

### 7. Git and safety — correct
- Every commit auto-pushed (`.git/auto-push.log`, `origin/master` = `HEAD`). No force push seen. No secret seen in the checked diffs.
- The F091 history-merge risk (no rebase) was planned for (F091 D22).

### 8. Cleanup — mostly correct
- 12 non-main databases in local Postgres. About 7 belong to finished or failed jobs from 2026-11-12 to 2026-11-14 (`email_assistant_2026_11_12_*`, `…_13_*`, `…_14_c3742646`). The rule is "drop the job DB by hand after the job".
- Old failed job records (for example F095-s08 FAILED, whose work a continue job landed) stay in `limen jobs`.

### 9. Decisions taken for the owner — taken, not surfaced
- About 76 numbered questions with defaults across 12 `questions.md` files. 129 PD rows in `docs/product/stage-2/decisions.md` (owner-made, from discovery).
- No single place lists the defaults the coordinator used, and no message tells the owner. Example: F092 RLS ran on the default yes while the board says it waits for the owner.

## Proposed fixes (not applied)
1. Quarantine the two tests with tickets (rule in `docs/code-patterns.md:226`).
2. Apply `next.md`; fix TRACK (Bun, CI, models, the S6 line).
3. File stage reviews as `review-<n>.md` from now on; back-fill from `.limen/jobs/*/note.md` before any prune.
4. Hold F101 build until F095 is in `done/`, or record the owner's exception.
5. Record the reviewer model choice (Opus or Sonnet) on the board, one value.
6. A decision log for the owner: see the chat reply of 2026-11-14 and the proposal below.

## Decision log proposal
- One file, `docs/owner-decisions.md`, append-only, newest first. One row per decision the coordinator or a planner took for the owner.
- Record only these kinds: user-visible behaviour, security or privacy, money or quota, data deletion or other irreversible acts, VPS and production changes, scope cuts and ticket drops, exceptions to an owner rule.
- Columns: date, ticket, the question in one line, the choice, why (one line), how to undo, status (`new` / `ok` / `changed`).
- Writers: the planner adds its `questions.md` defaults of those kinds when its plan lands; the coordinator adds each default it uses at build time and each rule exception.
- Notice: each coordinator reply that hands control back ends with "N new owner decisions since your last review: docs/owner-decisions.md". The owner marks rows `ok` or writes a change; a change becomes a ticket line.
- The rule goes into `spec/build.md` NEXT (Limen injects only NOW and NEXT into coordinator turns) and into `.agents/limen/planner.md`.
- Back-fill: one job reads the 15 `questions.md` files and fills the first rows.
