# F108 plan refresh 1

Old base: `c68ce51e` (2026-11-19 00:41). New base: `f21809c4` (HEAD, 2026-11-19 22:42). No scouts (refresh job).

## Drift (`scripts/plan-drift.sh <folder> c68ce51e`)

```
named paths: 20; changed since base: 4; gone: 0
changed: deploy/backup.sh
changed: deploy/compose.drill.yaml
changed: deploy/README.md
changed: deploy/test/backup.test.ts
commits after the base that touch the named paths:
  e0e5a098 F115 stage 17: gate state after the OpenAI runs (G1 not passed) in the docs, response note
  77fa2d84 F115 stage 17: rollback SQL fails urgent views with draftable, ...
  d276d063 F115 stage 17: the Confirm block shows for reply_drafts too, ...
  23d10e09 F115 stage 17: deploy guide for reply drafts with tested rollback SQL, ADR 0033 accepted, ...
  4495e7e0 F114 stage 09 Part C: restore drill record (restore 173 s, counts equal, live untouched)
  36c1a440 backup.sh: retry the B2 copy with backoff and lock against concurrent runs
  62d0727d docs(privacy): rule check, rule_mismatch refusal and --rule-check (F137 stage 04)
  916e17db F120 stage 12: sender-context capability page, ADR 0034 accepted, ...
  0b3f8c9b F118 stage 13 review B1, N8: rollback to a build older than the push sender closes push rows first
  2663c767 F118 stage 13: papers (web-push row, Telegram levels, TERMS_VERSION 2026-11-19), docs, ADR 0032 accepted, rollback lines
  ecbd2bfd F118 stage 08b: carry-over from the stage 08 review ...
  651bcc11 F118 stage 08: push renderer, facts and the push sender job
  1f915043 F111 stage 06: own-model guide, ADR 0035 accepted for decisions 1-5, guard test
```

Also read (not named paths, but the stages use them): `.gitignore` (`backup.lock` ignored), `deploy/backup.env.example` (retry keys), `deploy/test/compose-drill.test.ts` (`VAPID_PRIVATE_KEY` forced), `docs/release-checklist.md` step 11 (push-row steps before an old rollback), `docs/capabilities/backups.md` and `operations.md` (drill ran), `docs/decisions/README.md` (0019 still reserved).

## Changes

- Every stage: a first `Needs` line that names the real input (file, interface, record or release content), per `.agents/limen/planner.md` § Needs lines. Stages 04, 06, 07 say "coordinator run; no worker job". Stage 07: steps 1–8 read nothing from stages 01–06.
- Stage 01: `migrate` in `compose.drill.yaml` gets image, restart, log and ports on the service, not the `x-drill-server` anchor. Why: the anchor carries `env_file: drill.env` and the forced channel env (now also `VAPID_PRIVATE_KEY`); `migrate` needs neither (D3 shape). Test 8 now asserts the exact two env keys and no `env_file`.
- Stage 01: `compose-drill.test.ts` image/log/restart/port checks cover every `ea-server` service; env checks stay on `server` and `cli`. Why: `serverImageServices()` finds only `server` and services that `extend` it, and `migrate` does not.
- Stage 01: in `backup.sh` the helper call goes after the `flock` lock and inside the exit trap; new test 5b (no env file → `failed` status, exit ≠ 75). Test 5 runs in the `backup.test.ts` harness (`BACKUP_RCLONE_DELAY=0`). Why: commit `36c1a440` added the lock before the trap; a lock loser must write nothing, a missing env file must alert.
- Stage 01: wrong stage numbers fixed (key removal is stage 05, docs stage 03).
- Stage 01, 05: `restore.sh` is shared with F139 (readiness wait before `guard-empty`). Stage 05 keeps the F139 wait unchanged; its `new-host` guard runs before `up -d --wait db`; new test 10 (the F139 test still passes).
- Stage 02: the stub pattern of `backup.test.ts` described as it is now (`stub(name, body)`, a calls file for a stub that counts or fails on call N).
- Stage 03: new README sections in scope: § Phone notices (F118) teaches `cp -p .env .env.bak-vapid` and restores it in Roll back step 3; § VPS lost now holds the drill record (keep it; F139 owns its `guard-empty` line); § Drill `--init-env` stays (reads only `CREDENTIALS_KEY*`). New test 4: no `.env.bak` in `deploy/README.md`.
- Stage 04 rules (also stage 06): the backup lock. No release or manual backup near the cron time; exit 75 / `another backup run holds` changed nothing, wait and rerun; retry lines are not failures. Rollback by checklist step 11 includes its new push-row steps.
- Stage 06 step 5: `status.json` is the truth; from `backup.log` the last `backup ok` line plus counts of retry and lock lines. Why: the old check "last line that starts with `backup`" now hits `backup: rclone copyto try …` and `backup: another backup run holds …`.
- Stage 07: F114 is in `done/` and has no `outcome.md`; read the drill record in README § VPS lost and the queue note. The drill ran at `v0.3.1` (no `compose-lib.sh`), so it does not prove the `migrate` restore path; the F139 rerun on the release that carries stage 01 (board: v0.4.2) does. V4 rewritten in `plan.md` and `interfaces.md`.
- `interfaces.md` § Seams: the drill result, F139, the backup lock; no other ticket's stage file holds `C=… --env-file .env` now (was F029, F102, F104, F107, F118; all done).
- `plan.md`: status line, D3 wording, V4, owner steps (the `age` key wait is gone: the drill ran), How to run step 3, word counts, log.
- Proof blocks in stages 01, 02, 03, 05 point to `plan.md` § Proof (word budget).

## Checked, no change needed

- `restore.sh` drill branch: `C=(… -f compose.drill.yaml --env-file deploy/drill.env)`; `init_env` reads only `CREDENTIALS_KEY` and `CREDENTIALS_KEY_VERSION` from the live `.env`, so the drill works after the split. The `migrate` step is still `run --rm -T cli bun run db:migrate` (stage 01 changes it).
- `--env-file .env` sites at HEAD: `release-lib.sh`, `backup.sh`, `logs.sh`, `restore.sh` (new-host), README `C=` and the § 48-hour cron line. Same as the plan.
- `release.sh` runs `backup.sh` before the `pending` mark and needs the last line `backup ok`: the stage 05 guard still runs before both.
- ADR 0019 still reserved in `docs/decisions/README.md`; `docs/architecture.md` § 10 Deployment exists.
- `deploy/compose.sim.yaml` change (GreenMail API port) does not touch D9.
- The queue note has § Restore drill record; `tasks/active/s6-pre-sale.md` and `tasks/planned/s6f-hosted-production.md` exist (stage 07 step 11).
- No landed ticket did a step of this plan (no `compose-lib.sh`, `env-split.sh`, `check-server-env.sh`, `migrate` service, ADR 0019 at HEAD).

## Cold review

Not run. The refresh keeps every decision, interface signature, stage and order. The new items (test 5b, the drill block wording, the guard placement next to the F139 wait, the stage 06 log check) are clarifications that follow from D2, D3, D8 and the landed backup lock, not new interfaces or steps.
