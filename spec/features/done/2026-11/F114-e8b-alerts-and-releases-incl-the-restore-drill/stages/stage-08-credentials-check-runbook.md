# F114 stage 08 — `credentials:check` and the VPS-lost runbook

Part of [`../plan.md`](../plan.md). Decisions P6, D16, D17, D20. Needs stage 07 (the runbook names `restore.sh`). Sonnet review.

## Step 1 — `bun run credentials:check`

- **Goal:** the drill and a new host prove that the configured `CREDENTIALS_KEY` opens every stored mailbox secret.
- **Files:** a script in `apps/server/src/scripts/` with `createCliOutput`, a `package.json` entry; the read goes in the module that owns each secret table (`mail`).
- **Interface:** `countDecryptableCredentials(db, key): Promise<{ ok: number; failed: number }>` — cross-org (no `TenantContext`), added to the `docs/code-patterns.md` exceptions (review 1 N14).
- **Decisions:** covers every table that holds an encrypted mailbox secret at your base (the IMAP/SMTP password and any OAuth token store). Prints one line `credentials ok=<n> failed=<m>`; exit 0, or 1 on a DB error. No secret, address, id or error text in the output. A decrypt error counts as `failed`, never throws out.
- **Test** (integration):
  1. Two password rows, one encrypted with another key → `ok=1 failed=1`.
  2. No rows → `ok=0 failed=0`, exit 0.
  3. The output of test 1 holds no part of either secret and no mailbox id.
  4. With an OAuth token row (if the table exists at your base) encrypted with the right key → it counts in `ok`.

## Step 2 — Runbook `deploy/README.md` § VPS lost

- **New host:** Ubuntu, Docker with Compose, git, Tailscale; clone; `.env` keys from the owner's password manager (key names only, never values: `CREDENTIALS_KEY`, `CREDENTIALS_KEY_VERSION`, the Telegram token, `OPERATOR_TELEGRAM_CHAT_ID`, `HEARTBEAT_URL`, LLM keys, web keys; new DB passwords).
- **Data:** the latest backup from B2 with the read key on the owner's machine; on the owner's machine `age -d -i <identity> <file> | ssh <host> 'cd <repo> && deploy/restore.sh --target new-host --stdin'`.
- **After:** `backup.env`, the cron line, Tailscale serve, the Healthchecks checks (heartbeat and backup), then the first `deploy/release.sh <tag>` so the release state exists.
- **Targets:** RPO 24 h, RTO 2 h. The measured time comes in stage 09.
- **Drill:** a sub-section with the stage 09 Part C steps as the twice-a-year drill (VPS, project `ea-drill`).

## Step 3 — Capability pages

- `docs/capabilities/backups.md`: rules for the status file (stage 04, if not yet), the restore path and the drill; Limits updated.
- `docs/capabilities/operations.md` § Restore: entry points `restore.sh`, `compose.drill.yaml`, `credentials:check`; the empty-target guard; the drill safety list (D18).

## Done when

Tests 1–4 pass; the README section exists; the Proof of `plan.md` prints `PROOF_OK`. Out of scope: running the drill (09).
