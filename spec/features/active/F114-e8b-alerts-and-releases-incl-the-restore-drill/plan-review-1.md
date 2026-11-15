# F114 plan review 1

Job `2026-11-15-f114-plan-review-e6bf4068` (claude-opus-5-5, thinking high), final message filed whole:

FAIL c19d2191c46503fd4aab611faa341677eeaf6760

HEAD is c19d2191c46503fd4aab611faa341677eeaf6760, which matches the candidate. The worktree is clean (`git status --short` is empty). I edited no file. My one probe folder was `/tmp/f114rev`, outside the worktree, and I deleted it.

## Blocking

**B1. The restore drill's one-off commands run in the `cli` service, and the drill override does not cover `cli`.** The drill then fails at migrate. With `--build`, it also moves the live `ea-server:latest` tag. Proven by reproduction.
- **What the plan says:**
  - `stage-07-restore-path.md:7-8` overrides only `server`: the image `ea-drill-server`, `env_file` replaced by `drill.env`, and the forced empty keys.
  - `stage-07-restore-path.md:16` runs "migrate (the one-off service of `compose.yaml`)" and `credentials:check` before `up`.
  - `plan.md:38` (D22) says that service is `cli` after F103 stage 17.
  - `ticket.md:39` says build after F103 is done, so `cli` exists by stage 08.
- **How F103 stage 17 defines `cli`:** `extends: service: server` (`spec/features/active/F103-e8a-logs/stages/stage-17-log-drivers-and-cli-service.md:26-34`). It keeps `--build` on one-off lines ("`cli` builds the same image", line 66).
- **The reproduction:** I made a minimal copy of `deploy/compose.yaml` with `cli extends server`, plus a `compose.drill.yaml` like stage 07 (`image: ea-drill-server`, `env_file: !override drill.env`, `ports: !reset []`). I ran `docker compose -p ea-drill -f deploy/compose.yaml -f deploy/compose.drill.yaml --profile cli config` on Compose 5.6.1. Results:
  - `cli` keeps `image: ea-server` and the base build. It keeps `127.0.0.1:8080` in its ports and gets no forced empty keys. Compose resolves `extends` before it merges the override.
  - With no `.env` in the project root, which is the state of the fresh clone `~/ea-drill/repo`, Compose stops with `env file /tmp/f114rev/.env not found`.
- **Effect:**
  - Stage 08 step 13 cannot print `restore ok target=drill`. That breaks ticket acceptance bullet 4 (`ticket.md:29`).
  - If someone makes the clone work, two failure modes remain. First, `run --build --rm cli` builds the drill checkout as `ea-server:latest`. That moves the live tag, which breaks `stage-07-restore-path.md:7` ("must never move the live `ea-server:latest` tag") and D11 (`plan.md:27`). Second, `run --rm cli` without `--build` runs the live image, not the drill build.
- **Why the plan's checks miss it:** Stage 07 test 7 (`stage-07-restore-path.md:39`) parses the override YAML alone. Stage 08 V2 (`stage-08-vps-release-and-drill.md:26`) checks only the port and image of `server`.
- **Needed decision:** the drill override also sets `cli` (image `ea-drill-server`, `env_file` drill.env, the forced keys), or `restore.sh` runs its one-offs in `server`. Test 7 should run on the merged `config` output, and V2 should check `cli` too.
- **Version caveat:** the VPS has Compose 2.40 (`notes/2026-11-03-pilot-vps.md:7`). I did not run that version. Compose 2.40 likely resolves `extends` the same way, but that is not checked.

## Unverified checks

- B1 on the VPS Compose 2.40: not run.
- No JavaScript suite ran. This is a plan review with no code diff, so I did not install anything.

## Notes

**N1. Proven by code read: the urgent rule fires falsely for urgent mail that by design never gets a notice.**
- The rule is `stage-02-checks.md:26`: late = `noticeAt` null and `now − due > N`.
- The urgent detector skips three kinds of mail:
  - Mail in the spam folder (`apps/server/src/modules/channels/notices/urgent.ts:35-41`, D23).
  - Mail triaged before the member linked the chat (`urgent.ts:25,69`).
  - Mail triaged before an organization resume (`urgent.ts:24-25`, S3).
- A suspend also cancels the queued urgent rows: `orgPlanHooks` → `cancelPendingOutboxOfOrg` (`apps/server/src/composition.ts:120-122`).
- Each such mail keeps `slo_urgent_latency` open for the full 24 h window, with repeats.
- `stage-02-checks.md:16` reuses the M5 SQL (`channels/metrics-repo.ts:18-41`), which has none of these filters.
- No stage 02 test covers them.

**N2. Proven by code read: `/resume` and organization resume are only partly solved.**
- `plan.md:22` (D6) says `/resume` and suspended orgs are solved.
- The sync-lag reader uses `greatest(last_synced_at, status_changed_at, created_at)` (`stage-02-checks.md:15`). It does not use `organizations.resumed_at`. The existing `sync_stale` detector uses both (`notices/sync.ts:28-33`).
- So after an org resume, the first `ops.slo` tick can fire before the first sync.
- For the urgent rule, mail that arrived while a mailbox was paused or an org was suspended syncs late. Its `received_at` is old, so it counts as late (`stage-02-checks.md:26`).
- A fix: due = max(`receivedAt`, mailbox `status_changed_at`, org `resumed_at`), then the quiet-hours shift.

