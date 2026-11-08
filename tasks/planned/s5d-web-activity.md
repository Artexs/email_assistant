> **Status 2026-11-08 — planned.** Left: the detailed stage plan (an own `plan-task` session), then the build with `run-task`.

# S5d Web: activity

Scope: the S5 master plan `tasks/active/s5-web-panel.md` (P8, U6, U7, D10 (a) (g), D12, D13, the API contract rows marked S5d, "Rules for every step"). Needs: S5a built and merged.
Git mode: worktree (`task/s5d-web-activity`). Run mode: pipeline.

## Goal

The activity page shows what the system decided for each mail and why, what it did, and lets the user say ✅ or ✏️ and undo a change, with the same rules and words as Telegram. Undo and feedback run through one shared service.

## Done when

- The S5 done-when "the activity page shows each mail's decision and reason, with Undo and ✅ / ✏️ feedback" holds in dev with seeded synthetic mail (Playwright in both projects): the row shows category, confidence, reason or summary and the action phrases of the digest; ✅ writes a `web` feedback row; ✏️ opens the picker and writes the label; ↩️ gives "started" under `ACTIONS_SCOPE=synthetic` and "not possible now" under `off`.
- `undoWithFeedback` is the one code path for the Telegram tap and the web button (D10 (a)); the S3 callback tests stay green.
- `listActivity` filters by organization (test), pages by the keyset cursor `(received_at, id)` of D9 with a stable order (a test with equal timestamps), honours the window, returns null subjects as "(removed)" after retention, and runs a fixed number of queries per page (test counts them).
- A mail of another organization is "not found" on feedback and undo (404 and `not_found`).
- Polling (U7): the page refetches every 30 s while visible and stops when hidden (unit test of the hook with fake timers); the "updated HH:MM" line and Refresh work.

## Owns (from the master plan)

- Decisions D10 (a) `undoWithFeedback`, D10 (g) and D12 `listActivity`, D13 feedback and undo over the web, U7 polling in the data hook (the hook itself comes from S5a; S5d is its first real user).
- Contract rows: `GET /api/activity`, `POST /api/feedback`, `POST /api/actions/undo`.
- New files (expected): `apps/server/src/modules/triage/undo.ts`, `apps/server/src/modules/reports/{activity,routes}.ts`, `packages/core/src/web/activity.ts` (item schema, query schema), `apps/web/src/islands/Activity.tsx` (+ `ActivityRow`, `ActivityPanel`, `CategoryPicker`), `apps/web/e2e/activity.spec.ts`.
- Changed files (expected): `channels/callbacks.ts` (calls `undoWithFeedback`), `triage/{index,routes}.ts`, `reports/index.ts`, `delegation/{repo,index}.ts` (`findDelegationByEmail`), `apps/server/src/scripts/e2e-seed.ts` (triaged mail with actions), `apps/web/src/i18n/en.ts`.

## Stage sketch

1. **`undoWithFeedback`** and the callbacks refactor; tests green.
2. **Activity read model** `[risky]`: `reports/activity.ts`, `findDelegationByEmail`; integration tests (tenant filter, cursor, window, phrases through `describeActions`, `isUndoable`, latest feedback, retention nulls, query count).
3. **Routes** `[risky]`: `reports/routes.ts`, `triage/routes.ts` (`/api/feedback`, `/api/actions/undo`); the route matrix; the `unsure` rule (400); the `UndoResult` mapping.
4. **Activity page**: filters (mailbox, category, range), rows per the shell sketch, the side panel (reason, summary, actions with statuses and times, feedback state, buttons), the ✏️ picker with the five categories, toasts with the Telegram texts (U6), polling and Refresh (U7), load more, the three page states (U4), both widths.
5. **Playwright and notes**: seed with synthetic triaged mail (moved, flagged, unsure, one of another organization); ✅, ✏️, ↩️; group review; **user checkpoint 2** after the merge (the user tries the whole panel in dev).

## Page-level questions for the plan session

The row density on the phone (two lines or three); which filters are default (last 7 days, all categories); the panel content order; whether the picker is a sheet or a dialog; the wording of the undo toasts (keep Telegram's); how a delegation row shows its status; what "needs my action" means as a filter (unsure, needs_reply, urgent).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (the S5 docs pass is S5e; this segment writes its notes).
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-08: Created by the S5 master plan session (`tasks/active/s5-web-panel.md`, P11).
- 2026-11-08: Cold review fix (finding 17): keyset cursor on `(received_at, id)`.
