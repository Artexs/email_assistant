---
opened: 2026-11-19
---

# F152 · The restore drill rerun on the release that carries the TCP wait ends with restore ok at the first run

## Outcome

The restore drill rerun on the release that carries the TCP wait ends with restore ok at the first run.

<!-- Two to four sentences: what becomes true for a user or operator. -->

## Scope

- <!-- Boundary and starting seam, not an edit list. -->

## Out of scope

- <!-- Nearby work that is not part of this ticket. -->

## Acceptance

- <!-- One observable result or check per line. -->

## Notes

<!-- Optional decisions or open questions; no progress log. -->

Detail (from F139 stage 02, a coordinator VPS step; production checks never block, owner rule 2026-11-20): after release v0.4.2 (carries F139 stage 01, commit 38180f55), run the drill in project `ea-drill` on a fresh volume as `deploy/README.md` § Drill says: check first that no `ea-drill_` volume is left (`docker volume ls --filter name=ea-drill_`; with a leftover volume, run `--init-env` then `restore.sh --target drill --down` — in a fresh clone there is no `deploy/drill.env`, so `--down` refuses without it), run once, no rerun on failure. Expected: `restore ok`, a line `db ready probes=<n>`. Write the result into the drill record (`deploy/README.md` § VPS lost, `notes/2026-11-15-vps-deploy-queue.md`) and set `docs/known-alerts.md` § restore drill to fixed. Optional hardening from review 1: F139-2 asserts the 3 `sleep` calls. Build after: release v0.4.2 is deployed.
