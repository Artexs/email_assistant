# F096 · E8-LR Log rotation — plan

> **Status 2026-11-14 — planned.** One stage, not built. The VPS gets the change with its next normal deploy; the ticket closes after the coordinator checks it there (D12).

## Input

Words that set the goal and the limits, word for word:

- E8 discovery decision 11 (`docs/product/stage-2/epics/E08-operations.md` § Discovery, owner: "I will just use your defaults", 2026-11-13): "Log rotation ships first as a tiny ticket next to E1 (a `logging:` block in `deploy/compose.yaml`, deployed with the next VPS deploy), not inside E8a. [yes]"
- E8 discovery notes §3 (`E08-discovery-notes.md`), default settings: "Docker rotation: `json-file`, `max-size: 10m`, `max-file: 5`, per service (the collector reads `json-file`; Compose-level options need no `sudo` and travel with the repo)."
- E8 epic page, in scope: "Docker log rotation (`max-size`, `max-file`) in `deploy/compose.yaml`; check `/etc/docker/daemon.json` on the VPS."
- E8 epic page, risks: "A log flood can fill the disk today (no rotation): do the rotation first, in a small separate ticket."
- PD-054 (`docs/product/stage-2/decisions.md`): "Log rotation ships first as a tiny ticket next to E1; then two tickets E8a Logs and E8b Alerts and releases."
- Planning job rules (coordinator, 2026-11-13): "Owner rules: no owner checkpoints for confirmation; list an owner step only for what needs the owner's hands (VPS, real secrets, real money); small questions get a default in questions.md."

### Product decisions

- **P1** Settings: driver `json-file`, `max-size: 10m`, `max-file: "5"` for every service. At most 50 MB per container. Reason: E8 decision 11 and notes §3; the E8a collector reads `json-file` files. Rejected: the `local` driver (compressed 5 × 20 MB, but the collector of E8a cannot read it).
- **P2** No own VPS deploy. The change reaches the VPS with the next normal deploy (E8 decision 11). Reason: the log volume is about 0.5 MB a day (VPS look 2026-11-13), so the risk grows slowly; an own deploy is one more DB restart and one more deploy window for 10 lines of YAML. Any deploy after the land recreates `db` once at `$C up -d --wait db` (F4), while the old `server` still runs: a short DB restart, the same as for a Postgres image change. Rejected: a stage 2 "deploy now".

### Design decisions

