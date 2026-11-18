# F108 · Production on the VPS: plan

> **Status 2026-11-19 — planned, nothing built.** Plan base: c68ce51e. Sources: epic `E07-platform-and-trust.md` (S6f, §Discovery decision 14), `E07-discovery-notes.md` §9 and §11 row T5, `tasks/planned/s6f-hosted-production.md`, S6 master plan `tasks/active/s6-pre-sale.md` (P22, P23, D25, D28, D30, D31). [scouts.md](scouts.md), [questions.md](questions.md), [interfaces.md](interfaces.md).

## Input

Owner (S6 master plan, 2026-11-12): "**P22** S6f becomes "Production on the home VPS": fix the two CI timing tests, the env split …, verify the Backblaze upload and run a restore test, ADR 0019. No Hetzner, domain, Caddy, image registry, pilot move or staging." "**P23** Backblaze: the agent checks `deploy/backup.sh` and the last upload on the VPS (read only, with the user's go)." Epic decision 14: the restore test is the one E8 drill. Owner 2026-11-13: VPS deploys are pre-approved (backup first, rollback target, verify after).

### Product (not re-opened)

- **P1** Production stays on the home VPS behind Tailscale (ADR 0017 unchanged); ADR 0019 records it.
- **P2** D25: the long-running server gets only its keys; migrations run in a one-off service with the migrator URL.
- **P3** D30: no `.env.bak-*` copy stays on the VPS.
- **P4** D31 failed-backup notice = F114 `slo_backup_age` (E08 page): F108 builds nothing for it, it only checks it on the VPS.
- **P5** Restore test = F114 stage 09 drill. F108 cites its result.

### Design

- **D1 Where the admin keys live.** `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD` move from the VPS `.env` to a new host file `deploy/db.env` (mode 600, git-ignored, example `deploy/db.env.example`). It is the Compose interpolation file (`--env-file deploy/db.env`); `.env` stays the server's `env_file`. Rejected: an allow-list of server keys in `environment:` (about 80 keys that drift; an empty value is not an unset key); a second full env file for the server (moves 80 keys, not 3).
- **D2 One compose command.** A sourced helper builds the Compose argument list for every deploy script: `--env-file deploy/db.env` when that file exists, else `--env-file .env` (the old layout and local dev). Neither file → refuse. Rejected: a fixed path in each script (six copies today).
- **D3 Service `migrate`.** Runs `bun run db:migrate` on the server image; no `env_file`; environment only `MIGRATOR_DATABASE_URL` (interpolated) and `LOG_FORMAT: text`; profile `cli`; `restart: "no"`; no port. `release.sh` and `restore.sh` use it. The drill override gives it the drill image block (else the drill would run the live image).
- **D4 Expand, then contract** (the repo's migration rule, applied to Compose). Stage 01 + 02 ship in release N: `migrate` exists, the server keeps its migrator URL. The operator splits the env. Stage 03 ships in release N+1: `server` and `cli` lose `MIGRATOR_DATABASE_URL`. Reason: the old `release.sh` runs the next release and still calls `cli` for the migrate step until N is live. Rejected: one release (the old script's migrate step fails on the new Compose file).
- **D5 Forbidden keys** in the server and `cli` env: `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`, `MIGRATOR_DATABASE_URL`. `DATABASE_URL` (role `app`) stays: the server needs it.
- **D6 Split tool** `deploy/env-split.sh` moves the three lines; lossless by construction (no backup copy, D30); temp file + rename; prints key names only; `--undo` moves them back (needed for a rollback below release N).
- **D7 Key-name check** `deploy/check-server-env.sh`: `exec -T server env`, keeps names only in the script, compares with D5. `release.sh` runs it in verify after stage 03. `rollback.sh` does not: release N, a valid rollback target, still has the migrator URL.
- **D8 Guards after contract.** `release.sh`, `rollback.sh` and `restore.sh --target new-host` refuse (exit 2, nothing changed) when `deploy/db.env` is missing or `.env` holds a D5 password key.
- **D9 Scope limits.** Local dev keeps one `.env` (no production data). The sim stack and the drill keep their own env files: the drill uses random throwaway passwords and `--down` removes them. Q3, Q4.
- **D10 Bucket check** from the owner's PC with an existing read remote (the VPS key is write-only). No read remote → the evidence is `backup ok`, the status file and the drill; the listing stays an owner step. Q7.
- **D11 Lifecycle rule:** read with `rclone backend lifecycle` from the PC; refused → log "not read". Q8.
- **D12 `.env.bak-*`:** compare key names (never values) with the live `.env` and `deploy/db.env`; a subset → delete; else stop and list the extra names. Q6.
- **D13 Second-org run** with name `F108 smoke <date>` and `f108-smoke-<yyyymmdd>@x.test`; never touches the pilot org; ends with `org:delete`. Mailbox connect and Telegram "paused" need the owner's test mailbox and a second Telegram account: default skip, mark not verified. Q9.

