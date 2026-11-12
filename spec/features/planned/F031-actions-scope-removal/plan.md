> **Status 2026-11-07 — planned.** Idea from S3 (stage 18). Not started.

# Remove the dependence of the `all` scope on `TEST_MAILBOX_ADDRESS`

Scope: `docs/roadmap.md` (S5, S6). Needs: S5.

## Goal

Before the first external customer (S5/S6), the `ACTIONS_SCOPE=all` scope must not depend on `TEST_MAILBOX_ADDRESS`. A per-mailbox consent of the user replaces it. Then the committer changes only mailboxes whose owner agreed.

## Done when

- `ACTIONS_SCOPE=all` does not read `TEST_MAILBOX_ADDRESS`.
- A mailbox without consent never gets a mailbox action. A test proves this.
- `docs/architecture.md` §4.3, `deploy/README.md` and `docs/code-patterns.md` describe the consent as built.

## Plan

Write the file-level plan when the task starts. Decide where the consent lives (mailbox settings or a separate table) and how the user gives it (web panel or Telegram).

- [ ] Write the plan (consent storage, UI, committer gate, tests).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-07: Created from the S3 follow-ups (stage 18, step 18.3).