- **D1** Compose-level `logging:` per service, not `/etc/docker/daemon.json`. Reason: it travels with the repo, needs no `sudo`, and a clean install gets it (E8 notes §3). The VPS has no `daemon.json` (VPS look 2026-11-13), so nothing on the host overrides or conflicts. Rejected: `daemon.json` (host state outside the repo; it applies only to new containers too).
- **D2** One YAML anchor in `deploy/compose.yaml`: a top-level extension field `x-logging: &logging` and `logging: *logging` in each service (a plain alias, no `<<:` merge key). Reason: one place for the values; Compose accepts `x-` fields (probe F2). Rejected: the merge key `<<:` (not needed; the whole `logging` map is the same).
- **D3** `deploy/compose.dev.yaml` writes the same block in full for `greenmail`. Reason: a YAML anchor works only inside one file. The dev file's `db` entry only overrides `ports`; it keeps the base `logging` (Compose merges the files; probe F3).
- **D4** `compress` stays off (the `json-file` default). Reason: 50 MB per container is small; the E8a collector reads plain files; one less option to test.
- **D5** Check script `deploy/check-logging.sh [compose file …]`. Without arguments it also fails when `deploy/` holds a `compose*.yaml` or `compose*.yml` file that is not in its default list, so a new Compose file (E2b sim stack) cannot skip the check (review M1). It runs `docker compose -f <file> … --profile '*' config --no-env-resolution --no-interpolate --format json` and compares the `logging` of every service with the one exact value `{"driver":"json-file","options":{"max-size":"10m","max-file":"5"}}` (jq). Without arguments it checks `deploy/compose.yaml` and `deploy/compose.dev.yaml` of the repo, merged. Reason: `docker compose config` resolves anchors, file merges and profiles exactly as Docker will apply them; `--profile '*'` also covers profile services (E8a adds the `ops` profile); the two `--no-*` flags make it work without `.env` and keep secrets out (D6). Rejected: a Bun unit test that parses the YAML (it misses the Compose merge and profile rules, and `deploy/` is no workspace, so no typecheck covers it).
- **D6** Secrets: the script never prints the Compose config. It prints only service names. `--no-interpolate` keeps `${…}` unread and `--no-env-resolution` keeps `env_file: ../.env` unread, so no value from the environment or `.env` reaches even the JSON in memory, and no value reaches the output (tests 5 and 8 of the stage).
- **D7** CI: one step in the `image` job of `.github/workflows/ci.yml` (it already holds the deploy checks and has Docker). Reason: the check runs on every push, so a later service without rotation turns CI red.
- **D8** VPS check in `deploy/README.md` § Update: a new step after "Update and start" prints the log config of each running container; each line must show `json-file 10m 5`. On a different line: `$C up -d --force-recreate --wait <service>`. Reason: Compose recreates a container when its config hash changes (fact F4), so the next `up -d` applies the block; the check proves it on the real host without trust in that fact. A recreated container starts a new log file; the old unbounded file goes with the old container. Every deploy with `--build` already recreates `server`, so this loses no more history than a normal deploy.
- **D9** One-off containers (`$C run --rm server …`, used by migrations and CLIs) get the same `logging` from the service. No special case.
- **D10** `deploy/README.md` § Logs gets one short paragraph: the retention per container (5 × 10 MB), that older lines are gone, and that a new service in any Compose file needs the same block (`bash deploy/check-logging.sh`). Reason: the operator learns why `docker compose logs` stops at some point back in time.
- **D11** Shared dev stack (`CLAUDE.md` § Rules, "Shared runtime"): after the land, the next `bun run db:up` or `bun run dev:up` recreates the shared `db` and `greenmail` containers (F4). DB data stays in its volume; GreenMail loses its in-memory mail. A restart under a running `test:int` or `test:e2e` breaks that run. Rule: no worker runs `up`. After the land the coordinator runs `bun run dev:up` in the main checkout once, at a time when no job runs tests, if it has Docker access; else the owner's next `dev:up` does it (`questions.md` Q4). Nothing else on the PC needs it: the dev logs are small.
- **D12** Who checks the VPS (review M2): stage 1 lands with `limen land --keep-open`. At the next VPS deploy (F094 stage 2 or any later one) the coordinator runs the new § Update step, writes the lines into § Log, and closes the ticket with `limen ticket done`. The F094 stage 2 runbook is a copy of § Update without the new step, so the coordinator adds the check to that handover (see "How to run" step 6). Reason: the outcome is only true on the VPS; a closed ticket owns nothing.

### Edge cases (answered)

- **Before the first run** (the VPS before its next deploy): no rotation, as today. Risk is low (0.5 MB a day, 3.2 GB free on 2026-11-13). P2.
- **A container created before the change:** keeps its old log config until it is recreated. D8 checks it and forces a recreate when needed.
- **A new service later** (E8a `ops` profile, E2b sim stack): the CI check fails until it has the block (D5, D7). A new Compose file in `deploy/` fails the check until it is in the default list of the script (D5).
- **Shared dev stack:** D11.
- **Two runs at once, crash and repeat, tenants, clocks:** not relevant: no DB schema, no job, no stored state.
- **Secrets:** D6.

## Facts checked

- **F1** Docker `json-file` has no size limit by default; `local` driver defaults to 5 × 20 MB with compression (docs.docker.com logging driver pages; E8 notes §3, 2026-11-13). The VPS runs Docker 28.5.1 with `json-file` and no `/etc/docker/daemon.json` (read-only VPS look, 2026-11-13, `notes/2026-11-13-operations-facts.md`).
- **F2** Probe 2026-11-14, local Docker Compose 5.6.1, temp folder: an `x-logging: &logging` anchor with `logging: *logging` resolves in `docker compose config --format json` to `{"driver":"json-file","options":{"max-file":"5","max-size":"10m"}}`. An unquoted `max-file: 5` also comes out as the string `"5"`; the plan quotes it anyway.
- **F3** Probe 2026-11-14, copies of the real `deploy/compose.yaml` and `deploy/compose.dev.yaml` with the block added: `docker compose -f deploy/compose.yaml -f deploy/compose.dev.yaml --profile '*' config --no-env-resolution --no-interpolate --format json | jq -e '[.services[] | .logging == {"driver":"json-file","options":{"max-size":"10m","max-file":"5"}}] | all'` prints `true`, exit 0, with no `.env` file and no `POSTGRES_PASSWORD` set. With the `greenmail` block removed it prints `false`, exit 1. Without `--no-interpolate` (and with the variables unset) the command fails on the missing `../.env`; with `--no-interpolate` alone it passes (re-probe 2026-11-14, after review m1). So `--no-env-resolution` is not needed for the run; it stays to keep `.env` values out of the JSON (D6). `--profile '*'` lists a service that has `profiles: [ops]`; without the flag `docker compose config` left that service out (probe 2026-11-13 and re-probe 2026-11-14, Compose 5.6.1, `COMPOSE_PROFILES` unset). The review saw it listed without the flag; the stage keeps `--profile '*'` either way, and its test 4 checks the result, not the flag.
- **F4** Compose recreates a container when its config hash changes. The hash is the JSON of the whole service config minus `build`, `pull_policy`, `scale`, `deploy.replicas`, `depends_on` and `profiles`, so `logging` counts (docker/compose v2.40.0 `pkg/compose/hash.go`, `ServiceHash`, read 2026-11-14).
- **F5** CI runner `ubuntu-latest` (Ubuntu 24.04) has Docker Compose 2.38.2 and jq 1.7.1 (actions/runner-images `images/ubuntu/Ubuntu2404-Readme.md`, read 2026-11-14). Compose 2.38.2 `config` has `--format`, `--no-env-resolution` and `--no-interpolate` (docker/compose v2.38.2 `docs/reference/compose_config.md`). compose-go handles the profile name `*` as "all profiles" (compose-spec/compose-go v2.6.0 `types/project.go`).
- **F6** The pre-commit hook runs `lint-staged`: `prettier --write` on staged `*.md` and `*.json`, `eslint --fix` + prettier on `*.ts`. YAML and shell files are not formatted (`package.json` § lint-staged).

