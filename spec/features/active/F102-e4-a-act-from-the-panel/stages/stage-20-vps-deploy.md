# F102 stage 20 — VPS deploy [risky]

Part of [`../plan.md`](../plan.md). Read P4, D4, D14, Q10, U1. Needs stages 01–19 landed and the `master` CI run of the last land green.

`[risky]`: the real system. **The coordinator runs this stage itself** (`spec/build.md`: VPS steps are pre-approved; backup first, name the rollback target, verify after). No worker job; no other VPS deploy at the same time.

## Before

1. `git log --oneline <VPS commit>..origin/master`: another ticket's VPS step in the range goes first, by its runbook.
2. One F102 migration (stage 06): nullable columns, an index, wider and new CHECKs. Old code works with it.

## Runbook

On the VPS, in the repo root, `C="docker compose -f deploy/compose.yaml --env-file .env"` (`deploy/README.md` § Update).

1. `git rev-parse HEAD`: the rollback commit.
2. `deploy/backup.sh`: the last line is `backup ok <name> <bytes>`; else stop.
3. `docker tag ea-server ea-server:pre-f102`.
4. `docker builder prune -f`; `df -h /`: stop below 3 GB free.
5. `git fetch && git merge --ff-only origin/master`.
6. `$C up -d --wait db`; `$C run --build --rm server bun run db:migrate`: one `Applying` line per migration in the range, the F102 file among them.
7. `T=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "$T"`.
8. `$C up -d --build --wait`: exit 0 means the health check passed.
9. The pilot organization id as in F099 stage 15 runbook step 6 (the oldest organization; ids stay out of the repo).
10. Q10: `$C run --rm server bun run org:flag --org-id <pilot org id> --flag approvals_page --on`, then the same with `--flag delegation_pages --on`.

## Checks

1. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health` → `200`.
2. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/api/openapi.json` → `401` (behind login).
3. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/approvals` → `302` (login redirect, as any page).
4. `$C exec db psql … -Atc "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'outbox_kind_check'"` → the list holds `'approval_edit'`.
5. `$C exec db psql … -Atc "SELECT count(*) FROM actions WHERE supersedes_action_id IS NOT NULL"` → `0`.
6. `$C run --rm server bun run org:flag --org-id <pilot org id>` → `approvals_page on (row)` and `delegation_pages on (row)`; the other flags as before.
7. Wait 11 minutes: `$C logs --since "$T" server | grep -E "sync_done|synced"` → lines for the pilot mailbox; `grep -E "outbox .*(bad view|edit_failed)|committer .* failed"` → no line.
8. Sign in through Tailscale on the desktop (the coordinator's browser on the tailnet): `/approvals` and `/delegations` load and show the nav items; `/api/openapi.json` in the signed-in browser answers JSON with `openapi` `3.1.0`.

## Rollback

When step 8 fails, or check 1, 2, 3 or 7 fails:

0. In one `psql` session, before the old image starts (the old code parses views strictly and drops unknown payload keys):
   - `UPDATE outbox SET status = 'failed', error_code = 'outdated' WHERE kind = 'approval_edit' AND status = 'pending'` (no renderer in the old code);
   - `UPDATE outbox SET view = view #- '{view,version}' #- '{view,panelUrl}' WHERE kind = 'approval' AND status = 'pending'` (else `bad_view`, and the card never comes);
   - Q17: expire every send in `awaiting_approval` or `approved` whose draft payload has `body_text` (`status = 'expired'`, `status_reason = 'policy_changed'`): the old code would send the template text, not the approved edit. Write the count into the report; the owner reads those drafts in Drafts.
1. `git checkout <commit of runbook 1>`; `docker tag ea-server:pre-f102 ea-server`; `$C up -d --no-build --wait`.
2. Never `db:rollback`: the old code ignores the new columns. A superseded send stays `expired`.
3. Report the failing check to the owner; the coordinator decides on reverts on `master`.

## After

- After 24 h of good checks (`$C logs --since 24h server | grep -E "error|failed" | wc -l` against the day before): `docker image rm ea-server:pre-f102`.
- Write the result into `plan.md` § Log (date, commit, the outputs of checks 1–6, no ids) and close the ticket with `limen ticket done`.
- Owner step U1 (not a stop): tell the owner in one line: "On the phone (Tailscale on), approve one draft in the panel at `/approvals` and one in Telegram; check that the other card shows the result." Record the answer in § Log when it comes.
