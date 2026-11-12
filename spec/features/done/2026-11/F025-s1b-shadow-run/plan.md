> **Status 2026-11-06 — done.** Final go/no-go table in "Results": every category is no-go (notification 96.2%, spam 83.6%, bar 98%). Classifier on the VPS: OpenAI `gpt-6-luna`. Stage 36 superseded by the OpenAI switch.

> **Blocked until:** stages 37–40: after 2026-11-05T23:30Z (UTC) AND after the S1a audit check is in `tasks/done/`. Why: the S1a 48-hour sync test runs on the same VPS until 23:12Z, and its end script runs the audit at 23:17Z. A deploy restarts the server and can spoil the test. Stage 36: on a Pacific quota day after 2026-11-05 (check `TZ=America/Los_Angeles date`).
> **Before that time, an agent may only:** read the VPS logs (`tail ~/ea-logs/seed.log`), run `bun run gemini:test` once on the Mac. Never touch the VPS cron, the audit, `~/ea-48h-end.sh` or any `.env`.

# S1b shadow run — real-mail results

Scope: the operations part of S1b, moved out of `spec/features/done/2026-11/F018-s1b-shadow-triage/plan.md` on 2026-11-05 (user decision: close the S1b code now, start S2, finish the real-mail results later). Also holds the open check of `spec/features/done/2026-11/F011-gemini-setup/plan.md`. Needs: S1b code (done), S1a audit check. S3 needs this task: S3 waits for the go/no-go table (`docs/roadmap.md`).

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

Loop: skill `run-task` (implementer → checks → reviewer → commit), plan already approved. Reviewer: Sonnet; Opus (high) only for the final group review. Commit format: `<area>: S1b stage N — <what>`. Shell setup, preconditions and SQL Q1–QH: [`stages/vps-shared.md`](stages/vps-shared.md).

- [x] [Stage 36] (superseded by the OpenAI switch, 2026-11-06)(s1b-shadow-run/stage-36-model-comparison-with-gemini-3-8-flash.md) — Model comparison with `gemini-3.8-flash` [risky] (day 1 of 3 done: 503 on 2026-11-05)
- [x] [Stage 37](stages/stage-37-vps-deploy-synthetic-smoke-run-real-mail-count.md) — VPS: deploy, synthetic smoke run, real-mail count [risky]
- [x] [Stage 38](stages/stage-38-vps-real-mail-shadow-week.md) — VPS: real-mail shadow week [risky]
- [x] [Stage 39](stages/stage-39-vps-backfill-of-older-inbox-mail.md) — VPS: backfill of older INBOX mail [risky] (only when the week brings fewer than 100 real mails)
- [x] [Stage 40](stages/stage-40-vps-final-real-mail-eval-cost-go-no-go.md) — VPS: final real-mail eval, cost, go/no-go [risky]

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

Provisional results (stage 34 full run, stage 36 subset, 3.8 Flash availability) are in `spec/features/done/2026-11/F018-s1b-shadow-triage/plan.md` "Results".

### Final real-mail eval (stage 40, 2026-11-06, VPS, `eval --real`, exit 0)

123 labeled real mails (QB = 123): `gemini-3.5-flash-lite` 36 (2026-10-08 … 11-06), `gpt-6-luna` 87 (180-day backfill, 2026-05-11 … 10-07).
Label rule: fewer real mails than 100 in 30 days, so the window is 180 days (user 2026-11-06); all real INBOX mail of the window is labeled except 1 agent test mail ("EA probe").
Labels: the user decided per group in chat; the agent wrote them with `triage:label --email-id`. Rule results 0, errors 0.

All models together (bar 98%, minimum 30 kept rows):

| category | threshold | precision | recall | kept | decision |
| --- | --- | --- | --- | --- | --- |
| urgent | none | 0.0% | 0.0% | 1 | no-go: too few |
| needs_reply | none | 0.0% | n/a | 1 | no-go: too few |
| info | none | 0.0% | n/a | 1 | no-go: too few |
| notification | none | 96.2% | 80.6% | 52 | no-go |
| spam | none | 83.6% | 93.3% | 67 | no-go |

