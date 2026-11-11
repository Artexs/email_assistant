> **Status 2026-11-08 — planned.** Left: the detailed stage plan (an own `plan-task` session), then the build with `run-task`. Every VPS step needs the user's go (master checkpoint 3).

# S5e Web: deploy and docs

Scope: the S5 master plan `tasks/active/s5-web-panel.md` (P3, P12, D22, D23, the follow-ups list, "Rules for every step"). Needs: S5a–S5d built and merged into `master`.
Git mode: worktree (`task/s5e-web-deploy-docs`). Run mode: pipeline (the VPS stages run in the main session with the user, as S3 stage 19 and S4 stage 22 did).

## Goal

The panel runs on the home VPS and is reachable only through Tailscale Serve with HTTPS; the owner sets the password from the CLI link and uses the panel on the phone. The docs, ADRs, runbook, known alerts and notes describe S5 as built, and S5 closes.

## Done when

- `https://<machine>.<tailnet>.ts.net/health` answers from a tailnet device; from outside the tailnet nothing answers; the VPS has no new open port (`ss -ltn` shows 8080 only on `127.0.0.1`).
- The owner opens the `web:invite` link on the phone, sets the password, logs in, and every page works over Tailscale (a hand smoke with a checklist in the log).
- `docs/architecture.md`, `docs/modules.md`, `docs/roadmap.md` (S5 state), `docs/code-patterns.md`, `deploy/README.md` ("Web panel" section with install, keys, invite, troubleshooting) and `docs/known-alerts.md` (every new log line) describe what was built; ADR 0015 and ADR 0016 are accepted; ADR 0011 gets a dated line about the auth tables.
- The follow-up files of the master plan exist and the S6 task has the Polish translation and the e-mail sender lines.
- S5a–S5e and the master task move to `tasks/done/` with their done-when evidence; a handoff for S6 exists.

## Owns (from the master plan)

- Decisions D22 (VPS and Tailscale), D23 (ADRs and docs).
- Files (expected): `deploy/compose.yaml` (`ports: ["127.0.0.1:8080:8080"]`), `.env.example` final text, `deploy/README.md`, `docs/decisions/0015-web-panel-static-build-and-better-auth.md`, `docs/decisions/0016-web-access-tailscale-serve.md`, `docs/decisions/README.md`, `docs/{architecture,modules,roadmap,code-patterns,known-alerts}.md`, `notes/<date>-web-panel-deploy.md`, `notes/2026-11-03-pilot-vps.md` (append the S5 deploy facts).

## Stage sketch

1. **Compose, env text, runbook, alerts**: the loopback port, `.env.example` comments, the "Web panel" runbook section, known-alerts entries for `web is off`, `web: dist folder missing`, `web: reset requested for user <id>`, the Better Auth `warn` lines, repeated 403 `bad_origin` or 401 counts, and the Better Auth upgrade path (a Dependabot PR: run the auth integration tests and the login smoke, then deploy; D1).
2. **User steps** `[risky]` (gated): Tailscale on the VPS (`sudo`), on the phone and the laptop; HTTPS certificates and MagicDNS in the admin console; `tailscale serve --bg 8080`; the user sets `WEB_BASE_URL`, `WEB_AUTH_SECRET`, `WEB_TRUSTED_PROXIES` in the VPS `.env`. The agent verifies only with read-only commands the user runs or allows (`tailscale status`, `curl -I https://<name>/health`).
3. **Deploy** `[risky]` (gated): `git pull`, `db:migrate` (the two S5 migrations), `up -d --build --wait`, the start log lines, `web:invite`, the first login on the phone, the hand smoke of every page, the source address check for `WEB_TRUSTED_PROXIES`, a day of use.
4. **Docs and ADRs**: D23 list; the notes; the S5 state paragraph in the roadmap.
5. **Close**: done-when evidence of the master plan, the done-checklists, `git mv` of the six task files to `done/`, the handoff for S6.

## Questions for the plan session

Whether the user wants the panel on more than one phone or laptop; the Tailscale machine name; whether the S4 pilot week result (`tasks/planned/s4-pilot-week.md`, 2026-11-14) should be read before the deploy (a restart is fine; the question is only about timing).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-08: Created by the S5 master plan session (`tasks/active/s5-web-panel.md`, P11).
- 2026-11-08: Cold review fix (finding 22): the Better Auth upgrade path in `docs/known-alerts.md`.
- 2026-11-11: Pointer from S5b: `WEB_MAIL_ALLOW_LOCAL` stays empty on the VPS (the server warns at start when it is `true`). ADR 0014 is taken (`0014-sync-provider-sort-folders.md`; difference 6 of the S5b plan), so S5e starts at 0015. Facts: `notes/2026-11-11-web-mailboxes-facts.md`.
- 2026-11-11: Pointer from S5c: the time-zone list comes from the server (`GET /api/organization.timezones`, `Intl.supportedValuesOf`); check one timezone change on the VPS image (Bun 1.3.14; nobody probed its list; the dev Bun is 1.4.4). `docs/modules.md` §2 needs the new edge `tenancy → audit` (`tenancy/service.ts` writes the `org.timezone_changed` and `org.style_changed` audit rows). The U8 note (what follows the timezone, and the six digest cases): `notes/2026-11-11-web-settings-rules-facts.md`. New log lines for `docs/known-alerts.md` are already there (`timezone changed`, `signature changed`, `rule limit reached`).
