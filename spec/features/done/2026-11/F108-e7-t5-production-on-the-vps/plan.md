# F108 · Production on the VPS: plan

> **Status — stages 01–03 landed; tag `v0.4.2` holds them, VPS at `v0.4.1`; next: stage 04.** Plan base: e5c44676, refreshed 2026-11-20 ([refresh 1](plan-refresh-1.md), [refresh 2](plan-refresh-2.md)). Sources: epic `E07-platform-and-trust.md` (S6f, decision 14), `E07-discovery-notes.md` §9, §11; `tasks/planned/s6f-hosted-production.md`; `tasks/active/s6-pre-sale.md` (P22, P23, D25, D30, D31). [scouts.md](scouts.md), [questions.md](questions.md), [interfaces.md](interfaces.md).

## Input

Owner (S6 plan, 2026-11-12): "**P22** S6f becomes "Production on the home VPS": fix the two CI timing tests, the env split …, verify the Backblaze upload and run a restore test, ADR 0019. No Hetzner, domain, Caddy, image registry, pilot move or staging." "**P23** Backblaze: the agent checks `deploy/backup.sh` and the last upload on the VPS (read only, with the user's go)." Epic decision 14: the restore test is the E8 drill. Owner 2026-11-13: VPS deploys are pre-approved.

### Product (not re-opened)

- **P1** Production stays on the home VPS behind Tailscale; ADR 0019 records it.
- **P2** D25: the server gets only its keys; migrations run in a one-off service.
- **P3** D30: no `.env.bak-*` copy stays on the VPS.
- **P4** D31 failed-backup notice = F114 `slo_backup_age`; F108 checks it.
- **P5** Restore test = F114 stage 09 drill. F108 cites its result.

### Design

- **D1 Where the admin keys live.** `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD` move from the VPS `.env` to a new host file `deploy/db.env` (mode 600, git-ignored, example `deploy/db.env.example`). It is the Compose interpolation file; `.env` stays the server's `env_file`. Rejected: an allow-list of about 80 keys (drifts; empty is not unset).
- **D2 One compose command.** A sourced helper builds the Compose file arguments of every deploy script: `--env-file deploy/db.env` when that file exists, else `--env-file .env` (old layout, local dev). Neither → refuse. Rejected: a path in each script (six copies today).
- **D3 Service `migrate`** (shape in interfaces.md): server image, `bun run db:migrate`, no `env_file`, only the migrator URL. `release.sh` and `restore.sh` use it. The drill override gives it the drill image, log, restart and ports, not the drill env anchor; `check-logging.sh` allows it in the drill set.
- **D4 Expand, then contract** (the migration rule, for Compose). Release N (`v0.4.2`, tagged) holds stages 01–03 (`migrate` exists; the server keeps its migrator URL). The coordinator deploys N and splits the VPS env (stage 04) before stage 05 (contract) is spawned. After that, any release that holds stage 05 is safe, also one of another ticket. Reason: the old `release.sh` runs the next release from memory and migrates through `cli`. Rejected: one release (that step fails); a tag on an older commit (`release.sh` needs a new version commit).
- **D5 Forbidden keys** in `server` and `cli`: `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`, `MIGRATOR_DATABASE_URL`. `DATABASE_URL` (role `app`) stays.
- **D6 Split tool** `deploy/env-split.sh` moves the D5 lines (the three passwords, required; `MIGRATOR_DATABASE_URL` when present, as `.env.example` has it) to `deploy/db.env`. Lossless (no backup copy, D30); temp file + rename; key names only in output. A second run finishes a half-done split (equal lines in both files). `--undo` moves them back.
- **D7 Key-name check** `deploy/check-server-env.sh`: key names of `exec -T server env` against D5. From stage 05, `release.sh` verify runs it; `rollback.sh` does not (release N still has the migrator URL).
- **D8 Guards.** Stage 05: `release.sh`, `rollback.sh` and `restore.sh --target new-host` refuse (exit 2, nothing changed) unless the state is `split` (db.env exists, `.env` holds no D5 key). Stage 01: `rollback.sh` refuses a target commit without `deploy/compose-lib.sh` while `deploy/db.env` exists (that code reads only `.env`; run `--undo` first).
- **D9 Scope limits.** Local dev, the sim stack and the drill keep their env files (no production data; drill passwords are random, `--down` removes them). Q3, Q4.
- **D10 Bucket check** with the read key on the owner's machine (README: "the Mac"; the VPS key is write-only): a read remote on this PC if one exists; else the evidence is `backup ok`, the status file and the drill, and the listing is owner step O1. Q7.
- **D11 Lifecycle:** `rclone backend lifecycle` from the PC; refused → "not read". Q8.
- **D12 `.env.bak-*`** (VPS home, repo root, `deploy/`): delete a copy only when each of its lines has an equal line in `.env` ∪ `deploy/db.env` (compared in the script, never printed); else keep it and list the differing key names for the owner (an old `CREDENTIALS_KEY` may still matter). Q6.
- **D13 Second-org run:** org `F108 smoke <date>`, user `f108-smoke-<yyyymmdd>@x.test`; never a write on the pilot org; ends with `org:delete`. Mailbox connect and Telegram "paused" need O2: default skip, not verified. Q9.

A decision gap is a question in the final message.

## Facts checked (c68ce51e, 2026-11-19)

