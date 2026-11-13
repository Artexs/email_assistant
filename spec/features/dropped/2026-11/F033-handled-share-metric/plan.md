> **Status 2026-11-07 — planned.** Idea from S3 (stage 18). Not started.

# Weekly "handled share" line in the digest

Scope: `docs/architecture.md` §4.4. Needs: S3.

## Goal

The weekly digest shows a "handled share" line. Handled mail is mail of the categories `spam`, `notification` and `info` with an applied plan. The plan must not be undone or corrected within 7 days. S3 does not build this line.

## Done when

- The weekly digest has the "handled share" line with the right numbers on a test mailbox.
- A test covers an applied plan, an undone plan and a corrected plan.
- `docs/architecture.md` §4.4 and `docs/modules.md` describe the line as built.

## Plan

S3 already stores the data that this line needs: `actions.applied_at`, the `undone` status of an action and the feedback rows. Write the file-level plan when the task starts.

- [ ] Write the plan (query for the share, digest line, tests).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-07: Created from the S3 follow-ups (stage 18, step 18.3).
