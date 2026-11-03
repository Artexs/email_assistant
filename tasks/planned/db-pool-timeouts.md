> **Status 2026-11-03 — planned.** Idea from the S0 stage 6 review; not started.

# DB pool connection timeout

Scope: `apps/server/src/platform/db/index.ts` (`createDb`). Needs: S0 done.

## Goal
`GET /health` returns 503 fast when the DB host drops packets, not only when it refuses the connection.

## Done when
- The `pg` `Pool` has a `connectionTimeoutMillis` (for example 5000) and, if needed, a statement timeout for `checkDb`.
- A test shows `checkDb` returns `false` within the timeout against an address that does not answer.

## Background
The S0 stage 6 reviewer found that the `Pool` has no `connectionTimeoutMillis`. A refused connection (tested) gives 503 at once. A dropped connection can make `/health` hang.

## Done-checklist
- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log
- 2026-11-03: Created from the S0 stage 6 review (finding 2).
