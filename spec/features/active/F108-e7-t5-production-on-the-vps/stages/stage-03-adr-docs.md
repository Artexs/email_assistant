# F108 stage 03 — ADR 0019 and the runbooks

Needs stage 01: the `migrate` service and `deploy/compose-lib.sh` (the runbooks call them). The stage 02 names (`env-split.sh`, `check-server-env.sh`, `db.env.example`) come from [`../interfaces.md`](../interfaces.md). May run next to 02 (no shared file). A worker job.

Part of [`../plan.md`](../plan.md). The coordinator follows these runbooks in stages 04 and 06, so they must be exact.

## Carry-over reads

`deploy/README.md` (§ First install, § Release, § Roll back a release, § Phone notices and Telegram detail → Make the keys step 2 and Roll back step 3, § Web panel steps, all of which teach `.env.bak-*` copies; § 48-hour test procedure cron line; § Backups; § VPS lost / New host and § Drill, which now hold the first drill record), `docs/architecture.md` §10, `docs/decisions/README.md`, `docs/decisions/0017-web-access-tailscale-serve.md`, `docs/capabilities/operations.md` and `backups.md`, `docs/release-checklist.md`, `.env.example`; [`../interfaces.md`](../interfaces.md) (the names the docs must use).

## Step 3.1 — ADR 0019

**Goal.** The production decision is written down (P1, P22, D28).

**Files.** New `docs/decisions/0019-production-on-the-home-vps.md` (status accepted, date of the land); `docs/decisions/README.md` row 0019.

**Decisions.** The ADR holds: production stays on the home VPS behind Tailscale (P1); why no public domain, hosted server or image registry (one operator, test organizations only, no outside user's mail; vision: EU location before any outside user's mail); the env layout (D1, D5) and the `migrate` service (D3); the expand/contract release order (D4); what a move needs (a hosted EU server, `restore.sh --target new-host`, a public-access ADR that changes ADR 0017; the old hosted plan is commit `9cdada6`).

## Step 3.2 — Runbooks

**Goal.** Every operator command in the docs works on a split host, and nothing teaches a secret copy (D2, D6, D30).

**Files.** `deploy/README.md`, `docs/architecture.md` §10, `docs/capabilities/operations.md`, `.env.example` (comment on the three password keys and `MIGRATOR_DATABASE_URL`: dev only; on the VPS they live in `deploy/db.env`), `docs/release-checklist.md` if it names a migrate command.

**Decisions.**
- The `C=` line: `--env-file deploy/db.env`, with one line that says the old form is for a host that was not split yet.
- § First install and § New host: make `deploy/db.env` from the example (mode 600) with the three passwords; `.env` gets no D5 key; delete the `MIGRATOR_DATABASE_URL` and `DATABASE_URL` lines from the copied `.env` (Compose sets both).
- New § Env split (for an existing host): the order is `deploy/backup.sh` (the database backup; never a copy of `.env`), `deploy/env-split.sh`, check `ea_env_split_state` = `split`, `$C config --quiet`; after the first release with the contract, `deploy/check-server-env.sh`. A rollback to a release older than the split helper: `deploy/env-split.sh --undo` first (`rollback.sh` says so).
- Keep the first drill record in § VPS lost as it is (F114 wrote it; F139 owns its `guard-empty` line). § New host step 3: the three passwords go to `deploy/db.env`, not `.env`. § Drill: `--init-env <live repo>/.env` stays (it reads only `CREDENTIALS_KEY` and `CREDENTIALS_KEY_VERSION`, which stay in `.env`).
- Replace each instruction that makes a `.env.bak-*` copy (§ Phone notices `.env.bak-vapid`; § Web panel `.env.bak-s5e`, `.env.bak-f069`) and each step that restores one (§ Phone notices Roll back step 3 becomes "delete the three `VAPID_*` lines") with: "keep the old value in the password manager; never leave a copy of `.env` on the host" (D30).
- Every cron line and one-off example uses `$C` or the new `C=` form (the § 48-hour test `mailbox:seed` cron line too); every `run --rm cli bun run db:migrate` becomes `run --rm migrate`.

**Test.**
1. `bash deploy/check-logging.sh` passes (it also checks that no document runs a one-off in `server`).
2. The repo's docs checks pass: `bun run docs:stale --strict` and the link check, if the repo has one.
3. No file in `deploy/` or `docs/` (outside `docs/decisions/` history and `notes/`) still holds `--env-file .env` except the line that names the old form; this grep must find only that line.
4. No `cp … .env.bak` and no `.env.bak-` name stays in `deploy/README.md`; this grep must find nothing.

**Done when.** Tests 1–4 pass; ADR 0019 is listed as accepted; the Proof chain ends with `PROOF_OK`.

**Out of scope.** Script changes (stages 01, 02, 05); other tickets' stage files (the coordinator handles them, `interfaces.md` § Seams).

## Proof

The chain of [`../plan.md`](../plan.md) § Proof with `sNN` = `s03`; it ends with `PROOF_OK`.
