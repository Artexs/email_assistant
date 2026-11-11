# s5e-web-deploy-docs — Stage 1

Part of [`../s5e-web-deploy-docs.md`](../s5e-web-deploy-docs.md). Read that file's "Done when", "Owns", A1–A9, "Facts checked", E1–E14, "Rules for every step", "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 1 — Compose loopback port, `.env.example` server values, the runbook "Web panel" section, two alert statuses [risky]

- [ ] **1.1 Compose port and env text**
  - Goal: the server publishes its port on the host loopback only, and `.env.example` tells a server operator the value of each web key.
  - Files: change `deploy/compose.yaml`, `.env.example`.
  - Interfaces: none (no code).
  - Decisions:
    - `deploy/compose.yaml`, service `server`: add, after `environment`, the block `ports:` with one item `"127.0.0.1:8080:8080"` and the comment line above it: `# Loopback only: Tailscale Serve on the host proxies to it (ADR 0016). Never publish on 0.0.0.0.` (E1). Nothing else in the file changes (`WEB_DIST` and the healthcheck stay).
    - `.env.example`, the web block (lines 47–59 today): keep every key and its empty or dev value. Add one comment line per key that names the server value (E2), in this form (wording may be shortened, the facts may not):
      - above `WEB_BASE_URL=`: `# Server (VPS behind Tailscale Serve, ADR 0016): https://<machine>.<tailnet>.ts.net (no path, no trailing slash).`
      - above `WEB_TRUSTED_ORIGINS=`: `# Server: delete this dev value (leave the key empty). The value below is for dev only (the built shape on 8080).`
      - above `WEB_TRUSTED_PROXIES=`: `# Server: the gateway IP of the Compose network (docker network inspect email-assistant_default), one IPv4, no CIDR. Read it again after "docker compose down". Empty = no proxy is trusted.`
      - above `WEB_DIST=`: `# Server: leave empty; Compose sets it.`
      - `WEB_MAIL_ALLOW_LOCAL` already says "Keep false on a server": change it to "Server: leave empty."
    - Never put a real tailnet name in an example (difference 5).
  - Test: no unit test (config text). Check 1 below proves the port renders.
  - Check:
    1. In the worktree: `cp .env.example /tmp/ea-s5e-compose.env && for k in POSTGRES_PASSWORD MIGRATOR_PASSWORD APP_PASSWORD; do echo "$k=x" >> /tmp/ea-s5e-compose.env; done && newgrp docker <<'EOF'` then `docker compose -f deploy/compose.yaml --env-file /tmp/ea-s5e-compose.env config --format json | bun -e 'const c = JSON.parse(await Bun.stdin.text()); console.log(JSON.stringify(c.services.server.ports))'` then `EOF`. Expect `[{"mode":"ingress","host_ip":"127.0.0.1","target":8080,"published":"8080","protocol":"tcp"}]` (the exact keys may differ; `host_ip` must be `127.0.0.1`). `env_file: ../.env` must exist for `config`: if it is missing in the worktree, the check copies nothing and reports the error; the worktree has `.env` from user step 0. Then `rm /tmp/ea-s5e-compose.env`.
    2. `bun run lint && bun run typecheck && bun run test:unit` (expect unit 1719 pass, 0 fail).
  - Done when: both checks pass; `git diff --stat` shows only the two files.
  - Out of scope: any other Compose change (no network subnet, E3), the `db` service, the Dockerfile (D21 is built, difference 3).

