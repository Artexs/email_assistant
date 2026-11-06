> **Status 2026-11-06 — in progress.** The S1a audit check is done. Left: stage 36 (day 2 and 3), stage 37 (waits for the user: `TRIAGE_LLM_SCOPE=synthetic`), stage 39 backfill, labels, stage 40. Faster option chosen (no shadow week).

> **Blocked until:** stages 37–40: after 2026-11-05T23:30Z (UTC) AND after the S1a audit check is in `tasks/done/`. Why: the S1a 48-hour sync test runs on the same VPS until 23:12Z, and its end script runs the audit at 23:17Z. A deploy restarts the server and can spoil the test. Stage 36: on a Pacific quota day after 2026-11-05 (check `TZ=America/Los_Angeles date`).
> **Before that time, an agent may only:** read the VPS logs (`tail ~/ea-logs/seed.log`), run `bun run gemini:test` once on the Mac. Never touch the VPS cron, the audit, `~/ea-48h-end.sh` or any `.env`.

# S1b shadow run — real-mail results

Scope: the operations part of S1b, moved out of `tasks/done/s1b-shadow-triage.md` on 2026-11-05 (user decision: close the S1b code now, start S2, finish the real-mail results later). Also holds the open check of `tasks/done/gemini-setup.md`. Needs: S1b code (done), S1a audit check. S3 needs this task: S3 waits for the go/no-go table (`docs/roadmap.md`).

## Goal

The pilot server triages real mail in shadow mode. The user labels it. The final go/no-go table and the cost per mailbox are in this file.

## Done when

Moved from the S1b "Done when" (same wording there):

- The eval runner reports precision and recall per category on at least 100 real labeled mails, or all real pilot INBOX mail of the last 30 days if there are fewer. Labels are in `triage_feedback`, from `bun run triage:label` (stage 40).
- A go/no-go table per category is in this file: precision ≥ 98% with at least 30 kept rows, else "no-go" or "no-go: too few"; the confidence threshold per category comes from the eval data (stage 40).
- One week of the user's mail is classified in shadow mode; tokens and latency per mail are stored; the cost per mailbox per month is computed (stages 38, 40).
- Flash-Lite is compared with `gemini-3.8-flash`, or "not comparable: 503" on 3 different Pacific days; the choice is logged here and in `docs/architecture.md` §6.3 (stage 36).
- From `gemini-setup`: `bun run gemini:test` returns a reply from `GEMINI_MODEL`, or the stage 36 result replaces `GEMINI_MODEL` with a model that answers (user decides).

## Notify points (tell the user; the user edits the VPS `.env`, the agent never edits or prints it)

Check only with `ssh home_vm 'cd ~/email_assistant && grep -n "^TRIAGE_LLM_SCOPE" .env'` (prints no secret).

1. Before stage 37 step 3: ask the user to confirm `TRIAGE_LLM_SCOPE=synthetic` is the only value (set on 2026-11-05, checked 14:33Z).
2. After the stage 37 checks pass, before stage 38: tell the user to change the line to `TRIAGE_LLM_SCOPE=all`. Wait for "done", verify with grep, restart as stage 38 says. `synthetic` sends only seeded test mail to Gemini; `all` sends the real pilot INBOX mail (ADR 0013).
3. Stage 38: the user labels about 100 real mails with `triage:label` (TTY, no `-T`), for example once a day.
4. Stage 40: the user confirms the result and tries it.
5. To stop all LLM calls at any time: the user sets `TRIAGE_LLM_SCOPE=off` and restarts the server.

## Decision (user, 2026-11-06): faster option chosen

The user chose the faster option below. Stage 38 is not a full week: after stage 37, deploy with `all`, run the stage 39 backfill right away, label about 100 mails, then stage 40. The "one week" done-when item drops; the cost comes from the 200-mails-per-day figure.
The user set `TRIAGE_LLM_SCOPE=all` early on 2026-11-06 (the running server had the old S1a code, so it had no effect). The user accepted the agent's proposal to set it back to `synthetic` for the stage 37 smoke run.

