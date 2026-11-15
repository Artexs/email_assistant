# F117 stage 07 review (Opus): result PASS, notes kept

Source: `.limen/jobs/2026-11-15-f117-review-s07-opus-oauth-state-1e9c3639/result`. No blocking finding.

## Done in the fix job

- TG1: test `7b` in the state-store block of `apps/server/test/integration/mail-oauth-start.test.ts` (8 parallel consumes, 20 rounds, exactly one winner). Reviewer mutation r1 (select, then delete by id) fails it alone (`/tmp/f117-s07/mut-r1-parallel-consume.log`).
- TG2 skipped: removing the state shape check only saves a query; no test can see it without counting DB calls.
- N1: the owner re-check at the callback is in stage 09 (line 52), not stage 08. `notes/2026-11-15-f117-s07-start-state-facts.md` is fixed. Stage 08 got a carry-over (same provider, pool, membership re-check done by consume).
- N11: the core test title is fixed ("refuses a non-uuid"). The schema stays non-strict (extra keys dropped, no security effect).

## Notes left open

- N2 (optional hardening): expiry uses the app clock (`now` of the caller) for `expires_at` and for the check, not the DB clock. A skew between app and DB changes the TTL by the skew. To enforce on the DB clock, compare with `now()` in the DELETE and give an expired row its own answer.
- N5 (hardening idea, carry-over for stage 13 and the F103 log rules): the log field `code` (`isLogValue`, `platform/log-fields.ts`) accepts any 0–64 character string of `[A-Za-z0-9_.:/*-]`, so a 43-character base64url state or verifier would pass. No path logs either today (the routes canary test checks it). Idea: make `isLogValue` refuse a string that matches `^[A-Za-z0-9_-]{43}$` and holds both upper and lower case letters. Event codes are lower snake_case, so no current code breaks.
