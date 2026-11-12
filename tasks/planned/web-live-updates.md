> **Status 2026-11-08 — planned.** Idea from the S5 plan (U7). Not started. Needs: S5d (the activity page and its data hook).

# Live updates in the web panel (server-sent events)

Scope: `tasks/done/s5-web-panel.md` U7, D17 (`lib/use-resource.ts` has one `invalidate()` entry). Needs: S5d built; useful before the Phase 2 approvals page.

## Goal

A page refreshes within a second of a change instead of the 30-second poll of S5, without a second request path for the data: a push signal only says "something changed for this organization", and the page refetches through the same hook.

## Done when

- `GET /api/events` (session required) streams server-sent events `{ kind: "changed", scope: "activity" | "mailboxes" | "settings" }` with a heartbeat every 25 s; a client reconnects after a drop; when the stream is not available the hook falls back to polling.
- The server listens on a Postgres channel (`LISTEN ea_changes`) on its own connection with reconnect; the workers (triage save, committer finish, mailbox status change, settings change) call `pg_notify` after their commit, or triggers do it; a test proves one notify per commit and the fan-out per organization only.
- Tailscale Serve (and later the public proxy) streams the response (checked on the VPS).
- Tests: the listener survives a dropped connection; a client of another organization receives nothing.

## Plan

Written when the task starts. Cost estimate from the S5 plan: 2–3 stages and one migration (triggers) or notify calls in four services.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built; related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-08: Created by the S5 master plan session.