## Former open decision

Faster option (proposed 2026-11-05, not chosen yet): drop "one week" from "Done when", run the stage 39 backfill (30 days of INBOX) right after stage 37, label about 100 mails, then stage 40. About 1–2 days (cap 300 LLM calls per Los Angeles day) instead of 7. Cost: no multi-day stability proof, old mail can skew the results, the cost comes from the 200-mails-per-day figure only. Default without an answer: the plan as written (one week).

## Plan

Loop: skill `run-task` (implementer → checks → reviewer → commit), plan already approved. Reviewer: Sonnet; Opus (high) only for the final group review. Commit format: `<area>: S1b stage N — <what>`. Shell setup, preconditions and SQL Q1–QH: [`s1b-shadow-run/vps-shared.md`](s1b-shadow-run/vps-shared.md).

- [ ] [Stage 36](s1b-shadow-run/stage-36-model-comparison-with-gemini-3-8-flash.md) — Model comparison with `gemini-3.8-flash` [risky] (day 1 of 3 done: 503 on 2026-11-05)
- [ ] [Stage 37](s1b-shadow-run/stage-37-vps-deploy-synthetic-smoke-run-real-mail-count.md) — VPS: deploy, synthetic smoke run, real-mail count [risky]
- [ ] [Stage 38](s1b-shadow-run/stage-38-vps-real-mail-shadow-week.md) — VPS: real-mail shadow week [risky]
- [ ] [Stage 39](s1b-shadow-run/stage-39-vps-backfill-of-older-inbox-mail.md) — VPS: backfill of older INBOX mail [risky] (only when the week brings fewer than 100 real mails)
- [ ] [Stage 40](s1b-shadow-run/stage-40-vps-final-real-mail-eval-cost-go-no-go.md) — VPS: final real-mail eval, cost, go/no-go [risky]

Order: stage 36 runs on its own Pacific days (Mac only). Stage 37 first needs the S1a audit check. Suggested session after 23:30Z: S1a audit check → stage 37 → notify point 2 → stage 38 start.

Stage 36 command (rerun on each new Pacific day until 3.8 answers or 3 days have 503): `bun run eval --set all --per-category 3 --retries 1 --model gemini-3.8-flash --out evals/results/<date>-gemini-3.8-flash-pc3.md`. Exit 2 = stopped on soft errors, do not loop. A 400 (`http_400_*`) = stop and report. If 3.8 answers: rerun Flash-Lite pc3 if incomplete, fill the comparison table, apply the ADR 0012 choice rule (cheapest model that passes the structural checks with equal or better precision), update architecture §6.3 (provisional → final).

Stage 40 cost (user decision 2026-11-05): record the cost per mail and the figure at 200 mails per day; run `triage:cost --days 7` at the end of stage 38, before stage 39.

### Traps (from the S1b handoff)

- After each subagent call: `git log --oneline -1` (HEAD unchanged) and `git status --porcelain`. Stage files with explicit paths, never `git add -A`. Before push: `git fetch`, `git log HEAD..origin/master`.
- Not ours, never stage: `notes/2026-11-03-project-tour.md`, `docs/diagrams/`, `notes/2026-11-04-subagent-usage.md`.
- Reviewers check numbers against state files: copy numbers from the report file, not from an earlier partial run.
- Case evals (`bun run eval --set …`) run only on the Mac. On the VPS use `eval --real` with stdout only.
- The VPS key equals the Mac key (one shared Flash-Lite quota). `GEMINI_RPM` 12, `LLM_DAILY_CAP` 300. The eval tool timeout is 1800 s: resume with the same command (state file in `evals/.runs/`).
- Bun `prompt()` in Docker is not verified: stage 37 checks it with `triage:label --synthetic --limit 1` and `q`.
- Pilot ids: org `ac6ed6a2-ee37-461f-9632-cc08cf549e40`, mailbox `8bc7f572-a7f5-4fa5-aaab-db16dc663e96`. `ssh home_vm`, `cd ~/email_assistant`, `C="docker compose -f deploy/compose.yaml --env-file .env"`.

