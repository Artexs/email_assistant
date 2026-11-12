> **Status 2026-11-12 — planned.** Left: the detailed stage plan (an own `plan-task` session), then the build with `run-task`.

# S6a Customer core: scopes, consent, plan state, retention

Scope: the S6 master plan `tasks/active/s6-pre-sale.md` (findings 1 and 2, P3, D1–D6, D29, D31 (frame, trial, cap and `auth_error` events), "Rules for every step"). Also replaces `tasks/planned/actions-scope-removal.md` and `tasks/planned/retention-job.md` (move them to `done/` with a pointer when this segment is done). Needs: S5 (done); user step U0 sent (the lawyer question; the answer is needed by S6c, not here).
Git mode: worktree (`task/s6a-customer-core`). Run mode: pipeline. Review model: stronger reviewer (Opus, high) for every stage.

## Goal

A second organization can run next to the pilot: every mailbox is processed without `TEST_MAILBOX_ADDRESS`, the existing modes are the consent for changes, the operator can pause a customer, the number of mailboxes is limited, and stored texts expire after the documented periods.

## Done when

- `TRIAGE_LLM_SCOPE=all`, `ACTIONS_SCOPE=all` and `SEND_SCOPE=all` do not read `TEST_MAILBOX_ADDRESS` (grep in `apps/server/src/modules` and `composition.ts`: only the `testmail` and probe tools read it). Test: two organizations with one mailbox each, both get triage.
- A `shadow` mailbox gets only `logged` action rows, never `ready`; an `assist` mailbox gets actions only for the categories with `auto` on (existing tests stay green; one new test per gate).
- `organizations.plan`, `trial_ends_at`, `max_mailboxes`, `resumed_at` exist, with the check `plan <> 'trial' or trial_ends_at is not null`; every organization that exists at migration time is `active`; `org:plan` changes them with an audit row; `org:create --plan`; `org:status` prints the D3 fields (ids and counts only).
- A `suspended` organization gets no sync, triage, `triage.returned`, action, send, chaser reminder, digest or notice (one test per job, with a second `active` organization that still gets its work in the same tick). The approval expiry and the retention job still run for it. The committer refuses a send whose approval is older than 48 h (any plan). Telegram taps and commands answer "account paused" and change nothing. Every web write route answers `403 org_suspended` except sign-out, password change and delete organization (route matrix test).
- Back from `suspended`: `resumed_at` is set; mail with `received_at < resumed_at − 24 h` is `skipped` with `suspended_backlog`; the sync-late notice counts from `resumed_at` (tests with a fixed clock).
- Connect refuses the mailbox above `max_mailboxes` with `mailbox_limit` (web and CLI); the IMAP check runs outside the lock; two connects at once give one success and one `mailbox_limit` (advisory lock, D6).
- Operator notices (D31): with `OPERATOR_TELEGRAM_CHAT_ID` set, the trial-ends-in-3-days, daily-cap and 24 h `auth_error` events reach that chat with ids only; without it they are `warn` lines (tests).
- Before the deploy to the home VPS: the mailbox list of D2 is in the log (ids, status, mode), and every mailbox that is not the pilot mailbox is paused or removed by the user.
- The retention job clears each text of the `docs/architecture.md` §7 table after its period (one test per row, fixed clock); a repeat run changes nothing.
- The panel shows "Trial ends on <date>" to owners in `trial`, and the paused banner with `OPERATOR_CONTACT` in `suspended`; the S5b scope badges show the new meaning (no "test mailbox only" text).
- `docs/architecture.md` §4.3, §7 and §8, `deploy/README.md` and `docs/code-patterns.md` describe the new rules.

## Owns (from the master plan)

- Decisions D1 (scopes), D2 (consent by mode, the mailbox list before the deploy), D3 (plan state, `org:plan`, `org:status`), D4 (`suspended` in every job, taps, web writes, resume), D5 (retention job), D6 (mailbox limit), D29 (`OPERATOR_CONTACT`), D31 (operator notices frame; S6b and S6f add events).
- Files that read the scopes today (expected to change): `modules/actions/{scope,committer,undo,index}.ts`, `modules/triage/{jobs,index,routes,undo}.ts`, `modules/channels/{commands,callbacks}.ts`, `modules/channels/telegram/runtime.ts`, `modules/mail/tools.ts`, `platform/config.ts`, `composition.ts`, `main.ts`, `web.ts`, `apps/web/src/i18n/en.ts` (scope badge texts). The `scripts/{testmail*,mailbox-probe-*,mailbox-seed}.ts` keep `TEST_MAILBOX_ADDRESS`.
- New files (expected): `db/migrations/<version>_org_plan.sql`, `apps/server/src/platform/retention.ts` (or `modules/*/retention.ts` per owner module; the plan session decides by `docs/code-patterns.md`), `apps/server/src/scripts/org-plan.ts`, the plan-state read in `modules/tenancy`.
- Jobs that get the `suspended` gate: `modules/mail/jobs.ts` (sync), `modules/triage/jobs.ts`, the committer, the send, the approval expiry, the chaser, `modules/channels/digest-job.ts`, `notices.ts`, the notifier. The plan session lists every job from `main.ts` and checks that none is left.

## Stage sketch

1. **Scope rules in core** `[risky]`: the new meaning of `all` in `actions/scope.ts` and the triage scope (pure functions + unit tests); the config text of the three keys; `TEST_MAILBOX_ADDRESS` optional unless a `testmail` tool runs.
2. **Wire the scopes** `[risky]`: committer, send, triage worker, undo, Telegram callbacks, `web.ts`; two-organization integration tests; S3 and S4 tests stay green.
3. **Migration: plan state** `[risky]`: `organizations.plan`, `trial_ends_at`, `max_mailboxes`; the existing rows → `active`; repo, `org:plan` CLI, audit row `org.plan_changed`.
4. **`suspended` gate in the jobs** `[risky]`: one shared read (`isOrgSuspended` or a join in the claim queries); every job of the list; expiry and retention keep running; the 48 h approval age rule in the committer; one test per job.
5. **`suspended` at the edges and resume** `[risky]`: Telegram taps and commands, the web write routes (`403 org_suspended`), `resumed_at`, the backlog rule, the sync-late grace; tests.
6. **Mailbox limit and `org:status`**: the advisory lock and count in the connect service; web error `mailbox_limit` and its text; concurrency test; `org:status`.
7. **Operator notices frame**: `OPERATOR_TELEGRAM_CHAT_ID`, the outbox kind (or a direct send; the plan session decides by the outbox rules), the trial, cap and `auth_error` events.
8. **Retention job** `[risky]`: as `tasks/planned/retention-job.md`; daily schedule; per-row tests with a fixed clock; idempotence.
9. **Panel**: the trial line (organization time zone), the paused banner, the read-only mirror in `suspended`, the scope badges; `OPERATOR_CONTACT` env and its check; Playwright for both states.
10. **Docs, notes, mailbox list, deploy and group review** (checkpoint 1): architecture §4.3, §7, §8; `deploy/README.md` (the new meaning of the scopes); the D2 mailbox list on the VPS before the deploy; the deploy with the user's go.

## Questions for the plan session

- Where the consent text sits in the connect form (one line above the button, default) and its words.
- The read-only rule in `suspended`: which settings stay changeable (default: none except "delete organization" and the password).
- The exact list of jobs and notices (read `main.ts`), and whether the urgent notice of a mail that arrived before the pause still goes out (default: no).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded (ADR 0020 is written in S6e; this segment writes its notes).
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-12: Created by the S6 master plan session (`tasks/active/s6-pre-sale.md`).