- [ ] **1.2 Runbook "Web panel" section and alert statuses**
  - Goal: a person with only `deploy/README.md` can turn the panel on, give the owner a password, check access, find a fault and turn the panel off.
  - Files: change `deploy/README.md`, `docs/known-alerts.md`.
  - Decisions:
    - `deploy/README.md` top: replace "The server has no inbound port. The `db` service has no host port." with "The server listens on `127.0.0.1:8080` on the host only (for Tailscale Serve, section Web panel). The `db` service has no host port." First install step 3: add a bullet "Web panel keys: see the section Web panel. Leave `WEB_BASE_URL` empty to keep the web off, and empty the dev value of `WEB_TRUSTED_ORIGINS` that `cp .env.example .env` copied."
    - New section `## Web panel` after `## Telegram` with these subsections (STE, numbered steps, one command per step, `sudo` steps marked "(you, sudo)"):
      - `### What it is`: the panel at `https://<machine>.<tailnet>.ts.net`, only for devices in your tailnet; ADR 0015 and 0016 (links); the web is off while `WEB_BASE_URL` is empty.
      - `### Tailscale (once)`: the admin console (MagicDNS on; HTTPS on, with the note that machine names and the tailnet name go into a public certificate ledger); the VPS install (E4: `curl -fsSL https://tailscale.com/install.sh | sh`, `sudo tailscale up --accept-dns=false --hostname=email-assistant`, Disable Key Expiry in the Machines page); each client device (E5). Never `tailscale up --force-reauth` over the tailnet.
      - `### Turn it on`: 1 read the gateway: `docker network inspect email-assistant_default --format '{{(index .IPAM.Config 0).Gateway}}'` (the network exists after the first `up`); 2 set in `.env`: `WEB_BASE_URL`, `WEB_AUTH_SECRET` (`openssl rand -base64 32`), `WEB_TRUSTED_PROXIES` = the gateway; leave `WEB_TRUSTED_ORIGINS`, `WEB_MAIL_ALLOW_LOCAL` and `WEB_DIST` empty; 3 the section Update (the migrations of S5 run there); 4 check the start line `web is on: https://…, dist /app/apps/web/dist` and that no `web:`/`WEB_BASE_URL` warn line follows; 5 `sudo tailscale serve --bg 8080`; 6 `tailscale serve status`.
      - `### Give a member a password`: `$C exec server bun run web:invite --org-id <uuid> [--user-id <uuid>]`; the link works once and for 24 h; open it on a tailnet device, set 12–128 characters; the same command makes a reset link later. The link is a secret: do not paste it into a chat with an agent or a log.
      - `### Check access`: the four checks of E9 (with placeholders for the names and the LAN IP).
      - `### Troubleshooting`: a table "Symptom | Cause | Fix" with at least: the page does not open on a device (Tailscale off on the device, or MagicDNS off: `tailscale status`); `502` from Serve (the server is down or not on `127.0.0.1:8080`: `$C ps`, `ss -ltn`); a certificate error on the first visit (HTTPS not on in the admin console; the first certificate can take a short time; do not retry in a loop, rate limit); `403 bad_origin` on every save (`WEB_BASE_URL` is not the URL in the browser bar); every member shares one rate limit / `auth_sessions.ip_address` is `172.x` (`WEB_TRUSTED_PROXIES` is not the gateway: read it again, E3); `web is off` in the log (`WEB_BASE_URL` empty); `web: dist folder missing` (the image lacks the build: rebuild); the setup link says "invalid" (used or older than 24 h: make a new one); the panel stopped after months (key expiry was not disabled).
      - `### Turn it off`: `sudo tailscale serve reset` (or `--https=443 off`); optional: empty `WEB_BASE_URL` and `$C up -d --wait server`. The auth tables stay.
      - `### Roll back` (E7): `git checkout <previous commit>`, `$C up -d --build --wait`; no down migration (the old code ignores the auth tables); `git checkout master` to return.
    - `docs/known-alerts.md`: `### WEB_BASE_URL is http:// on a non-loopback host: cookies are not Secure`: the Status line becomes "expected only in a misconfiguration: the VPS uses an `https://` `WEB_BASE_URL` (S5e)". `### web is off (WEB_BASE_URL is empty)`: the Fix text "expected until S5e sets the key on the VPS" becomes "expected on a host where the web panel is off; the VPS has it on since S5e (deploy/README.md, Web panel)". Do not add the deploy date yet (stage 4 knows it; stage 5 may add it). No new entry: the Serve and Tailscale symptoms are not log lines of the server; they live in the runbook table.
  - Check: `bunx prettier --check deploy/README.md docs/known-alerts.md`; `grep -n 'ts\.net' deploy/README.md` → every hit contains `<tailnet>`.
  - Done when: the section exists with every subsection above, Prettier passes, no real tailnet name.
  - Out of scope: the ADR files (stage 5), the architecture docs (stage 5), any VPS command.
