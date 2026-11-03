> **Status 2026-11-03 — done.** Built in S1a stage 12.4 (`connectionTimeoutMillis: 5000`; test in `db-role.test.ts`).

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
- [x] Done-when checks pass (`bun run test:int`: `checkDb` on a local TCP listener that never answers returns false within 7 s).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log
- 2026-11-03: Created from the S0 stage 6 review (finding 2).
- 2026-11-03: Done in S1a stage 12.4: the pool has `connectionTimeoutMillis: 5000`; test in `apps/server/test/integration/db-role.test.ts`. No statement timeout (out of scope).
