# 0003 — LLM returns data; plan → policy → commit; no send without user command

- Status: accepted (user, 2026-11-02)
- Date: 2026-11-01

## Context

Trust is the product value. Email text is untrusted input (prompt injection). The user decided:
the system never sends mail on its own, only when the user directly tells it to (product brief Q5).
The old docs had two models: pure tools + committer (`main_overview.md`) and tools with side effects (`triage.v2.md`).

## Decision

- The LLM returns structured data only (category, confidence, reason, extracted fields, delegate id from a given list).
- Tools are pure: they build an `ExecutionPlan`.
- A policy gate decides per action: `apply`, `await_approval` or `log_only`, from mailbox mode, tool switch, category go/no-go and VIP status.
  The full truth table is in `docs/architecture.md` §4.3. The triage worker runs the policy (a pure function) in the same transaction.
- Only the committer has side effects. It is idempotent per action.
- Every `send` action needs an approval record (user, time, channel). In MVP, approval = a button tap (Telegram or web).
  Free-text commands ("send it") come with two-way chat in Phase 2 and are recorded the same way.
- Text that the LLM writes is untrusted too: drafts quote the original mail, and the approval screen shows recipient, original sender and warnings (`docs/architecture.md` §7).
- Mailbox modes in MVP: `shadow` (log only, default) and `assist`. No auto-send mode.

## Consequences

- Safe start: a new mailbox runs in shadow mode and only logs what it would do.
- Easy tests: tools and policy are pure functions in `packages/core`.
- Approvals need a channel (ADR 0005) and an `actions` table with statuses.
- Implementation (S3): idempotent actions go `ready → applied` with the ensure rule (the committer makes the mailbox match the plan, so a crash repeats nothing); `ACTIONS_SCOPE` is a second gate next to the mode; Undo creates reverse actions that the committer applies (`docs/architecture.md` §4.1, §4.3, §4.4).
