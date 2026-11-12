# Web panel on the VPS: deploy facts and results (2026-11-12)

Built in S5a–S5e. Deployed on the VPS at T = 2026-11-11 23:37 UTC, behind Tailscale Serve.
Task: `spec/features/done/2026-11/F054-s5e-web-deploy-docs/plan.md` (the stage 2, 3 and 4 logs hold the full evidence). ADRs: 0016, 0017.
The repo is public. Never write the tailnet name or the full `ts.net` host name. Write `email-assistant.<tailnet>.ts.net`.

## How the request reaches the server

1. Peer address. Compose publishes `127.0.0.1:8080:8080`. With the Docker userland proxy, `Bun.serve` sees the peer as the gateway of the Compose network, IPv4-mapped (`::ffff:172.19.0.1` on the test PC). `normalizeAddress` in `platform/http.ts` removes the mapping before the trust check.
2. Serve headers. Tailscale Serve keeps the `Host` header. It overwrites `X-Forwarded-For` with one tailnet address of the client (IPv4 `100.64.0.0/10` or IPv6 `fd7a:115c:a1e0::/48`). It sets `X-Forwarded-Host` and `X-Forwarded-Proto: https`. It adds the `Tailscale-User-*` headers and removes incoming copies. `Origin` and `Cookie` pass unchanged.
3. No OS listener. Serve runs inside `tailscaled` (netstack). It binds no host socket for port 443. After the deploy, `ss -ltn` shows one new line: `127.0.0.1:8080`.

## The keys and the gateway rule

- `.env` on the VPS has three new keys: `WEB_BASE_URL` (the `https://` Serve address, no path), `WEB_AUTH_SECRET` (`openssl rand -base64 32`), `WEB_TRUSTED_PROXIES` (the gateway of `email-assistant_default`; one IPv4 address, no CIDR; `172.18.0.1` on the VPS).
- Leave `WEB_TRUSTED_ORIGINS`, `WEB_MAIL_ALLOW_LOCAL` and `WEB_DIST` out of the VPS `.env`.
- A wrong or empty `WEB_TRUSTED_PROXIES` is not a security hole. The login works. But the Better Auth rate limit counts all clients as one, and `auth_sessions.ip_address` holds the gateway.
- Until F069: `docker compose down` could give the network a new gateway. To read it: `docker network inspect email-assistant_default --format '{{(index .IPAM.Config 0).Gateway}}'`.
- 2026-11-12 (F069): `deploy/compose.yaml` pins the subnet `172.30.0.0/24`, gateway `172.30.0.1`. After the move, `WEB_TRUSTED_PROXIES` is `172.30.0.1`. The VPS has not moved yet: it needs a planned `down` and `up` (recreates the network and `db`), outside a pilot week, after a backup, with the owner's go. Steps: `deploy/README.md` "Move a running stack to the pinned subnet".
- Backup copy of the old `.env`: `~/email_assistant/.env.bak-s5e` on the VPS (mode 600). Delete it when the panel is accepted.

## Rehearsal results (stage 2, test PC, 2026-11-11)

- Path: `0d39663` with data → current code → `0d39663` again.
- Migrations `20261110000001_web_panel.sql` (7.2 ms) and `20261111000001_delete_mailbox.sql` (2.2 ms); `db:migrate` wall time 9.8 s. `up -d --build --wait` took 33 s with cached images (a cold dependency layer adds minutes).
- After the migration: 0 users with a mixed-case e-mail (the migration lower-cases them). `max(version)` = `20261111000001`.
- With the trusted gateway, `auth_sessions.ip_address` was the forwarded address. With `WEB_TRUSTED_PROXIES` empty, it was the gateway.
- Rollback is code only. Finding: after the migration, the old code cannot create a user with a mixed-case e-mail (`users_email_lower_check`). The runbook "Roll back" says this.

## VPS results (stages 3 and 4)

- Tailscale 1.104.6 on the VPS. Machine name `email-assistant` (set with `sudo tailscale set --hostname=email-assistant`; the first `up` registered it as `ubuntu`). `sudo tailscale set --accept-dns=false` (the first `up` had set the host resolver to `100.100.100.100`). Key expiry is off. SSH stays on the LAN alias.
- Image `ea-server:latest` 673 MB. Migrations on the VPS: 57 ms and 1.0 s. Disk before the build: 1.7 GB free; `docker builder prune -f` freed 2.09 GB; after the deploy 3.8 GB free (83 % used). The first build took about 9 minutes (cold layers).
- Backup before the deploy: `ea-20261111T231803Z.dump.age` (325 KB).
- First HTTPS request through Serve: about 23:40 UTC. Status 200 with `strict-transport-security: max-age=15552000; includeSubDomains`. No wait for the certificate. The LAN address `:8080` refused the connection.
- Start line: `web is on: https://email-assistant.<tailnet>.ts.net, dist /app/apps/web/dist`. 0 `error` lines in the first 150 minutes.
- First password: the user ran `web:invite` on the VPS and set the password on the PC. All 3 sessions had a tailnet address, not the gateway. The login e-mail of the owner is the Interia pilot address.
- Hand smoke: pause 23:46:15 UTC and resume 23:46:17 UTC. 39 ✅ rows with source `web` (39 different mails). An agent Playwright run (desktop and 390 px) read the pages: 0 console errors, 0 failed `/api` calls.

## Open

- Phone sign-in (OnePlus 12, Android; the phone was offline at every check) and the phone cut-off check (mobile data without Tailscale must not open the panel).
- The ↩️ and ✏️ buttons on real mail. The bottom sheet with a long AI text on the phone.
- The user decides if the temporary password should change (it is probably the same as the real one).
