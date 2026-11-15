# F113 stage 03 — sim stack files `[risky]`

Part of [`../plan.md`](../plan.md). Decisions D1, D2, D3, D4. Risk area: deploy and the VPS (a second stack next to production).

## Goal

The files that start the `ea-sim` stack: a Compose file, a sim image and an env example. Nothing in them can reach the production stack, the production bot or a real mail host. CI checks the file.

## Files

New: `deploy/compose.sim.yaml`, `deploy/Dockerfile.sim`, `deploy/sim.env.example`. Changed: `deploy/check-logging.sh` (also checks the sim file, on its own, not merged with the production pair), its CI job, `.gitignore` (`deploy/sim.env`), `package.json` scripts `sim:up`, `sim:down`, `sim:ps`.

## Interfaces

- Compose project name `ea-sim`. Services `db`, `greenmail`, `fake-telegram`, `server`, `lab`.
- `lab` runs `bun run lab serve` (stage 10 builds it; until then the command exits 1 with "not built").
- State volume mounted at `/var/lib/ea-lab`, env `LAB_STATE_DIR=/var/lib/ea-lab`.
- `bun run sim:up` = `docker compose -p ea-sim -f deploy/compose.sim.yaml --env-file deploy/sim.env up -d --wait`. `sim:down` never passes `-v`.

## Decisions

- **Network.** `fake-telegram` owns the network namespace on network `ea-sim` (subnet `172.31.0.0/24`; production uses `172.30.0.0/24`). `server` and `lab` use `network_mode: service:fake-telegram`. All three reach each other on `127.0.0.1`. `db` and `greenmail` are reached by service name.
- **Ports.** Only `fake-telegram` publishes a port: `127.0.0.1:8180:8080` (the server's panel). No port on `0.0.0.0` (ADR 0017). GreenMail, DB and the fake's 8090 publish nothing.
- **Image.** `Dockerfile.sim` starts `FROM ${EA_SERVER_IMAGE}` (default `ea-server:latest`) and copies `tools/fake-telegram/src` and `evals/sim`. The production `Dockerfile` does not change.
- **Env.** `server` and `lab` read only `env_file: sim.env` (relative to `deploy/`); never `../.env`. `DATABASE_URL` and `MIGRATOR_DATABASE_URL` point at `db`.
- **GreenMail.** `greenmail/standalone:2.1.15` with the dev options (`setup.test.all`, `hostname=0.0.0.0`, `auth.disabled`), Java heap 256 MB.
- **Limits.** `mem_limit`: server 512m, db 256m, greenmail 384m, fake-telegram 128m, lab 256m. Each service has the `json-file` log rotation of `check-logging.sh` (10m, 5 files). `restart: unless-stopped` on all.
- **Env example.** `sim.env.example` sets every value that `checkSimEnv` (stage 02) requires, `SEND_TEST_ADDRESSES` with every lab-01 address, `WEB_BASE_URL=https://<host>:8443` as a placeholder, `WEB_TRUSTED_PROXIES=172.31.0.1`, empty LLM key names, and the production send-limit defaults (PD-068 checks real limits). Placeholders say how to make `CREDENTIALS_KEY`, `WEB_AUTH_SECRET` and the DB passwords; no real secret.
- **Restart order** (for the runbook, stage 15): a new `fake-telegram` container drops the namespace, so `server` and `lab` restart after it.

## Tests

1. `docker compose -p ea-sim -f deploy/compose.sim.yaml --env-file deploy/sim.env.example config --quiet` exits 0 (no daemon needed, plan F4).
2. `bash deploy/check-logging.sh` passes with the new file, and fails when you remove the logging block of one sim service (check, then restore).
3. A new check (in `check-logging.sh` or a sibling script that CI runs; it never prints the config) fails when:
   - a sim service has no `mem_limit`;
   - a port binds without `127.0.0.1`;
   - `server` or `lab` has an `env_file` other than `sim.env`;
   - `server` or `lab` is not `network_mode: service:fake-telegram`.
   Prove each by a temp copy of the file in `/tmp/f113-s03/`.
4. A unit test: `checkSimEnv` on the parsed `sim.env.example` (a plain `KEY=value` reader in the test) with the lab-01 addresses gives `[]`.

## Check

Tests 1–3 by hand with logs in `/tmp/f113-s03/`; test 4 in the Proof.

## Done when

The CI job that runs `check-logging.sh` also runs the sim checks. The Proof prints `PROOF_OK`. The final message lists each guard of test 3 and the temp file that made it fail.

## Out of scope

Starting the stack (agents have no Docker socket; coordinator step C1). The VPS. Tailscale.