Per model (`--model`):

| model | rows | notification P / R / kept | spam P / R / kept |
| --- | --- | --- | --- |
| gpt-6-luna | 87 | 97.5% / 76.5% / 40 → no-go | 75.0% / 91.7% / 44 → no-go |
| gemini-3.5-flash-lite | 36 | 91.7% / 100.0% / 12 → no-go: too few | 100.0% / 95.8% / 23 → no-go: too few |

No threshold from 0.50 to 0.95 lifts notification or spam to 98% (sweep in the report). Confidence: most rows are in 0.95–1.00 (notification 49 of 51 correct, spam 52 of 61 correct), so confidence does not split right from wrong.

Main errors:
- 11 × `notification` labeled, `spam` predicted (gpt-6-luna): Instagram "see X, Y and more" follow suggestions. The user labels them `notification`. Decision for S3: say in the prompt that social-network suggestions are notifications, or accept them as spam.
- 4 × `spam` labeled, `unsure` predicted (gpt-6-luna): scam mails from random domains with low confidence (0.36–0.66).
- 1 × `urgent` labeled, `notification` predicted (Gemini): Google "Pilne: zaloguj się…".
- Only 3 real mails in `urgent`, `needs_reply`, `info`: the pilot mailbox has almost no personal mail. These categories need another mailbox.

Cost (`triage:cost --days 7`, real mail; the observed rate includes the backfill, so use the per-mail and 200-per-day figures):

| model | avg tokens in / out | latency p50 / p95 | per mail | per mailbox per month at 200 mails/day | price source |
| --- | --- | --- | --- | --- | --- |
| gemini-3.5-flash-lite | 1503 / 78 | 906 / 1349 ms | $0.0006 | $3.88 | ai.google.dev/gemini-api/docs/pricing, read 2026-11-05 |
| gpt-6-luna | 2073 / 56 | 1414 / 2687 ms | $0.0002 | $1.41 | developers.openai.com/api/docs/pricing, read 2026-11-06 |

### Model choice

Classifier on the VPS since 2026-11-06 21:48Z: OpenAI `gpt-6-luna` (user decision, LLM provider switch task). Stage 36 (`gemini-3.8-flash`): not done; superseded by the switch (user accepted 2026-11-06). Day 1 of 3: `http_503` on 2026-11-05.

## Done-checklist

