# F136 stage 06 — edits that other tickets and the board own

Checked at HEAD `1685baff` (branch of this job, merged with master of 2026-11-20). The worker did not edit these files. Rule: `test:e2e`, `docs:shots` and `docs:test` run with no lock; `demo:record` keeps `flock /tmp/email-assistant-shared-tests.lock` (shared demo DB of the main `.env`).

## Remaining lock text in the rule paths (acceptance line 6)

`grep -rn email-assistant-shared-tests.lock CLAUDE.md .agents docs` still finds three lines. All three name `demo:record`, the shared resource the plan names (shared demo DB):
- `CLAUDE.md` § Rules, "Shared runtime" bullet (new sentence about `demo:record`).
- `docs/capabilities/live-lab.md` line 106 (demo recording).
- `docs/release-checklist.md` line 28 (demo run).
The plan expected no hit in these paths; it did not know these two docs name the lock. The coordinator decides: keep (recommended; the lock is real) or give `demo:record` a per-job demo DB later.

## Items

1. `spec/build.md` line 12 (TRACK "Now" bullet): remove "the Playwright lock (`flock /tmp/email-assistant-shared-tests.lock`) until F136 lands, " from the list of limits.
2. `spec/build.md` line 77 (owner rule 2026-11-20 paragraph): remove "the Playwright lock until F136, " from "Only these limits hold: …".
3. `spec/build.md` line 41 (NEXT list): remove the F136 line. Line 22 (ACTIVE list) moves with the land.
4. `spec/features/active/F124-…/plan.md` line 67: drop the clause "`test:e2e` only under `flock /tmp/email-assistant-shared-tests.lock` (not needed here)."
5. `apps/docs/scripts/shot-run.test.ts` line 8: the comment "made by hand under the shared lock (`flock /tmp/email-assistant-shared-tests.lock`)" becomes "made by hand (no lock; ports from `env.ts`)". Change it after the test audit (F125) cut list, unless that list removes the file. Not edited here.
6. `spec/features/planned/F151-…/stages/stage-07-shots-docs-gates.md` line 52: remove the sentence "Use `flock …` before each command while `CLAUDE.md` still names the lock for `docs:shots`."; `docs:shots` needs no lock. `planned/F151-…/plan.md` line 62 and stages 05 and 06 keep `flock` on `demo:record`.
7. `spec/features/active/F115-…/stages/stage-11-style-card.md` line 26, `stage-15-panel-reply.md` line 35 and `F143-…/stages/stage-11-e2e-seed.md` line 37 (proof lines): they run `test:e2e` under `flock`. Remove the `flock …` prefix, or leave it (harmless: it only serializes).
8. F121 (`done/2026-11/F121-e10b-public-pages-and-demo/`): `plan.md` "Lock rule until F136 lands" and stages 02, 03, 04, 05, 07, 10, 11, 12: none at HEAD. The ticket is in `done/`; do not edit it. Stage 10 already keeps `flock` on `demo:record`.
9. `db:worktree <name> --drop` already drops `<name>-e2e` too (stage 03): no new step.
10. `docs/owner-decisions.md` and `notes/2026-11-20-*.md` mention the lock as history: leave them.