Scouts 1–4; review 1 reproductions. Planner read: `server` has `env_file: ../.env` + `MIGRATOR_DATABASE_URL`, `cli` extends it; Compose interpolates only the three passwords and `EA_RELEASE`; `release.sh` migrates through `cli`; `rollback.sh` checks out the target commit with the `COMPOSE_CMD` it started with; `check-logging.sh --drill` allows only `db`, `server`, `cli`; `.env.example` puts `MIGRATOR_DATABASE_URL` in `.env`; no runtime code or VPS CLI reads a D5 key (only dev scripts); ADR 0019 is "reserved"; F093 fixed the timing tests.

## Not verified

- V1 `rclone backend lifecycle` with a read key (stage 06). V2 a read remote on this PC (stage 06, `rclone listremotes`). V3 the VPS `.env` key names, the crontab lines that call Compose, and which `.env.bak-*` exist (stage 04, names only).
- V4 the new `restore.sh` path on a host: the F114 drill ran at `v0.3.1` (no stage 01); the F139 rerun on release N proves it (stage 07).

## Done when

1. Compose config: `server`, `cli` have no D5 key; `migrate` only D3 keys (01, 05).
2. Split tool, check script, guards pass their tests (02, 05).
3. ADR 0019 accepted; `docs/architecture.md` §10 and `deploy/README.md` match (03).
4. VPS: release N migrated through `migrate`; state `split`; no crontab line uses `--env-file .env` (04).
5. VPS: `check-server-env.sh` → `server env ok` after the first release with stage 05 (06).
6. VPS: last `backup ok` line, status `ok`, cron line present; bucket listing or Q7 default logged; no `.env.bak-*` or each kept one listed for the owner (06).
7. Second-org run and pilot checks; CI green on `master`; drill result cited; S6 closed (07).

## Rules for every stage

- Read `CLAUDE.md`, the styleguide, `docs/code-patterns.md`, this file, [interfaces.md](interfaces.md), your stage. Format only your files.
- Shell: `set -euo pipefail`; tests in `deploy/test/` (`bun test`, in `test:unit`) with stub commands on `PATH`; `docker compose config` tests as `deploy/test/compose-*.test.ts` do. No real Docker daemon, no VPS.
- Never print a secret: tests plant sentinel values and assert their absence in output.
- No migration, no `bun.lock` change. Explicit-path commits.

## Proof

`bun run check:job` as the last step (owner rule 2026-11-20: merge master, lint, typecheck, the tests of the changed files). The final message copies its last line `check:job PASS master=… tip=…`.

## Owner checkpoints and steps

Not a stop; defaults in [questions.md](questions.md).
- O1 (optional, stage 06): a read remote for the bucket on the PC.
- O2 (optional, stage 07): a test mailbox and a second Telegram account.

## Review

Opus 5.5 before land: 01, 02, 03, 05 (all touch deploy or secrets; `spec/build.md`). 04, 06, 07: coordinator evidence in `notes/2026-11-15-vps-deploy-queue.md`.

## Stages

1. [01 migrate service and compose helper](stages/stage-01-migrate-service.md) [risky]
2. [02 split tool and server env check](stages/stage-02-split-tool.md)
3. [03 ADR 0019 and runbooks](stages/stage-03-adr-docs.md)
4. [04 VPS: release N and the split](stages/stage-04-vps-expand-split.md) [risky] coordinator
5. [05 contract: server without admin keys](stages/stage-05-contract.md) [risky]
6. [06 VPS: contract release, backup checks, no secret copies](stages/stage-06-vps-contract-backups.md) [risky] coordinator
7. [07 final checkpoint](stages/stage-07-final-checkpoint.md) coordinator

## How to run (coordinator)

1. Done: 01, 02, 03 landed. Worker stage 05 spawns with: `limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge --prepare 'bash scripts/limen-prepare.sh' --label "F108-sNN <slug> · F108" "Implement F108 stage NN (spec/features/active/F108-e7-t5-production-on-the-vps/: ticket.md, plan.md, interfaces.md, stages/stage-NN-<slug>.md). End with bun run check:job; copy its last line."`
2. Stage 04 now: deploy the `v0.4.2` tag (after the LLM key cleanup, F141 O1) and the split. Stage 05 is spawned only after stage 04 recorded `env split ok` (D4).
3. Stage 06 after the first release that holds stage 05; then 07. Drop each job DB after its land. Each stage's `Needs` line names its real input.

## Planning progress

- Scouts: 4, done. Stages 01–07 [written]. Words: § Cold review.

## Cold review

`claude-opus-5-5`, thinking high (`[risky]` stages: deploy path, secrets, VPS). [Review 1](plan-review-1.md): FAIL, 2 blocking, 14 notes; all fixed, none rejected. B1 → D4, stage 04. B2 → D5, D6, tests. N2 stage 01; N3 D4; N4, N5, N10 stage 03, 04; N6 D8; N7 D6; N8 V4; N9 D12; N12 seven stages.
Words: stages 01–07: 694, 565, 694, 698, 687, 678, 624 (refresh 2; plan.md 1473).

## Log

- 2026-11-19 written at c68ce51e; review 1 fixed. Refreshed at f21809c4: [plan-refresh-1.md](plan-refresh-1.md).
- 2026-11-20 refreshed at e5c44676 after stages 01–03 and the `v0.4.2` tag: [plan-refresh-2.md](plan-refresh-2.md).