## Not verified

- **N1** `--profile '*'` on the CI runner at run time. The cold review ran the plan's command on the official Compose v2.38.2 release binary (2026-11-14, `plan-review-1.md` § Checks I ran): accepted, tests 3 and 4 gave the expected names. Open: the runner image can move to another Compose version before the land. Checked by: the first `master` CI run after the land (`gh run list --branch master --workflow CI --limit 3`). On a failure: the coordinator reverts the CI step or fixes it the same day (`CLAUDE.md`: CI on `master` stays green).
- **N2** The recreate on the VPS (F4 is from source; the VPS Compose version is not known). Checked by: the § Update step of D8 at the next VPS deploy (D12).
- **N4** `prettier` on `deploy/README.md` through the pre-commit hook may rewrap lines outside the new text (the review could not run it). Checked by: the worker reads `git diff --staged deploy/README.md` before the commit; lines outside the stage's text must not change.
- **N3** Local Docker daemon behaviour (no access to the Docker socket in the planning job). Not needed: the check uses only `docker compose config`, which needs no daemon (F3 ran without it).

## Done when

1. Every service of `deploy/compose.yaml` and `deploy/compose.dev.yaml` has `logging` `json-file`, `max-size: 10m`, `max-file: "5"`. Shown by: `bash deploy/check-logging.sh` exits 0 and prints `logging ok: db greenmail server`.
2. The check fails on a missing or different block, also in a profile service, and on a Compose file in `deploy/` that is not in its list. Shown by: stage tests 2–4 and 7, each exit 1 with only the bad service or file named.
3. The check prints no secret and never reads `.env`. Shown by: stage tests 5 and 8.
4. CI runs the check. Shown by: the `image` job step in `.github/workflows/ci.yml`, and the first green `master` CI run after the land (N1).
5. The runbook has the VPS check and the retention paragraph. Shown by: `deploy/README.md` § Update and § Logs (D8, D10).
6. After the land: the next VPS deploy shows `json-file 10m 5` for `db` and `server` (D8). The coordinator records the lines in § Log, then closes the ticket (D12).

## Rules for every stage

- Change only the files of the stage. Format only those files; never run `bun run format` or `prettier --write .` (an S2 builder ran the repo-wide formatter).
- Never read, print or copy `.env` or any secret. The check script uses `--no-interpolate --no-env-resolution` and never prints the config (D6).
- No VPS access, no `ssh`, no `docker compose up` against the shared dev stack. `docker compose config` only.
- Shell scripts: `#!/usr/bin/env bash` and `set -euo pipefail`, like `deploy/backup.sh`. Template literals rule does not apply to shell; keep variables quoted.
- A gap or a deviation is a question in the final message, not a choice.
- While you work, run only the check of the stage. The full Proof runs once, after the last commit.

## Proof

```
mkdir -p /tmp/f096-s01 && bash deploy/check-logging.sh > /tmp/f096-s01/check.log 2>&1 && bun run lint > /tmp/f096-s01/lint.log 2>&1 && bun run typecheck > /tmp/f096-s01/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f096-s01/unit.log 2>&1 && bun run test:int:ci > /tmp/f096-s01/int.log 2>&1 && echo PROOF_OK
```

