# F108 plan refresh 2

Old base: `f21809c4` (2026-11-19 22:42). New base: `e5c44676` (HEAD, 2026-11-20 16:14). No scouts (refresh job).

## Drift (`scripts/plan-drift.sh <folder> f21809c4`)

```
named paths: 19; changed since base: 16; gone: 0
changed: apps/server/src/deploy-logging.test.ts, deploy/backup.sh, deploy/check-logging.sh,
  deploy/check-server-env.sh, deploy/compose-lib.sh, deploy/compose.yaml, deploy/db.env.example,
  deploy/env-split.sh, deploy/README.md, deploy/release-lib.sh, deploy/release.sh, deploy/restore.sh,
  deploy/rollback.sh, deploy/test/backup.test.ts, deploy/test/restore.test.ts, scripts/limen-prepare.sh
commits: F108 stage 01 (9b20abc3 … 22a5e64d), stage 02 (2524f1ad, hardening 07664233), stage 03 (c28262c6),
  F139 stage 01 (38180f55, restore db-ready wait), restore test flake fix (cdab828d),
  check:job rule (02a6507b), F129 CLI standard (several), F136/limen-prepare, F141 stage 05 (879a1bc3), F121 docs (4d137c0c).
```

## State at the new base

- Landed on master: stages 01, 02 (with hardening), 03. Not built: stage 05. Proof: `deploy/compose.yaml` `server.environment` still holds `MIGRATOR_DATABASE_URL`; `deploy/release.sh` has no `check-server-env.sh` call; no "F108 stage 05" commit on any branch. The job task said stage 05 landed; the code shows it did not.
- Tag `v0.4.2` = `34374ba0` (2026-11-20 04:50) holds stages 01–03, the stage 02 hardening and the F139 wait; not stage 05. Its `deploy/release.sh` migrates through `migrate`.
- VPS: `v0.4.1` (queue note § Release v0.4.1). No release record for `v0.4.2` yet. `v0.4.1` has the push sender (`651bcc11`) and no `deploy/compose-lib.sh`; its `release.sh` migrates through `cli`.
- `v0.4.2` removes the per-role LLM keys (one-provider LLM config, F141): a removed key with a value stops the start. README § LLM provider tiers → Update (F141 owner step O1) must run on the VPS before the deploy.
- Owner rule 2026-11-20 (`02a6507b`): a job ends with `bun run check:job`; no `test:unit:ci` / `test:int:ci` chain.

## Changes

- `plan.md`: status line (base, what landed, next stage 04); D4 names N = `v0.4.2` (tagged, holds 01–03); § Proof is `bun run check:job` (owner rule); How to run steps 1–2 (01–03 done; stage 04 deploys the existing tag after F141 O1); word counts; log.
- Stage 04: N = `v0.4.2`, no new release commit or tag; Needs line names the tag and the F141 O1 record; step 1 checks the tag has no stage 05, CI green, LLM keys removed, and skips the deploy when another run already deployed `v0.4.2`; rollback target `v0.4.1` (no push-row steps); step 4 names the hardening refusals (`export`, indent, a key twice); step 11 records `env split ok`. Trimmed to 698 words.
- Stage 05: F139 is done (step `db-ready` in `restore.sh`); test 6 also covers `check-server-env.sh` exit 2 (empty env, from the hardening); Done when and Proof use `check:job`. D4 gate kept: spawn only after the stage 04 `env split ok` record.
- Stage 06: N = `v0.4.2` in step 2.
- `interfaces.md`: env-split refusals and mode keep from the hardening; `check-server-env.sh` exit 2 text; the release train line (`v0.4.2` → stage 04, `v0.4.3` first with stage 05).

## Checked, no change needed

- `compose-lib.sh`: `EA_D5_KEYS`, `ea_compose_init`, `ea_env_split_state` match `interfaces.md`.
- `env-split.sh` outputs `env split ok moved=<n>`, `env split: already split`, `env split undone moved=<n>`, `env split refused: …`; `check-server-env.sh` `server env ok keys=<n>` / `server env bad: …`; `rollback.sh` refusal for a target without `compose-lib.sh`.
- README § Env split steps and the `C=` line match stage 04; § 48-hour cron line uses `deploy/db.env`.
- No stage file of another ticket uses `C=… --env-file .env` (one match in an F125 audit table, not a command).
- Stages 01–03, 07: no change. Stage 07 still cites the F139 drill rerun, which has no record yet.

## Cold review

Not run. No interface, schema, step or stage order changed. The changes name the existing tag, the landed state, an extra pre-check (F141 O1) that the release itself already requires, and the owner's check:job rule.
