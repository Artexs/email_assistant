# Project tour: what it is, what it has, how to try it

Written 2026-11-03, after S1a stages 1–15. For the user and for a new agent.

## 1. What the product is
An AI email assistant for managers ("Prezes"). It reads the manager's mailbox, sorts mail, summarizes threads, filters noise, drafts replies and delegates tasks, and follows up on them. The user sees every action and why it happened. Source of truth: `docs/product-brief.md`.

Pilot MVP = slices S0–S4 on the user's own Interia mailbox, controlled from Telegram and a CLI:
| Slice | Result | State |
|---|---|---|
| S0 Foundation | Bun workspaces, Postgres, migrations, tenancy, `/health`, CI | done |
| S1a IMAP read + pilot host | Mail read every 5 min and stored, on the home VPS, backups, heartbeat | code done (stages 1–15); stages 16–17 = live setup + 48 h test |
| S1b Shadow triage | Gemini classifies each mail, records only, moves nothing | planned |
| S2 Telegram | Digest and urgent notices on the phone, ✅/✏️ feedback | planned |
| S3 Assist actions | Folder moves, mark read, flags, Undo | planned |
| S4 Drafts, approvals, delegation | Drafts, approve in Telegram, send, delegate, chase | planned |
Plan and order: `docs/roadmap.md`.

## 2. What the repo consists of
- `apps/server/` — the backend (Bun + Hono + Kysely).
  - `src/main.ts` — start-up: config, DB, `/health`, the scheduler (mail sync + heartbeat every 5 min).
  - `src/platform/` — shared tech: `config.ts` (env check), `crypto.ts` (AES-256-GCM for mailbox passwords), `db/` (Kysely, generated `schema.ts`), `scheduler.ts`, `heartbeat.ts`, `errors.ts`.
  - `src/modules/tenancy/` — organizations and users.
  - `src/modules/mail/` — the mailbox: `port.ts` (the provider interface), `imap/` (real IMAP/SMTP adapter, TLS always checked), `fake/` (in-memory provider for tests), `sync.ts` + `sync-rules.ts` (incremental sync, first sync, UIDVALIDITY rescan, dedup), `connect.ts`, `check.ts`, `jobs.ts`, `repo.ts`.
  - `src/modules/config/` — per-mailbox settings (mode `shadow` / `assist`).
  - `src/scripts/` — the CLI commands (section 4).
  - `test/` — integration tests (real Postgres + GreenMail) and the provider contract suite.
- `apps/web/` — Astro web app (placeholder until S5).
- `packages/core/` — shared pure code.
- `db/migrations/` — SQL migrations (dbmate).
- `deploy/` — `Dockerfile`, `compose.yaml` (VPS: `db` + `server`), `compose.dev.yaml` (Mac: db port + GreenMail), `backup.sh`, `restore-test.sh`, `README.md` (VPS runbook).
- `docs/` — product brief, architecture, modules, roadmap, ADRs, code patterns.
- `tasks/` — the work record (`active/`, `planned/`, `done/`); `notes/` — learned facts.

## 3. What works today (S1a)
- Connect a mailbox: the password is checked against IMAP and SMTP and stored encrypted.
- Every 5 min the server reads new INBOX mail and stores it (`emails` table, status `pending`). No AI yet, no change to the mailbox.
- Safe against duplicates, mail without Message-ID, UIDVALIDITY changes, crashes in the middle of a sync, mail moved back to INBOX.
- Heartbeat to Healthchecks.io; nightly encrypted backup to B2 (after setup).
- You do not see anything on the phone yet: that is S2.

## 4. Try it on the Mac (about 7 minutes, no real mail)
Tested 2026-11-03. Run in the repo root.
```sh
bun run dev:up                        # Postgres + GreenMail (local test mail server)
bun run db:migrate
bun run org:create --org-name Demo --email owner@example.com --display-name "Demo Owner"
#   → prints the org id; use it as ORG below
ORG=<org id>
A=demo-1@localhost                    # GreenMail accepts any user and any password
printf '%s' any-password | bun run mailbox:connect --org-id $ORG --address $A \
  --imap-host 127.0.0.1 --imap-port 3143 --smtp-host 127.0.0.1 --smtp-port 3025
#   → prints "connected mailbox <id>"; use it as MB
MB=<mailbox id>
for i in 1 2 3; do TEST_MAILBOX_ADDRESS=$A bun run mailbox:seed --org-id $ORG --mailbox-id $MB; done
bun run dev                           # the server; wait for the next 5-min tick:
#   [mail] sync <MB> initial: fetched 3, stored 3, ...   then Ctrl+C
bun run mailbox:audit --org-id $ORG --mailbox-id $MB --since 2026-11-03T00:00:00Z
#   → inbox=3 stored=3 missing=0 duplicates=0
docker compose -f deploy/compose.yaml -f deploy/compose.dev.yaml --env-file .env \
  exec db psql -U postgres -d email_assistant -c "select subject, from_address, status from emails"
```
Other checks: `bun run test:unit`, `bun run test:int` (about 240 tests), `bun run mailbox:check --org-id $ORG --mailbox-id $MB` (server capabilities).
Known gap: `org:create` rejects an owner email without a dot in the domain (`x@localhost`); use `@example.com`.

## 5. On the VPS (`ssh home_vm`, repo `~/email_assistant`)
`db` + `server` run in Docker with `restart: unless-stopped`, no open port except SSH. Runbook: `deploy/README.md`. Logs: `docker compose -f deploy/compose.yaml --env-file .env logs -f server`.
