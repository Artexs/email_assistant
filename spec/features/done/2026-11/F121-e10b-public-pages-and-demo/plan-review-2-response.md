# F121 response to plan review 2

Review: [plan-review-2.md](plan-review-2.md) (FAIL on B1). Each finding, what changed, or why it is rejected.

- **B1 (ticket contradicts D10)** — accepted. A refresh job may not edit `ticket.md`, so the exact edit is in [plan-refresh-1.md](plan-refresh-1.md) § Edits outside the folder, and plan.md coordinator step C4 applies it before stage 09. Stage 10 proves `bun run demo:record` on the e2e seed; the `--seed` acceptance moves to the follow-up ticket (text in the same section).
- **N1 (bun tests in Playwright folders; not in CI)** — accepted. New D11: pure modules and bun tests of stages 07, 09, 10 live in `apps/web/e2e/lib/`, added to `test:unit`; Playwright folders hold specs only; stage 10's config sets `testMatch`. DB-side setup is one server function `setupDemoOrg` (`apps/server/src/scripts/demo-org-setup.ts`, interfaces.md) with its integration tests in `apps/server/test/integration/` (`test:int`). Check commands of 07, 09, 10 changed to `bun test apps/web/e2e/lib`.
- **N2 (rounded parts do not add up)** — accepted. Stage 03: a line under the table says each amount is rounded on its own; test 5 checks the line.
- **N3 (two margin formulas)** — accepted. Stage 03 adds `roundedCostRow(cost, priceUsd)` to `cost-model.ts`; the page and `cost-model-doc.test.ts` both use it (one rounding, one margin rule). The doc numbers do not change at the base (the reviewer computed both ways).
- **N4** — confirmation, no change.
- **N5 (`usedWhenText` not importable, prints env keys)** — accepted. `subprocessorView` makes its own plain "used when" text from `activeWhen`, en and pl, with no env key; test 4 covers each kind.
- **N6 (Q11 is a rule exception)** — accepted. Q11 is `[important: rule-exception]` and names the 2026-11-15 rule and the `.mdx`-only scan.
- **N7 (F138 stage 04 rewrites ledger rows)** — accepted, by the option that keeps stage 02 free of F138 stage 04: no F121 claim cites C038, C139–C141, C182, C184 or C196.
- **N8 (stage 04 step 3 outside Done when, no test)** — accepted. Step 3 moved before Check and Done when; test 5 asserts the pricing → security link.
- **N9 (e2e-source video could be uploaded)** — accepted. Stage 10 prints `demo_source e2e: not for upload` (test 5); the stage 11 release-checklist line accepts only a run that logs `demo_source demo`.
- **N10 (no step creates the follow-up ticket or the demo DB)** — accepted. C3: the coordinator makes the `*_demo` DB with `bun run db:worktree f121_demo` and puts `DEMO_DATABASE_URL` and `DEMO_MIGRATOR_DATABASE_URL` in the main `.env` (prepare copies them; never in task text); stage 10 adds both keys to `.env.example` and exits `demo_db_missing` without them. C4 creates the follow-up ticket.
- **N11 (Needs details)** — partly accepted. Stage 01 now says "May run next to 07 and 08". Stages 02–05 carry the lock rule for their `docs:test`. Accepted too: stage 11 no longer needs stage 10. Its release-checklist and owner-command step moved to stage 12 (which now needs stage 10 for the `demo:record` name), so no doc names a script before it exists.
- **N12 (split stage 06)** — rejected. 561 words, under the 700 cap; both parts share the reference sidebar and the drift test; the split adds a job and a land without cutting risk.
- **N13** — confirmation, no change.