**N3. Plausible: the quiet-hours rule shifts by receive time, but the sender holds by send time.**
- The sender holds a notice when `isQuietTime(now)` is true at send time (`channels/sender.ts:148-151`).
- The plan shifts due only when `receivedAt` is in quiet hours.
- Urgent mail received just before 22:00 local and queued after 22:00 waits until 07:00. That fires a false alert overnight. An LLM soft pause of 5–60 min widens this window.

**N4. Plausible, missing decision: the first release has no bootstrap.**
- `release.sh` and `rollback.sh` do not exist at the VPS commit `df42788b` (`notes/2026-11-15-vps-deploy-queue.md:14`; `git ls-tree df42788b deploy/` lists no such files).
- The plan has no step that moves the VPS tree to a commit with the stage 05 scripts before `stage-08-vps-release-and-drill.md:10`.
- After the first rollback (`stage-08:14`), the tree is at the pre-v0.1.0 commit. If that commit predates stage 05, the second `deploy/rollback.sh` does not exist. That breaks ticket bullet 2 (`ticket.md:27`).
- It works only if a batch deploy at a commit at or after stage 05 happened first. That is likely given the deploy-queue practice, but the plan does not decide it.

**N5. Missing test: a failed first release followed by a rollback.**
- `stage-05-release-scripts.md:19-20` writes `pending` at step 3. It says the `pre-<tag>` image "becomes `current`", but not when the state file gets it.
- If `current` is written only at step 10, a failure at steps 5–9 of the first release leaves `rollback.sh` with "no target" and exit 2. That is the stage 08 Part A failure path.
- Test 8 (`stage-05:46`) covers only the success path.
- Also not decided: the state file is written in place, not with tmp + `mv`.

**N6. Plausible: release step 7 can rebuild the image without the release stamp.**
- Step 7 migrates "with the one-off service" (`stage-05:23`). The README pattern is `run --build --rm cli`.
- If that call carries `--build` without `EA_RELEASE` in its environment, it rebuilds `ea-server` with `EA_RELEASE=dev`. Then verify at step 9 fails.
- The plan does not state `--no-build` for steps 7 and 8.

**N7. Proven gap in a decision: the `new-host` guard cannot run on a fresh DB.**
- `stage-07-restore-path.md:16` refuses when `organizations` has a row. On a fresh host, the table does not exist before `pg_restore`, because migrate runs after the restore. The guard query then errors, and the plan does not say whether to refuse or go on.
- The real precondition is an empty schema: `--exit-on-error` fails on a DB that was migrated first.
- The drill path has no check that the `ea-drill` volume is empty after a failed earlier drill.

**N8. Plausible: a guard query can read the dump stream.**
- With `--stdin`, a `docker compose exec` before `pg_restore`, such as the `new-host` count query, forwards stdin by default. It can read part of the dump.
- The plan does not require `</dev/null` on the other docker calls.

**N9. Proven by plan text: the contract check misses some changes that break old code.**
- The replace exception (`stage-06-migration-check-docs.md:9`, test 4) accepts `DROP CONSTRAINT x` plus `ADD CONSTRAINT x`. That includes a CHECK that narrows a kind list, which breaks the previous release's writers.
- `DROP INDEX` (`stage-06:10`) is allowed even for a unique index that an `ON CONFLICT` needs. Example: `ops_alerts_active_kind`, used by `openAlert`.
- `REVOKE`, `TRUNCATE`, `DROP SCHEMA/SEQUENCE/EXTENSION` and new `ADD CONSTRAINT` checks are not flagged.
- Acceptance bullet 3 still holds for the listed rules.

**N10. Plausible: the drill alert check can see a restored live alert row.**
- `stage-08-vps-release-and-drill.md:28` expects `slo_alert_sent kind=slo_backup_age` within 6 min.
- The restored `ops_alerts` comes from live. If the dump holds an open, sent `slo_backup_age` row, `nextAlertStep` returns `none`, and the check fails. This can happen because the dump is taken before the next live tick resolves the row.
- Also: at the first release, step 1 runs the old `backup.sh`, which writes no status file. So v0.1.0 starts with no status file and sends a real `slo_backup_age` ALERT until Part A step 5 (`stage-08:13`).

**N11. Proven by doc text: two rules conflict.**
- `docs/code-patterns.md:222` says the `operator` module "reads other organizations only through tenant-scoped functions … (it adds no exception to § Data access)".
- D8 (`plan.md:24`) puts cross-org readers and the job in `modules/operator`.
- No stage updates line 222.

**N12. Plausible: the sync-lag check has no start grace.**
- The existing detector waits `STALE_GRACE_AFTER_START_MS` (10 min) after the server starts (`notices/sync.ts:41`). The sync-lag check does not.
- After a downtime longer than 15 min, the operator gets an ALERT and then a RESOLVED within minutes.