## Results

Provisional results (stage 34 full run, stage 36 subset, 3.8 Flash availability) are in `tasks/done/s1b-shadow-triage.md` "Results". Stage 36 and stage 40 write the final tables here.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/roadmap.md` S1b state and `docs/architecture.md` §6.3 updated (final model, go/no-go result).
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] The user confirmed the result.

## Log

- 2026-11-05: Created from S1b stages 36–40 (user decision: close the S1b code, start S2, finish the real-mail results in a few days). `gemini-setup` check merged here: `bun run gemini:test` → `LlmSoftError http_503` (15:15Z). S1a test on track at 15:15Z: `seed.log` 40 × `appended 1`, 0 errors; end script still in the crontab for 23:17Z.
- 2026-11-06: S1a audit check done (`tasks/done/s1a-48h-audit-check.md`). VPS still on commit `e5a32eb` (S1a); `grep '^TRIAGE_LLM_SCOPE=' .env` → `all` (user, early); `grep -c '^GEMINI_API_KEY=.' .env` → 1. User decisions: scope back to `synthetic` for stage 37, faster option. Stage 36 day 2 run aborted at the start (no result); rerun open.
- 2026-11-06: Stage 37.1 step 2, Q1 before the deploy (read-only): real/synthetic per day — 10-29 1/0, 11-01 3/0, 11-02 3/0, 11-03 3/1, 11-04 3/24, 11-05 2/24, 11-06 4/0. About 3 real mails per day (about 21 per week), so the stage 39 backfill is needed for 100 labels. The synthetic filter matches the S1a seed mails (49).
- 2026-11-06: User decision: keep `TRIAGE_LLM_SCOPE=all`, skip the stage 37 synthetic smoke run (steps 37.1.3, 37.1.5–6 not done). Manual backup before the deploy: `backup ok ea-20261106T184200Z.dump.age 39069`.
- 2026-11-06: Deploy of `a8d8fa4` (18:42Z): `db:migrate` applied `20261104000001_triage.sql` and `20261106000001_telegram.sql`, exit 0; `up -d --build --wait` → server Healthy. Log: "triage sends the real mail of the TEST_MAILBOX_ADDRESS mailbox to Gemini (TRIAGE_LLM_SCOPE=all)", "telegram is off". `<START>` = 2026-11-06T18:44:42Z.
- 2026-11-06: Stage 39 (faster option): QF before `1 / 38907`. Audit before (`--since 2026-10-07T18:45:22Z`): `inbox=79 stored=68 missing=13 duplicates=2`. `<BF_START>` = 2026-11-06T18:45:35Z. `mailbox:backfill --days 30`: `fetched 79, stored 13, uid updated 66, returned 0`, `re-queued 1`, exit 0. QF after `1 / 38907` (equal). Audit after: `inbox=79 stored=81 missing=0 duplicates=2` (the 2 = deleted mails, known alert). QG: `triaged 14` (all real, 2026-10-08 … 10-29).
- 2026-11-06 19:00Z: QH: real INBOX mail of the window = 32 (27 triaged, 5 pending behind `http_503` pauses). Q4: `ok 57`, `http_503 1`. Only 32 real mails exist in 30 days, so the 100-label target cannot be met: rule of step 39.8 applies (label all 32).
- 2026-11-06: Labels (user decided in chat, agent wrote them with `triage:label --email-id … --right | --category`): 36 of 37 real mails; AI right on 34; #3 Archicada newsletter `info` → `spam`; #27 Google "Pilne: zaloguj się…" `notification` → `urgent`; #23 "EA probe" (agent test mail) left out. Result: `ok=36 fail=0`.
- 2026-11-06: User decision: too few real mails in 30 days; go back about half a year to reach 100–200 mails. IMAP count (audit `inbox=`, includes about 49 seed mails): 90 days 128, 180 days 171, 365 days 564. Chosen: 180 days (about 122 real). Code change: backfill max 30 → 180 days (pilot exception to the 30-day body retention, architecture §6.1). Reviewer PASS (minors fixed).
