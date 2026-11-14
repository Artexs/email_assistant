# F096 · E8-LR Log rotation — plan

> **Status 2026-11-14 — planned.** One stage, not built. The VPS gets the change with its next normal deploy.

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
- **P2** No own VPS deploy. The change reaches the VPS with the next normal deploy (E8 decision 11). Reason: the log volume is about 0.5 MB a day (VPS look 2026-11-13), so the risk grows slowly; an own deploy restarts the DB for 10 lines of YAML. Rejected: a stage 2 "deploy now".

### Design decisions

- **D1** Compose-level `logging:` per service, not `/etc/docker/daemon.json`. Reason: it travels with the repo, needs no `sudo`, and a clean install gets it (E8 notes §3). The VPS has no `daemon.json` (VPS look 2026-11-13), so nothing on the host overrides or conflicts. Rejected: `daemon.json` (host state outside the repo; it applies only to new containers too).
- **D2** One YAML anchor in `deploy/compose.yaml`: a top-level extension field `x-logging: &logging` and `logging: *logging` in each service (a plain alias, no `<<:` merge key). Reason: one place for the values; Compose accepts `x-` fields (probe F2). Rejected: the merge key `<<:` (not needed; the whole `logging` map is the same).
- **D3** `deploy/compose.dev.yaml` writes the same block in full for `greenmail`. Reason: a YAML anchor works only inside one file. The dev file's `db` entry only overrides `ports`; it keeps the base `logging` (Compose merges the files; probe F3).
- **D4** `compress` stays off (the `json-file` default). Reason: 50 MB per container is small; the E8a collector reads plain files; one less option to test.
- **D5** Check script `deploy/check-logging.sh [compose file …]`. It runs `docker compose -f <file> … --profile '*' config --no-env-resolution --no-interpolate --format json` and compares the `logging` of every service with the one exact value `{"driver":"json-file","options":{"max-size":"10m","max-file":"5"}}` (jq). Without arguments it checks `deploy/compose.yaml` and `deploy/compose.dev.yaml` of the repo, merged. Reason: `docker compose config` resolves anchors, file merges and profiles exactly as Docker will apply them; `--profile '*'` also covers profile services (E8a adds the `ops` profile); the two `--no-*` flags make it work without `.env` and keep secrets out (D6). Rejected: a Bun unit test that parses the YAML (it misses the Compose merge and profile rules, and `deploy/` is no workspace, so no typecheck covers it).
- **D6** Secrets: the script never prints the Compose config. It prints only service names. `--no-interpolate` keeps `${…}` unread and `--no-env-resolution` keeps `env_file: ../.env` unread, so no value from the environment or `.env` reaches the output (test 5 of the stage).
- **D7** CI: one step in the `image` job of `.github/workflows/ci.yml` (it already holds the deploy checks and has Docker). Reason: the check runs on every push, so a later service without rotation turns CI red.
- **D8** VPS check in `deploy/README.md` § Update: a new step after "Update and start" prints the log config of each running container; each line must show `json-file 10m 5`. On a different line: `$C up -d --force-recreate --wait <service>`. Reason: Compose recreates a container when its config hash changes (fact F4), so the next `up -d` applies the block; the check proves it on the real host without trust in that fact. A recreated container starts a new log file; the old unbounded file goes with the old container. Every deploy with `--build` already recreates `server`, so this loses no more history than a normal deploy.
- **D9** One-off containers (`$C run --rm server …`, used by migrations and CLIs) get the same `logging` from the service. No special case.
- **D10** `deploy/README.md` § Logs gets one short paragraph: the retention per container (5 × 10 MB), that older lines are gone, and that a new service in any Compose file needs the same block (`bash deploy/check-logging.sh`). Reason: the operator learns why `docker compose logs` stops at some point back in time.

### Edge cases (answered)

- **Before the first run** (the VPS before its next deploy): no rotation, as today. Risk is low (0.5 MB a day, 3.2 GB free on 2026-11-13). P2.
- **A container created before the change:** keeps its old log config until it is recreated. D8 checks it and forces a recreate when needed.
- **A new service later** (E8a `ops` profile, E2b sim stack): the CI check fails until it has the block (D5, D7). A new Compose file must be added to the default list of the script; the stage writes this in a comment at the top of the script and in § Logs.
- **Two runs at once, crash and repeat, tenants, clocks:** not relevant: no DB, no job, no state.
- **Secrets:** D6.

## Facts checked

