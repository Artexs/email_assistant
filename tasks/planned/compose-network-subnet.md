> **Status 2026-11-12 — planned.** Follow-up of S5e (E3). Not started. Do it outside a pilot week.

# Pin the Compose network subnet

Scope: `deploy/compose.yaml`, `deploy/README.md` "Web panel", `docs/decisions/0017-web-access-tailscale-serve.md`. Needs: S5e deployed.

## Goal

`WEB_TRUSTED_PROXIES` keeps its value after the stack is recreated. Today it holds the gateway of `email-assistant_default` (`172.18.0.1` on the VPS). A `docker compose down` or a Docker upgrade can recreate the network with a new gateway. Then every request has the new gateway as its peer, the proxy is no longer trusted, and `auth_sessions.ip_address` and the login rate limit see the gateway instead of the client.

## Done when

- `deploy/compose.yaml` pins the subnet and the gateway of the default network (an unused private range, for example `172.30.0.0/24`, gateway `172.30.0.1`), and the runbook names this value for `WEB_TRUSTED_PROXIES`.
- The VPS runs with the pinned network: `docker network inspect email-assistant_default` shows the pinned gateway; after a planned `$C down && $C up -d --wait` the first sign-in writes a tailnet address in `auth_sessions.ip_address` (checked as a boolean).
- The runbook "Web panel" no longer says "read the gateway again after each `down`".

## Plan

- Pick a range that does not clash with the LAN (`192.168.1.0/24`), the Tailscale ranges and the other Docker networks on the VPS (`docker network ls`, `docker network inspect`).
- Changing the subnet recreates the network, and the running `db`. It is a planned `down` and `up` of the live stack: do it outside a pilot week, after a backup, with the user's go. Rollback: the old compose file and `WEB_TRUSTED_PROXIES` with the old gateway.
- Update `.env` (`WEB_TRUSTED_PROXIES`, the user edits it), the runbook, ADR 0017 Consequences (a dated line) and `notes/2026-11-12-web-panel-deploy.md`.

## Log

- 2026-11-12: Created at the S5e close (E3).
