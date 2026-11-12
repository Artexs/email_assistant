> **Status 2026-11-12 — planned.** Left: user steps U1, U4, the detailed stage plan (an own `plan-task` session), then the build and the deploy with `run-task`.

# S6f Hosted EU production

Scope: the S6 master plan `tasks/active/s6-pre-sale.md` (P4, P5, P6, findings 3 and 6, D11 (the Tailscale ACL), D21–D26, D30, D31 (backup event, key on production), D33, "Rules for every step"); ADR 0017. Also replaces `tasks/planned/compose-network-subnet.md` and `tasks/planned/server-env-scope.md` (move them to `done/` with a pointer when this segment is done). Needs: S6a–S6e merged; U1, U2, U3, U4, U10 done; U6 and U7 only before stage 7.
Git mode: worktree (`task/s6f-hosted-production`). Run mode: pipeline, but every stage on a real host waits for the user's go. Review model: stronger reviewer (Opus, high).

## Goal

The service runs on a hosted EU server behind Caddy on the public domain, the pilot runs there, the home VPS is staging, and the first customer gets an invite.

## Done when

- The two known timing tests are fixed and `ci` is green; CI pushes `ghcr.io/<owner>/email-assistant:<sha>` for each `master` commit (the push job needs `ci`, `image` and `e2e`); staging and production pull a pinned `<sha>`; no host builds the image.
- The production VM: SSH only through Tailscale (a public port scan of the address shows only 80 and 443), key login only, `unattended-upgrades` on, Docker on at boot; a reboot test passes. The Tailscale ACL lets the production host start no connection to other tailnet devices (a test from the host to the PC fails).
- `https://<domain>/health` → 200 with HSTS; `http://<domain>` redirects to HTTPS; the `server` has no host port; `docker network inspect` shows the pinned subnet; after a sign-in `auth_sessions.ip_address` holds a public client address, not the Caddy address (checked as a boolean).
- The running `server` env has no `POSTGRES_PASSWORD` and no `MIGRATOR_PASSWORD` (`docker compose exec server env` key names only); migrations run in the one-off service.
- Backups: the nightly `age` dump reaches the EU B2 bucket; one restore test on a short-lived Hetzner VM, deleted after the test (D24); a failed backup is an operator notice (D31).
- The pilot move (D26) passed its checks in order: the restore with owners and privileges and the grant checks; the start with the scopes off; the rollback point; then the scopes on, one triage on Vertex, the digest, the owner linked to the production bot (D33); the panel sign-in on the domain.
- After the 7-day rollback window: the home VPS pilot state is wiped (`down -v`, local dumps, old `.env`, no `.env.bak-*`), and staging runs there: Tailscale Serve, `TRIAGE_LLM_SCOPE=synthetic`, `ACTIONS_SCOPE=synthetic`, `SEND_SCOPE=off`, the old pilot bot as the staging bot, a new `CREDENTIALS_KEY`, its own backup bucket or prefix, test data only.
- Checkpoint 6: a second test organization on production went through invite, setup, connect (a test mailbox), triage, and delete; then the first customer got the invite.
- ADR 0019 (accepted; amends 0017), `docs/architecture.md` §10, `deploy/README.md` (production and staging runbooks), notes.

## Owns (from the master plan)

- Decisions D21 (host), D22 (Caddy, pinned subnet, trusted proxy), D23 (GHCR, timing-test fix), D24 (staging, restore-test VM), D25 (env split), D26 (pilot move), D30 (secrets on the host), D31 (backup event), D33 (production bot), the Tailscale ACL of D11.
- Files (expected): `.github/workflows/ci.yml` (push job with `packages: write`, on `master` only), `deploy/compose.yaml` (pinned subnet, image by tag), `deploy/compose.prod.yaml`, `deploy/Caddyfile`, `deploy/README.md`, `.env.example` (split), `docs/decisions/0019-*.md`, `docs/architecture.md`.

## Stage sketch

1. **Timing tests and image push**: fix the two known timing tests (`docs/known-alerts.md`); the CI push job, the tag rule, the pull on staging; the image content check stays.
2. **Compose for production** `[risky]`: pinned subnet, the Caddy service and file, the overlay, the env split and the one-off migrate service; a local run with a fake domain (Caddy internal CA) and a probe of the `X-Forwarded-For` handling.
3. **Home VPS on the new compose** `[risky]` (real host, user's go): the home VPS to the pinned subnet and the pulled image; the pilot keeps running there until stage 6.
4. **Production VM** (user step U4, then the agent with the user's go): VM, firewall, Tailscale SSH and ACL, Docker, the `.env` by the user (mode 600), the key file (U3), DNS (U1), a first start with an empty test DB for `/health`, the scan, the reboot test; then the test DB volume is removed.
5. **Backups on production**: `backup.sh`, the timer, the EU bucket, the failed-backup notice; the restore test on a short-lived VM.
6. **Pilot move** `[risky]` (checkpoint 5, outside a pilot week): D26 steps 1–6 with the rollback point; the checks.
   6b. **Staging** (after the 7-day window): D26 step 7 and D24.
7. **Second-organization run and first invite** (checkpoint 6): the run of checkpoint 6 of the master plan; delete the test organization; `org:invite` for the customer.
8. **Docs**: ADR 0019, architecture §10, runbooks, notes, known alerts.

## Questions for the plan session

- The VM type and the Hetzner location after the price check (U4).
- The SSH route: Tailscale SSH or OpenSSH over the tailnet (default: OpenSSH, bound to the tailnet address).
- The GHCR package visibility (default: public; the repo is public and the image holds no secret).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-12: Created by the S6 master plan session (`tasks/active/s6-pre-sale.md`).
