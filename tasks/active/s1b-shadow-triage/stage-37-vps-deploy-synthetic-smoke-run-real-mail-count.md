# s1b-shadow-triage — Stage 37

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.
Shell setup, preconditions and the SQL queries (Q1–QH) are in [`vps-shared.md`](vps-shared.md).

## Stage 37 — VPS: deploy, synthetic smoke run, real-mail count [risky]

- [ ] **37.1 Deploy with `TRIAGE_LLM_SCOPE=synthetic`; count real mail per day**
  - Goal: the pilot server runs the S1b code; only synthetic mail goes to Gemini; the real-mail count per day is known before the week.
  - Files: this task file (log lines; the Q1 table, numbers only); `notes/2026-11-03-pilot-vps.md` (append: S1b deploy date, the key names now in `.env`, no values).
  - Interfaces: none (operations).
  - Decisions: the server image holds `evals/cases` (step 29.1). The smoke run uses `--per-category 4` (20 synthetic cases), not `--limit` (review finding 23).
  - Steps:
    1. `date -u` (after 2026-11-05T23:30Z); `ls tasks/done/s1a-48h-audit-check.md` on the Mac.
    2. Before any change, run Q1 (read-only). Write the table in the log and the expected real mails for one week (real mail per day × 7). A `synthetic` count above 0 for the S1a seed days confirms that stored Message-IDs keep the angle brackets. If `synthetic` is 0 while the S1a seed log shows appended mails, stop and report (the synthetic filter does not match).
    3. The user adds `GEMINI_API_KEY=<key>` and `TRIAGE_LLM_SCOPE=synthetic` to the VPS `.env` (mode 600). Check the key names only: `grep -c '^GEMINI_API_KEY=.' .env` (1) and `grep '^TRIAGE_LLM_SCOPE=' .env`.
    4. Update as in `deploy/README.md` "Update": `git pull`, `$C up -d --wait db`, `$C run --build --rm server bun run db:migrate`, `$C up -d --build --wait`. `$C logs --since 5m server` shows "triage takes only synthetic mail".
    5. Seed: `$C run --rm -T server bun run mailbox:seed --org-id <ORG> --mailbox-id <MB> --eval-cases synthetic --per-category 4` → `appended 20`.
    6. Wait at least 15 minutes (one sync, then worker runs at `GEMINI_RPM`). The S1a hourly seed mails (`seed-…@ea-seed.test>`, about 48) are synthetic too and are triaged as well (about 48 more calls).
  - Test: none (operations).
  - Check: Q2 = 0; Q3 = `triaged 20`; Q4 has no `http_4xx` row; `$C logs --since 1h server | grep -E "daily LLM cap|triage paused|LLM config error"` prints nothing (or each line is explained in the log); `$C run --rm -T server bun run triage:cost --org-id <ORG> --mailbox-id <MB> --mail synthetic --days 1` prints the figures.
  - Done when: the checks pass and the Q1 table is in the log.
  - Out of scope: `TRIAGE_LLM_SCOPE=all`, labeling, the backfill, evals on the VPS, any crontab change.