- [x] Done-when checks pass (name the command and its output in the log). Changed by the user: 180-day window instead of one week; stage 36 superseded.
- [x] `docs/roadmap.md` S1b state and `docs/architecture.md` §6.3 updated (final model, go/no-go result).
- [x] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md` (audit duplicates after a delete).
- [x] The user confirmed the result (labels 2026-11-06).

## Log

- 2026-11-05: Created from S1b stages 36–40 (user decision: close the S1b code, start S2, finish the real-mail results in a few days). `gemini-setup` check merged here: `bun run gemini:test` → `LlmSoftError http_503` (15:15Z). S1a test on track at 15:15Z: `seed.log` 40 × `appended 1`, 0 errors; end script still in the crontab for 23:17Z.
- 2026-11-06: S1a audit check done (`spec/features/done/2026-11/F022-s1a-48h-audit-check/plan.md`). VPS still on commit `e5a32eb` (S1a); `grep '^TRIAGE_LLM_SCOPE=' .env` → `all` (user, early); `grep -c '^GEMINI_API_KEY=.' .env` → 1. User decisions: scope back to `synthetic` for stage 37, faster option. Stage 36 day 2 run aborted at the start (no result); rerun open.
- 2026-11-06: Stage 37.1 step 2, Q1 before the deploy (read-only): real/synthetic per day — 10-29 1/0, 11-01 3/0, 11-02 3/0, 11-03 3/1, 11-04 3/24, 11-05 2/24, 11-06 4/0. About 3 real mails per day (about 21 per week), so the stage 39 backfill is needed for 100 labels. The synthetic filter matches the S1a seed mails (49).
- 2026-11-06: User decision: keep `TRIAGE_LLM_SCOPE=all`, skip the stage 37 synthetic smoke run (steps 37.1.3, 37.1.5–6 not done). Manual backup before the deploy: `backup ok ea-20261106T184200Z.dump.age 39069`.
- 2026-11-06: Deploy of `a8d8fa4` (18:42Z): `db:migrate` applied `20261104000001_triage.sql` and `20261106000001_telegram.sql`, exit 0; `up -d --build --wait` → server Healthy. Log: "triage sends the real mail of the TEST_MAILBOX_ADDRESS mailbox to Gemini (TRIAGE_LLM_SCOPE=all)", "telegram is off". `<START>` = 2026-11-06T18:44:42Z.
- 2026-11-06: Stage 39 (faster option): QF before `1 / 38907`. Audit before (`--since 2026-10-07T18:45:22Z`): `inbox=79 stored=68 missing=13 duplicates=2`. `<BF_START>` = 2026-11-06T18:45:35Z. `mailbox:backfill --days 30`: `fetched 79, stored 13, uid updated 66, returned 0`, `re-queued 1`, exit 0. QF after `1 / 38907` (equal). Audit after: `inbox=79 stored=81 missing=0 duplicates=2` (the 2 = deleted mails, known alert). QG: `triaged 14` (all real, 2026-10-08 … 10-29).
- 2026-11-06 19:00Z: QH: real INBOX mail of the window = 32 (27 triaged, 5 pending behind `http_503` pauses). Q4: `ok 57`, `http_503 1`. Only 32 real mails exist in 30 days, so the 100-label target cannot be met: rule of step 39.8 applies (label all 32).
- 2026-11-06: Labels (user decided in chat, agent wrote them with `triage:label --email-id … --right | --category`): 36 of 37 real mails; AI right on 34; #3 Archicada newsletter `info` → `spam`; #27 Google "Pilne: zaloguj się…" `notification` → `urgent`; #23 "EA probe" (agent test mail) left out. Result: `ok=36 fail=0`.
- 2026-11-06: User decision: too few real mails in 30 days; go back about half a year to reach 100–200 mails. IMAP count (audit `inbox=`, includes about 49 seed mails): 90 days 128, 180 days 171, 365 days 564. Chosen: 180 days (about 122 real). Code change: backfill max 30 → 180 days (pilot exception to the 30-day body retention, architecture §6.1). Reviewer PASS (minors fixed).
- 2026-11-06 21:48Z: User decision: switch the VPS to OpenAI now (accepts the OpenAI paid API terms for the pilot mail, Q6a of `llm-provider-switch`). Backup `ea-20261106T214847Z.dump.age`. Deploy `6934089`: log `llm provider=openai classifier=gpt-6-luna`; `llm:check --provider openai` exit 0.
- 2026-11-06 21:52Z: Backfill `--days 180`: QF before `1 / 38912`; audit before `inbox=171 stored=86 missing=87 duplicates=2`; `fetched 171, stored 87, uid updated 84, returned 0`, `re-queued 0`, exit 0; QF after `1 / 38912`; audit after `inbox=171 stored=173 missing=0 duplicates=2`. All 87 triaged by `gpt-6-luna`, `llm.call` `ok 87`.
- 2026-11-06: 87 labels (user accepted the agent's grouped proposal): 70 right; 11 Instagram follow suggestions + 1 Google security alert → `notification`; 4 `unsure` + 1 dating scam → `spam`; no-ip.pl → `notification`. `ok=87 fail=0`. QB = 123.
- 2026-11-06: Stage 40: `eval --real` (all, `--model gpt-6-luna`, `--model gemini-3.5-flash-lite`) exit 0; `triage:cost --days 7`. Results in "Results". Task done, moved to `done/`.
