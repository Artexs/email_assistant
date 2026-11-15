# F110 stage 25 — VPS deploy `[risky]`

Part of [`../plan.md`](../plan.md). Needs stages 01–24 landed and the `master` CI run of the last land green.

`[risky]`: the real system. **The coordinator runs this stage itself** (`spec/build.md`: VPS steps are pre-approved; backup first, name the rollback target, verify after). No worker job; no other VPS deploy at the same time. Follow the shape of F102 stage 20 (`spec/features/active/F102-e4-a-act-from-the-panel/stages/stage-20-vps-deploy.md` or its `done/` path) and `deploy/README.md` § Update.

## Before

1. `git log --oneline <VPS commit>..origin/master`: another ticket's VPS step in the range goes first, by its runbook.
2. Two F110 migrations (stages 03, 21): new tables, nullable columns, checks. Old code works with them.
3. **Do not change the LLM model, provider, reasoning effort or `OPENAI_BASE_URL` in this deploy.** The first re-gate run stamps every existing `auto` with the running key (`legacy`, D7); a switch in the same deploy would stamp the new key without evidence.

## Runbook

1. Rollback commit, `deploy/backup.sh` (`backup ok …` or stop), `docker tag ea-server ea-server:pre-f110`, prune and `df -h /` (stop below 3 GB), `git merge --ff-only origin/master`.
2. `$C run --build --rm server bun run db:migrate`: the two F110 files among the `Applying` lines.
3. `T=$(date -u +%Y-%m-%dT%H:%M:%SZ)`; `$C up -d --build --wait`.
4. Flags stay off in this step.

## Checks

1. `/health` → 200.
2. `$C exec server ls evals/results/gate` → the committed gate files (D1).
3. `$C logs --since "$T" server | grep regate` → one line with `stamped` ≥ 0, `paused` 0. A `paused` > 0 means a key mismatch at deploy: roll back and report.
4. `psql`: `SELECT count(*) FROM mailbox_settings WHERE category_policy::text LIKE '%"auto": true%'` equals the count of categories with a `grant` (all stamped).
5. Wait 11 minutes: sync lines for the pilot mailbox; no `bad_view`, no `trust.` error line.
6. Owner checkpoint U2 (not a stop; plan default): `org:flag --flag trust_ladder --on` for the pilot org; queue a check with `bun run trust:history-check --org-id … --mailbox-id …`; after ≤ 60 min the check is `done` or `no_result` (`psql` on `history_checks`), `cost_usd` ≤ 0.25, and the report page loads through Tailscale.
7. The other flags (`why_lines`, `spam_review_line`, `user_quiet_hours`, `report_mail`, `urgency_editor`, `panel_review`, `bulk_unsubscribe`) stay off until the owner asks; list them in the report.

## Rollback

When check 1, 3 or 5 fails:

0. Before the old image starts: `UPDATE outbox SET status = 'failed', error_code = 'outdated' WHERE kind IN ('trust_report_ready', 'autonomy_paused') AND status = 'pending'`; delete pending outbox rows with `channel = 'mail'` (the old sender has no mail path).
1. `git checkout <rollback commit>`; `docker tag ea-server:pre-f110 ea-server`; `$C up -d --no-build --wait`.
2. Never `db:rollback`. The old code ignores the new tables and the `grant` key (the pre-F110 `categoryPolicySchema` is a non-strict zod object at base 9341d9f0: it drops `grant` on read; a later F110 start treats such `auto` as `legacy` again).
3. Report the failing check; the coordinator decides on reverts.

## After

- After 24 h of good checks: `docker image rm ea-server:pre-f110`.
- Write the result into `plan.md` § Log (date, commit, check outputs, no ids); `limen ticket done`.
- U2 to the owner in one line: "On the phone (Tailscale on), open `/report`, read the result, and tap 'Turn on recommended' only if you agree."
