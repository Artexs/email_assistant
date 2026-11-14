---
opened: 2026-11-12
landed: 2026-11-14
---

# F078 · Expired Better Auth `auth_verifications` rows are deleted by the retention job

## Outcome

The retention job `platform.retention` deletes expired rows of the Better Auth table `auth_verifications` (reset-password tokens and the like). No expired token stays in the database. This starts after S6b hashes the tokens.

## Scope

- Start at `apps/server/src/retention.ts`. `auth_verifications` belongs to Better Auth: only `platform/auth.ts` reads and writes it (`docs/code-patterns.md`, Data access). The delete goes through a function that `platform/auth.ts` exports, or through Better Auth's own cleanup. Decide in the ticket plan.
- A row is expired when its `expires_at` is before the run time minus a short grace period. The `value` column holds the user id, so a user delete must not leave rows (S6c deletion test).
- One test with a fixed clock: an expired row goes, a live row stays, a repeat run changes nothing.
- `docs/architecture.md` §7 retention table gets one row.

## Out of scope

- Hashing the tokens (S6b). Deleting `auth_sessions`.
- The deletion of an organization (S6c).

## Acceptance

- After the job ran, no `auth_verifications` row with `expires_at` older than the grace period exists (test, fixed clock).
- A live row stays (test).
- A repeat run changes nothing (test).
- The retention log line holds a count and no `value` or `identifier`.

## Notes

Follow-up of F077 stage 17. Opened because S6a clears only the tables that S6a owns.
