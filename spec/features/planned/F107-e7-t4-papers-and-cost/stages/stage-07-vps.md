# F107 stage 07 — VPS deploy and pilot cost measurement

Part of [`../plan.md`](../plan.md). `[risky]` (the real system). **The coordinator runs this stage itself** (`spec/build.md`: VPS steps are pre-approved; backup first, name the rollback target, verify after). No worker job. Needs stages 01–06 landed and the `master` CI run of the last land green. Decisions P5, P7, D11, D14.

**Rules of this stage.** No write to the pilot data. The measurement commands only read. Command output holds ids (`stats:week` and `triage:cost` print mailbox ids): never paste it as is; copy only the named numbers. Nothing this stage writes to the repo holds an id, an address, a subject, an organization name or a secret.

## Before

1. `git log --oneline <VPS commit>..origin/master`: other tickets with their own VPS step go first, by their runbook. Note any migration that the merge brings.
2. F107 adds no migration. The new `TERMS_VERSION` shows the terms dialog to every member after sign-in.

## Runbook

On the VPS, repo root, `C="docker compose -f deploy/compose.yaml --env-file .env"`.

1. `git rev-parse HEAD` → the rollback commit.
2. `docker tag ea-server ea-server:pre-f107`.
3. `T=$(date -u +%Y-%m-%dT%H:%M:%SZ)`.
4. Do `deploy/README.md` § Update in full (backup with the `backup ok` line, disk check, log-rotation check, `db:migrate` when the merge brings a migration, `git merge --ff-only origin/master`, `up -d --build --wait`). Stop at the first step that fails.

## Checks

1. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health` → `200`.
2. For each of the six paths `/legal/<pl|en>/<privacy|terms|dpa>`: `curl -sS http://127.0.0.1:8080<path>` → status 200, and the body holds the draft line of its language (en `DRAFT, not legal advice`; pl `WERSJA ROBOCZA`).
3. `$C exec -T db psql -U postgres -d email_assistant -tAc "select count(*) from users where terms_version is distinct from '<new TERMS_VERSION>'"` → the member count (every member gets the dialog; the accepted check is equality).
4. `$C logs --since "$T" server | grep -c '"level":"error"'` → `0`, or each line has a cause outside F107 (report it; F107 adds no server runtime code).
5. Wait 11 minutes; `$C logs --since "$T" server | grep -c 'synced '` → at least 1 (the sync line of the pilot mailbox; at `69473f4e` its text form is `synced <id>: …`; use the current event name if the sync line moved to an event).
6. **Owner step U1** (not a stop): the owner signs in, sees the dialog with the new version, reads the links, accepts. Afterwards check 3 for the owner's user gives 0 (print only the count).

## Measurement (read only)

M0. Find the four last finished weeks (Mondays, organization time zone) and the pilot organization id.
M1. For each week: `$C run --rm server bun run stats:week --org-id <pilot org> --week <monday>` (all mailboxes) → copy from the `m7_cost` line `llm_usd_week`, `llm_calls`, `unpriced_calls`, `mailboxes`, and from the `m4_handled` line the `triaged` count (the number after "of").
M2. `$C run --rm server bun run triage:cost --org-id <pilot org> --mailbox-id <pilot mailbox> --days 28` → copy per model the average tokens in and out (informational; not in the formula, D10).
M3. Write `pilot-cost.md` in this ticket folder: the date, the four week dates, the M1 numbers per week, the M2 numbers per model, the model names, the line "read-only on the VPS at <commit>". Commit it with its explicit path.

When a command fails or the weeks hold no triaged mail, write that into `pilot-cost.md`; stage 08 then uses the estimate basis (D10). Not a stop.

## Rollback

When the update or checks 1, 2, 4 or 5 fail: `git checkout <rollback commit>`; `docker tag ea-server:pre-f107 ea-server`; `$C up -d --no-build --wait`. Never `db:rollback`. The old code compares the accepted version for equality, so members who accepted the new version see the old dialog once more (accepted). Report the failing check to the owner.

## After

- 24 h without a problem: `docker image rm ea-server:pre-f107`.
- Write the result into `plan.md` § Log (date, commit, check outputs without ids).

## Done when

Checks 1–5 hold, `pilot-cost.md` is committed, the log line is written. U1 does not hold stage 08 or the close; check 3 proves the dialog will show.
