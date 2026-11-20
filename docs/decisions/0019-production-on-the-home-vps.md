# 0019 — Production stays on the home VPS behind Tailscale

- Status: accepted (F108 stage 03, 2026-11-20). Reserved by the S6 plan; built by F108.
- Date: 2026-11-20

## Context

The system runs on the home VPS of the owner. One operator uses it. The organizations on it are test organizations; no outside user's mail is on it (PD-001). The panel is open to tailnet members only (ADR 0017).

The first plan for S6 put production on a hosted server with a public domain and an image registry (commit `9cdada6` holds that plan). The owner dropped it on 2026-11-12 (S6 plan, P22: "No Hetzner, domain, Caddy, image registry, pilot move or staging"). The decisions of the F108 plan are `spec/features/active/F108-e7-t5-production-on-the-vps/plan.md` (D1 to D5, D28, D30) and `interfaces.md`.

## Decision

1. **Production stays on the home VPS behind Tailscale.** No public domain, no hosted server, no image registry. The server image is built on the VPS from the tag of the release (`deploy/release.sh`). The vision rule stays: an EU location is a condition before any outside user's mail comes on the system.
2. **The server holds only the keys it needs.** The three database passwords (`POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`) live in `deploy/db.env` (mode 600, not in git). Docker Compose reads that file for interpolation (`--env-file deploy/db.env`). The `server` and `cli` services get no `env_file` with these keys: Compose sets `DATABASE_URL` for them from `APP_PASSWORD`. `.env` holds every other key and, after the split, no database password and no `MIGRATOR_DATABASE_URL`. `deploy/env-split.sh` moves the keys of an old host; `deploy/check-server-env.sh` proves that the running server has none of them.
3. **Migrations run in the one-off service `migrate`.** It is the only service that gets the migrator URL. `release.sh` and `restore.sh` call `run --rm -T migrate`. The server and `cli` never hold the migrator key.
4. **A release that removes a key from `server` has two steps: expand, then contract.** Release N carries the `migrate` service and still works with the old env file. The operator then splits the env file. The next release stops `server` and `cli` from reading the admin keys. A rollback to a release that is older than the split helper needs `deploy/env-split.sh --undo` first (`rollback.sh` refuses and says so).
5. **No secret copy on the host.** The operator never leaves a copy of `.env` (no `.env.bak-*`). The old value of a key stays in the password manager.
6. **A move to a hosted server needs three things:** a hosted server in the EU; `deploy/restore.sh --target new-host` to bring the database (the backup holds the database only, so the password manager also holds `CREDENTIALS_KEY`); and a new ADR for public access that changes ADR 0017 (domain, proxy, hardening of the web). A new Compose host takes the same env layout.

## Consequences

- Good: a leaked server env does not hold the superuser or migrator password. There is no registry or domain to run. The restore drill covers the move.
- Bad: one host is one point of failure. Availability depends on the home network and the power of the owner. The nightly backup (RPO 24 h) and the restore (RTO 2 h) are the recovery path (`docs/capabilities/backups.md`).
- Bad: the operator keeps two env files on the host. Every Compose command needs the `--env-file deploy/db.env` of the `C=` line in `deploy/README.md`; `deploy/compose-lib.sh` builds it for the scripts.
- A host that was not split yet works with its old single env file until `deploy/env-split.sh` runs.