A decision gap is a question in the final message, not a choice.

## Facts checked (c68ce51e, 2026-11-19)

Scouts 1–4. Planner read: `compose.yaml` (`server` `env_file: ../.env` + `MIGRATOR_DATABASE_URL`; `cli` extends `server`); Compose interpolates only the three passwords and `EA_RELEASE`; `release.sh` migrates with `run --rm -T cli bun run db:migrate`; `rollback.sh` checks out the target commit and uses the `COMPOSE_CMD` of the script it started with; `restore.sh` `set_compose` and the drill `env_file: !override`; no runtime code or VPS CLI reads the four D5 keys (only dev scripts `db-worktree`, `e2e-*`); ADR 0019 is "reserved" in `docs/decisions/README.md`; F093 fixed the timing tests (`docs/known-alerts.md`, "fixed").

## Not verified

- V1 `rclone backend lifecycle` with the PC read key (stage 04). V2 a read remote exists on the PC (stage 04, `rclone listremotes`, names only). V3 the VPS `.env` holds the three keys and which `.env.bak-*` exist (stage 04, names only).

## Done when

1. Compose config: `server`, `cli` have no D5 key; `migrate` has only D3 keys (03).
2. Split tool, check script and guards pass their tests (02, 03).
3. VPS: `check-server-env.sh` → `server env ok`; release N+1 migrated through `migrate` (04).
4. VPS: last `backup ok` line, status `ok`, cron line present; bucket listing or Q7 default logged; no `.env.bak-*` (04).
5. ADR 0019 accepted; `docs/architecture.md` §10 and `deploy/README.md` match (02).
6. Second-org run and pilot checks; CI green on `master`; drill result cited; S6 closed (05).

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, this file, [interfaces.md](interfaces.md) and your stage. `bunx prettier --write <your files>` only.
- Shell: `set -euo pipefail`; tests in `deploy/test/` (`bun test`, in `test:unit`) with stub commands on `PATH`; `docker compose config` tests as `deploy/test/compose-*.test.ts` do. No real Docker daemon, no VPS.
- Never print a secret: tests plant a sentinel value and assert it is absent from stdout and stderr.
- No migration, no `bun.lock` change. Commit by explicit path.

## Proof

```
mkdir -p /tmp/f108-sNN && bun run lint > /tmp/f108-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f108-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f108-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f108-sNN/int.log 2>&1 && echo PROOF_OK
```

## Owner checkpoints and steps

Not a stop (owner, 2026-11-13); defaults in [questions.md](questions.md).
- O1 (optional, stage 04): a read remote for the bucket on the PC, if none exists.
- O2 (optional, stage 05): a test mailbox and a second Telegram account for the second-org run.
- The F114 drill needs the owner's `age` key (`notes/owner-later.md` item 3): stage 05 waits for it.

## Review

Opus 5.5 before land: 01, 03 (`[risky]`). Sonnet 5.5: 02. Stages 04, 05: the coordinator's evidence in `notes/2026-11-15-vps-deploy-queue.md`.

## Stages

1. [01 migrate service and compose helper](stages/stage-01-migrate-service.md) [risky]
2. [02 split tool, env check, ADR 0019, docs](stages/stage-02-split-tool-adr.md)
3. [03 contract: server without admin keys](stages/stage-03-contract.md) [risky]
4. [04 VPS rollout and backup checks](stages/stage-04-vps-rollout.md) [risky] coordinator
5. [05 final checkpoint](stages/stage-05-final-checkpoint.md) coordinator

## How to run (coordinator)

1. Move the ticket to `active/` after F107 is in `done/`. Spawn 01, then 02, then 03, each after the land of the one before: `limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge --prepare 'bash scripts/limen-prepare.sh' --label "F108-sNN <slug> · F108" "Implement F108 stage NN (spec/features/active/F108-e7-t5-production-on-the-vps/: ticket.md, plan.md, interfaces.md, stages/stage-NN-<slug>.md). Run the Proof after the last commit; claim only what a saved log shows."`
2. Release N is a tag on a `master` commit that holds stages 01 and 02 and not stage 03 (D4); a tag on the land commit of stage 02 is fine, also after 03 lands.
3. Stage 04 after stage 03 lands (it tags N+1 itself); stage 05 after F114 is in `done/`. Drop each job DB after its land.

## Planning progress

- Scouts: 4, all done. Stages 01–05 [written].
- Words (`wc -w`, before review): plan.md 1394; stages 01–05: 560, 636, 627, 672, 520.

## Cold review

Model `claude-opus-5-5`, thinking high: stages 01, 03, 04 are `[risky]` (deploy path, secret scope, production VPS). Result: pending.

## Log

- 2026-11-19 plan written at c68ce51e.
