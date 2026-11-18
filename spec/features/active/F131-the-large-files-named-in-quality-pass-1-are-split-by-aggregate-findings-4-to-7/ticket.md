---
opened: 2026-11-15
---

# F131 · the large files named in quality pass 1 are split by aggregate (findings 4 to 7)

## Outcome

the large files named in quality pass 1 are split by aggregate (findings 4 to 7).

<!-- Two to four sentences: what becomes true for a user or operator. -->

## Scope

- <!-- Boundary and starting seam, not an edit list. -->

## Out of scope

- <!-- Nearby work that is not part of this ticket. -->

## Acceptance

- <!-- One observable result or check per line. -->

## Notes

<!-- Optional decisions or open questions; no progress log. -->

## Source

Quality pass 1, `spec/quality/2026-11-15-pass-1.md`, finding(s) 4,5,6,7: read each finding there (file, line, broken rule, proposed fix). Built only when the owner restarts the work. A fix that drops or changes a user feature waits for the owner.

## Remaining after the first land (2026-11-18)
Landed: findings 4, 5, 6 (sync, channels/repo, triage/repo, triage/eval, en.ts, pl.ts, sim-commands) and part of 7 (eval-suspicious, eval-extractor). Not done: `apps/server/src/modules/actions/send.ts` (796 lines) and `apps/server/src/platform/config.ts` (677 lines): split them after F115 stage 09 and F118 stage 01 land (open edits there). `eval-sim.ts` stays (307 lines, under the limit). The sim commands stay in `scripts/` (no DB; no new module). No e2e spec ran: run `trust-card`, `settings`, `stats` once under the flock lock before closing.

Update 2026-11-18: `platform/config.ts` is split (config-shared, llm, mail, ops, push). Only `actions/send.ts` remains.

Closed 2026-11-18: `actions/send.ts` split landed (parts send-close, send-failure, send-finish, send-limit, send-outcome, send-prepare, all at most 400 lines). The i18n split was exercised by the F118 stage 04 browser run on master (42 specs passed incl. settings, account, auth, language, activity). Finding 7 left as noted: eval-sim stays (307 lines), sim commands stay in scripts/.
