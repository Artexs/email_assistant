# 0016 — Web access only through Tailscale Serve

- Status: accepted
- Date: 2026-11-12

## Context

One user works with the panel. The server runs on a home VPS. There is no domain and no open router port (P3).
The code still treats the panel as public, because S6 moves it to a public proxy.

Decisions and facts: the S5 master plan, `tasks/active/s5-web-panel.md` (P3, D22). Deploy results: `tasks/active/s5e-web-deploy-docs.md`.

## Decision

- Tailscale runs on the host (version 1.104.6 on the VPS). `tailscale serve --bg 8080` gives HTTPS at `https://<machine>.<tailnet>.ts.net`.
  Only tailnet members reach it. There is no Funnel.
- The server port is `127.0.0.1:8080` on the host (`ports: ["127.0.0.1:8080:8080"]`). The `db` service has no host port.
  Serve has no OS listener: `ss -ltn` shows one new line, `127.0.0.1:8080` (checked on the VPS at deploy).
- Serve overwrites `x-forwarded-for` with one tailnet address (`100.64.0.0/10` or `fd7a:115c:a1e0::/48`).
  It keeps `Host` and `Origin`, and sets `x-forwarded-proto: https`. The server sees the Compose network gateway as the peer.
  So `WEB_TRUSTED_PROXIES` is that gateway (`docker network inspect email-assistant_default`). After the first login, `auth_sessions.ip_address` was a tailnet address.
- `WEB_BASE_URL` is `https://<machine>.<tailnet>.ts.net`. The origin check and the cookie `Secure` flag follow it.
- Tailnet settings: MagicDNS and HTTPS on. Key expiry off for the VPS machine (else the panel stops after 180 days).
  `--accept-dns=false` on the host, so the host resolver for IMAP, SMTP, Telegram and Gemini does not change.
- Result at deploy (2026-11-11): the first HTTPS request returned `200` with an HSTS header and had no certificate wait.
  A request to `http://<LAN address>:8080` was refused.

## Consequences

- Good: no public attack surface; Serve renews the certificates itself.
- Bad:
  - Every device needs the Tailscale app and an account.
  - The machine name and the tailnet name go to the public Certificate Transparency ledger. The repo is public, so docs write `<machine>.<tailnet>.ts.net`.
  - The panel depends on the Tailscale service.
  - Serve is open to every device that the tailnet policy (ACL) allows. The default policy of a one-user tailnet allows the owner's own devices only. Check `tailscale status` for foreign users before you rely on it.
  - Any process on the VPS host that reaches `127.0.0.1:8080` appears as the trusted Compose gateway and can set `x-forwarded-for`. This affects only the audit address and the rate limit.
  - A recreated Compose network (`docker compose down`, a Docker upgrade) can change the gateway. Read it again, then set `WEB_TRUSTED_PROXIES`.
    A wrong value does not open the panel. Every client then shares one rate-limit counter, and `auth_sessions.ip_address` holds the gateway.
    A pinned subnet is the follow-up `tasks/planned/compose-network-subnet.md`.
- S6 path: a public reverse proxy, or Cloudflare Tunnel with a domain. It changes only `WEB_BASE_URL`, `WEB_TRUSTED_PROXIES` and the proxy.
  Before that, do `tasks/planned/web-public-hardening.md`.
