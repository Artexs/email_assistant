# F107 stage 07 — VPS deploy and pilot cost measurement

Part of [`../plan.md`](../plan.md). `[risky]` (the real system). **The coordinator runs this stage itself** (`spec/build.md`: VPS steps are pre-approved; backup first, name the rollback target, verify after). No worker job. Needs stages 01–06 landed and the `master` CI run of the last land green. Decisions P5, P7, D11.

**Rules of this stage.** No write to the pilot data. The measurement commands only read. Nothing that this stage writes to the repo holds an id, an address, a subject, an organization name or a secret.

## Before

1. `git log --oneline <VPS commit>..origin/master`: other tickets with their own VPS step go first, by their runbook.
2. The deploy has no migration. The new `TERMS_VERSION` shows the terms dialog to every member at the next request after sign-in.

## Runbook

On the VPS, repo root, `C="docker compose -f deploy/compose.yaml --env-file .env"`; `deploy/README.md` § Update.

1. `git rev-parse HEAD` → the rollback commit.
2. `deploy/backup.sh` → last line `backup ok <name> <bytes>`; stop if not.
3. `docker tag ea-server ea-server:pre-f107`.
4. `df -h /`: stop below 3 GB free (`docker builder prune -f` first).
5. `git fetch && git merge --ff-only origin/master`
6. `T=$(date -u +%Y-%m-%dT%H:%M:%SZ)`; `$C up -d --build --wait`.

## Checks

1. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health` → `200`.
2. For each of the six paths `/legal/<pl|en>/<privacy|terms|dpa>`: `curl -sS http://127.0.0.1:8080<path>` → status 200 and the body holds the draft line of its language (en: `DRAFT, not legal advice`; pl: `WERSJA ROBOCZA`).
3. `$C logs --since "$T" server | grep -E "_failed|error"` → no new line from F107 code (F107 adds no server runtime code; a line here is from another cause: report it).
4. Wait 11 minutes; `$C logs --since "$T" server | grep sync_done` → lines for the pilot mailbox.
5. **Owner step U1:** the owner signs in on the panel, sees the terms dialog with the new version, reads the links, accepts. The coordinator then checks `select terms_version from users where id = <owner id>` → the new `TERMS_VERSION` (print only the version).

## Measurement (read only)

M0. Find the four last finished weeks (Mondays in the organization time zone) and the pilot organization and mailbox ids; keep the ids out of every file.
M1. For each week: `$C run --rm server bun run stats:week --org-id <pilot org> --week <monday>` → note M7 `llmUsdWeek`, `llmCalls`, `unpricedCalls`, `mailboxes`.
M2. `$C run --rm server bun run triage:cost --org-id <pilot org> --mailbox-id <pilot mailbox> --days 28` → note, per model, the LLM result count, the average tokens in and out, the average cost per mail.
M3. Write `spec/features/active/F107-e7-t4-papers-and-cost/pilot-cost.md`: the date, the four week dates, the M1 numbers per week, the M2 numbers per model, the model names, and one line "read-only on the VPS at <commit>". Commit it with its explicit path.

When a command fails or the pilot had no mail in the 28 days, write that into `pilot-cost.md`; stage 08 then uses the estimate basis (D10). This is not a stop.

## Rollback

When runbook step 6 or checks 1–4 fail: `git checkout <rollback commit>`; `docker tag ea-server:pre-f107 ea-server`; `$C up -d --no-build --wait`. The old code compares the accepted version for equality, so every member who accepted the new version sees the dialog of the old version once more (accepted). Report the failing check to the owner.

## After

- 24 h without a problem: `docker image rm ea-server:pre-f107`.
- Write the result into `plan.md` § Log (date, commit, check outputs without ids).

## Done when

Checks 1–4 hold, `pilot-cost.md` is committed, the log line is written. U1 does not hold stage 08.