- **F1** Docker `json-file` has no size limit by default; `local` driver defaults to 5 × 20 MB with compression (docs.docker.com logging driver pages; E8 notes §3, 2026-11-13). The VPS runs Docker 28.5.1 with `json-file` and no `/etc/docker/daemon.json` (read-only VPS look, 2026-11-13, `notes/2026-11-13-operations-facts.md`).
- **F2** Probe 2026-11-14, local Docker Compose 5.6.1, temp folder: an `x-logging: &logging` anchor with `logging: *logging` resolves in `docker compose config --format json` to `{"driver":"json-file","options":{"max-file":"5","max-size":"10m"}}`. An unquoted `max-file: 5` also comes out as the string `"5"`; the plan quotes it anyway.
- **F3** Probe 2026-11-14, copies of the real `deploy/compose.yaml` and `deploy/compose.dev.yaml` with the block added: `docker compose -f deploy/compose.yaml -f deploy/compose.dev.yaml --profile '*' config --no-env-resolution --no-interpolate --format json | jq -e '[.services[] | .logging == {"driver":"json-file","options":{"max-size":"10m","max-file":"5"}}] | all'` prints `true`, exit 0, with no `.env` file and no `POSTGRES_PASSWORD` set. With the `greenmail` block removed it prints `false`, exit 1. Without `--no-env-resolution` the command fails on the missing `../.env`. `--profile '*'` lists a service that has `profiles: [ops]`; without it that service is missing.
- **F4** Compose recreates a container when its config hash changes. The hash is the JSON of the whole service config minus `build`, `pull_policy`, `scale`, `deploy.replicas`, `depends_on` and `profiles`, so `logging` counts (docker/compose v2.40.0 `pkg/compose/hash.go`, `ServiceHash`, read 2026-11-14).
- **F5** CI runner `ubuntu-latest` (Ubuntu 24.04) has Docker Compose 2.38.2 and jq 1.7.1 (actions/runner-images `images/ubuntu/Ubuntu2404-Readme.md`, read 2026-11-14). Compose 2.38.2 `config` has `--format`, `--no-env-resolution` and `--no-interpolate` (docker/compose v2.38.2 `docs/reference/compose_config.md`). compose-go handles the profile name `*` as "all profiles" (compose-spec/compose-go v2.6.0 `types/project.go`).
- **F6** The pre-commit hook runs `lint-staged`: `prettier --write` on staged `*.md` and `*.json`, `eslint --fix` + prettier on `*.ts`. YAML and shell files are not formatted (`package.json` § lint-staged).

## Not verified

- **N1** `--profile '*'` on Compose 2.38.2 at run time (F5 is from source and docs, not a run). Checked by: the first `master` CI run after the land (`gh run list --branch master --workflow CI --limit 3`). On a failure: the coordinator reverts the CI step or fixes it the same day (`CLAUDE.md`: CI on `master` stays green).
- **N2** The recreate on the VPS (F4 is from source; the VPS Compose version is not known). Checked by: the § Update step of D8 at the next VPS deploy.
- **N3** Local Docker daemon behaviour (no access to the Docker socket in the planning job). Not needed: the check uses only `docker compose config`, which needs no daemon (F3 ran without it).

## Done when

1. Every service of `deploy/compose.yaml` and `deploy/compose.dev.yaml` has `logging` `json-file`, `max-size: 10m`, `max-file: "5"`. Shown by: `bash deploy/check-logging.sh` exits 0 and prints `logging ok: db greenmail server`.
2. The check fails on a missing or different block, also in a profile service. Shown by: stage tests 2–4, each exit 1 with only the bad service named.
3. The check prints no secret. Shown by: stage test 5.
4. CI runs the check. Shown by: the `image` job step in `.github/workflows/ci.yml`, and the first green `master` CI run after the land (N1).
5. The runbook has the VPS check and the retention paragraph. Shown by: `deploy/README.md` § Update and § Logs (D8, D10).
6. After the land: the next VPS deploy shows `json-file 10m 5` for `db` and `server` (D8). The coordinator records the lines in § Log. This item does not keep the ticket open (P2).

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

Run it after the last commit, with nothing after it. The stage tests 2–5 save their output to `/tmp/f096-s01/cases.log` before the Proof.

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
4. Land with `limen land` (one stage: the land closes the ticket). Drop the job DB after the land.
5. After the land: `gh run list --branch master --workflow CI --limit 3` must show the run green (N1).
6. At the next VPS deploy (any ticket): run the new § Update step; write the lines into § Log of this file in the next board commit (Done when 6, N2).

## Planning progress

- [x] ticket.md
- [x] plan.md
- [x] stages/stage-01-compose-rotation.md [written]
- [ ] cold review (`plan-review-1.md`)

## Cold review

Not run yet.

## Log

- 2026-11-13 / 2026-11-14: planned by a Limen planner job (Opus 5.5). The run stopped once on the quota limit and continued.