Run it after the last commit, with nothing after it. The stage tests 1–9 save their output to `/tmp/f096-s01/cases.log` before the Proof.

## Owner checkpoints and owner steps

None. No step needs the owner's hands: no secret, no money. The VPS check of D8 runs inside the next normal deploy, which the coordinator does (owner decision 2026-11-13: VPS steps are pre-approved).

## Review

No review job before the land. The stage changes config, a shell check and docs; it is not `[risky]` (no data, no auth, no send). The worker proof and the first `master` CI run decide.

## Stages

- [ ] [Stage 01 — Compose log rotation, check script, CI step, runbook](stages/stage-01-compose-rotation.md)

## How to run (coordinator)

1. Move the ticket to `spec/features/active/` and commit before the spawn.
2. Spawn (standing models of `spec/build.md` TRACK):
   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "Compose log rotation · F096" \
     'Implement F096 stage 01. Read spec/features/active/F096-e8-lr-log-rotation/ticket.md, plan.md and stages/stage-01-compose-rotation.md; build every step of that stage. Final proof: mkdir -p /tmp/f096-s01 && bash deploy/check-logging.sh > /tmp/f096-s01/check.log 2>&1 && bun run lint > /tmp/f096-s01/lint.log 2>&1 && bun run typecheck > /tmp/f096-s01/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f096-s01/unit.log 2>&1 && bun run test:int:ci > /tmp/f096-s01/int.log 2>&1 && echo PROOF_OK. In the final message, list as proven only what a saved log shows.'
   ```
3. It may run next to any other build: no migration, no `bun.lock` change. File overlap (advisory): `.github/workflows/ci.yml` `image` job and `deploy/README.md` § Update are also near F094 (one Bun pin) work.
4. Land with `limen land --keep-open` (D12). Drop the job DB after the land.
5. After the land: `gh run list --branch master --workflow CI --limit 3` must show the run green (N1). A red `image` job from the new step: fix or revert it the same day.
6. Shared dev stack: run `bun run dev:up` once in the main checkout when no job runs `test:int` or `test:e2e` (D11). Check with `docker inspect --format '{{.Name}} {{.HostConfig.LogConfig.Type}} {{index .HostConfig.LogConfig.Config "max-size"}} {{index .HostConfig.LogConfig.Config "max-file"}}' $(docker ps -q --filter label=com.docker.compose.project=email-assistant)`. No Docker access: leave it to the owner's next `dev:up` (Q4).
7. Next VPS deploy (F094 stage 2 or any later one): add the new `deploy/README.md` § Update step 4 to that deploy's checks, run it after `up`, write the lines into § Log of this file, then `limen ticket done` for F096 (Done when 6, N2, D12). A line other than `json-file 10m 5`: `$C up -d --force-recreate --wait <service>` and check again.

## Planning progress

- [x] ticket.md
- [x] plan.md
- [x] stages/stage-01-compose-rotation.md [written]
- [x] cold review (`plan-review-1.md`)

## Cold review

One round, 2026-11-14, Opus 5.5 high, review job `2026-11-14-f096-plan-review-b007c693` on commit `64a6d1a`: PASS; blocking 0, major 3, minor 5, notes 3. Filed whole in [`plan-review-1.md`](plan-review-1.md).

- M1 (a new Compose file skips the check): fixed, D5 and stage test 7.
- M2 (nobody owns the VPS proof): fixed, D12, How to run step 7, land with `--keep-open`; the F094 stage 2 handover gets the check (edit outside this folder, named in the planner's final message).
- M3 (shared dev stack restart): fixed, D11, How to run step 6, `questions.md` Q4.
- m1 (two F3 claims): half accepted. Re-probe: the `.env` claim was wrong with `--no-interpolate`, F3 corrected; the profile claim held on Compose 5.6.1, F3 notes the review's other result. Test 8 now proves `--no-env-resolution` by a check on the script.
- m2 (`git diff --stat master`): fixed, `master...HEAD`.
- m3 (where to add the probe service): fixed, before the top-level `networks:`.
- m4 (relative arguments untested): fixed, stage test 9; the script must not `cd`.
- m5 (ticket pointer): fixed.
- n1 (deploy restarts `db`): fixed, P2 reason and the README step text.
- n2 (CI before the land): N1 updated with the review's v2.38.2 run; no push before the land (pushing is not this ticket's need).
- n3: no change.

## Log

- 2026-11-13 / 2026-11-14: planned by a Limen planner job (Opus 5.5). The run stopped once on the quota limit and continued.