**N13. Plausible: `release.sh` over non-interactive ssh can pick the wrong rclone.**
- rclone 1.75 is in `~/bin` (`notes/2026-11-03-pilot-vps.md:22`). README line 45 adds `PATH=$HOME/bin:$PATH`.
- Over a non-interactive ssh, `backup.sh` can pick the apt rclone 1.53, which fails with B2. Then release step 1 fails. This is a safe failure, because it happens before `pending` is written.
- Stage 08 step 2 has no PATH note.

**N14. Facts with no source or check:**
- No stage checks that the drill subnet `172.29.0.0/24` is free on the VPS. README line 179 does such a check for 172.30.
- `stage-02-checks.md:13` says "suspended". The column is `organizations.plan = 'suspended'` (`db/migrations/20261112100001_org_plan.sql:3`).
- `credentials:check` (D20) is a cross-org reader, but it is not in the `code-patterns.md` exceptions.
- `ops_alerts` also needs an `EXPORT_MAP` entry (`privacy/export-map.ts`, enforced by `privacy-export-map.test.ts`). Stage 01 (line 44) names only `NO_PERSONAL_TABLES` and "any test that lists tables".

## Checked, holds

- **Step table (`stage-01-alert-state.md:17-31`):** every reachable row state has a step. Tests 6–7 and 9 follow the 6 h boundary.
- **Crash and restart:** a crash between send and mark repeats one notice, so at-least-once holds. `openAlert` on conflict and the partial unique index keep one active row per kind. A restart keeps no memory.
- **Stage 02 test values:** match the rules, including Warsaw in November = UTC+1: `quietEnd(22:30Z)` = 06:00Z.
- **LLM rule:** `http_429_quota` is a config code with a 2 h window (`platform/llm/errors.ts:38-48`, `audit/llm-pause.ts:39-44`), so the alert does not flap.
- **Disk and backup:** the rules and test values agree.
- **Rollback:** `pending` → current, else → previous. This makes the two-rollback toggle in `stage-08:14` consistent with the state.
- **Drill isolation from the live DB:**
  - `-p ea-drill` with the override `name:`.
  - The override subnet replaces the base subnet. Reproduced: the merged config shows only 172.29.
  - Own volume. `down -v` and `image rm` touch only drill objects.
  - `--init-env` reads the live `.env` and writes nothing to it.
  - The drill server cannot reach the live `db` by name.
- **Telegram guard:** `OPERATOR_TELEGRAM_CHAT_ID` without a token is a start error (`platform/config.ts:323-325`), so the `telegram is off` throw cannot repeat every tick.

## Checks I ran

- Read the ticket, plan, questions, scouts and stages 01–08.
- Code reads at HEAD: `channels/sender.ts`, `notices/urgent.ts`, `notices/sync.ts`, `channels/metrics-repo.ts`, `core/metrics/m5.ts`, `core/digest/local-time.ts`, `audit/llm-pause.ts`, `platform/llm/errors.ts`, `mail/jobs.ts`, `mail/repo/targets.ts`, `composition.ts`, `main.ts:100-283`, `platform/config.ts`, `deploy/compose.yaml`, `privacy/export-map.ts`, `privacy/address-map.ts`, `layers.json`, `docs/code-patterns.md:153-222`.
- `git ls-tree df42788b deploy/`: shows no `release.sh` or `rollback.sh`.
- `docker compose ... config` probes on Compose 5.6.1 in `/tmp/f114rev`:
  - `cli extends server`: `cli` keeps image `ea-server`.
  - Missing `.env`: `env file ... not found`.
  - Network override: the merged config shows only 172.29.
- `git rev-parse HEAD && git status --short && echo CLEAN` printed the candidate sha and `CLEAN`.
- I installed nothing and ran no test suite: there is no code diff.

## Note check

- HEAD is the candidate c19d2191: proven. `git rev-parse HEAD && git status --short && echo CLEAN` exited 0 and printed c19d2191c46503fd4aab611faa341677eeaf6760.
- Each requested area has a finding or a "checked, holds" line with file and line: proven. This final message covers each area:
  - Alert step table and crash/restart: "Checked, holds".
  - Quiet hours: N3.
  - `/resume` and org resume: N2.
  - Suspended orgs: N1, N2, N14.
  - Release and rollback state machine: N4–N6.
  - Migration check rules: N9.
  - Drill isolation: B1, N7, N8, N10.
  - Gaps: N1–N3, N12. Conflicting rules: N11. Steps a worker must guess: B1, N5, N7. Facts with no source: N14.
  - The stages fit the size rule (`plan.md:105` word counts), so I found no stage too big for one job.
- First line is `PASS <sha>` or `FAIL <sha>`, with file and line on each finding: proven. The first line of this message is `FAIL c19d2191c46503fd4aab611faa341677eeaf6760`.
- Easy-to-miss rule "Do not edit files.": followed. `git rev-parse HEAD && git status --short && echo CLEAN` printed no status line before `CLEAN`.
