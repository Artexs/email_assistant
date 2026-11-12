# S6a customer core: what the build taught

Ticket: `spec/features/active/F077-s6a-customer-core/`. Stages 1–16 are built. This note holds the facts that a later agent needs (S6b, S6c, S6e, S6f, the stage 18 checkpoint).

## Plan default (A6, for ADR 0020)

- The column `organizations.plan` has the default `active`, not `trial` as D3 says. The check `organizations_trial_end_check` (`plan <> 'trial' OR trial_ends_at IS NOT NULL`) fails every insert without a trial date, so a column default `trial` would break `createOrganizationWithOwner` and every test fixture.
- Every organization that existed at migration time became `active`.
- The CLI `org:create` sets `trial` with `--trial-days` (default 30, 1 to 365) so a new customer still starts in `trial`. `--plan active` skips the trial.
- ADR 0020 (S6e) must say this.

## Where the `suspended` gate sits (A13)

One place per entry point. A new job that walks organizations must use one of these, or add its own check and a test.

- `mail/repo.ts`: `listMailboxTargets` (needs `includeSuspended`) and `listSyncTargets` (always skips). Callers: sync, triage worker, committer, returned job, chaser. Only `actions/expiry.ts` passes `includeSuspended: true`.
- `channels/repo.ts`: `listLinkedChats({ includeSuspended })` (notices, digests) and `claimDueOutbox` (`NOT EXISTS` on a suspended organization, so `approval` rows of a suspended organization wait too).
- `mail/repo.ts`: `listAuthErrorMailboxesBefore` skips suspended organizations. `channels/operator.ts` sends `trial_ending` only for `plan = 'trial'`.
- Per-mailbox re-check with `isOrgSuspended` before each mailbox in `mail/jobs.ts`, `triage/jobs.ts` and `actions/committer.ts`.
- Telegram: `createUpdateHandlers` in `channels/commands.ts` (every command except `/help`, every tap).
- Web: `refuseSuspendedWrites` and `SUSPENDED_WRITE_ALLOW` in `platform/http.ts`. S6c adds `DELETE /api/organization` to the list (the line is in `tasks/planned/s6c-account-data.md`).
- No gate: `platform.retention` and `actions/expiry.ts` (by design, D4 and D5).
- The suspend hook (`cancelPendingOutboxOfOrg`, wired in `scripts/org-plan.ts`) sets pending outbox rows to `failed` / `outdated` except `approval` and `approval_set`.
- A web or Telegram `org:plan` call does not exist: only the CLI changes the plan. A change from the CLI while the server runs is seen at the next mailbox of the next job tick.

## Operator notices

- The dedup is an audit row `operator.notice` with `data = { kind, key }`, written after a successful send, in the organization of the event (`hasAuditKey` in `audit/repo.ts`). `recordAuditOnce` was not usable: it dedups by `(org_id, event)` only.
- Keys: `trial_ending:<org id>:<trial_ends_at ms>`, `llm_cap:<mailbox id>:<quota day start ISO>`, `auth_error_24h:<mailbox id>:<status_changed_at ms>`.
- Delivery is at least once: a crash between the send and the audit row repeats one notice.
- The cap hook (`onCapReached`) never blocks the triage loop. A failed cap notice waits for the next hourly run (`channels.operator`, minute 13).
- The `outbox` cannot carry these notices: an `outbox` row needs the `org_id` and `user_id` of a member, and the operator chat is not a member.
- S6b adds the auth-mail event (`tasks/planned/s6b-public-login.md`).

## Identifier columns that retention keeps (A23, for the S6e papers)

- `emails.message_id_header`, `dedup_key`, `thread_key` and `content_hash` stay forever: the sync finds and dedups mail by them. `thread_key` comes from Message-ID headers, not from the subject.
- Cleared after 90 days: `emails.subject`, `from_address`, `to_addresses`, `cc_addresses`, `in_reply_to`, `references_header`.
- `audit_log` and `triage_feedback` are never touched.
- The mail body goes after `organizations.data_retention_days` (30 by default). A `processing` mail keeps its body. A `pending` mail loses it only after 7 days.
- The S6e papers must name these kept ids. The user decided the defaults on 2026-11-12 (cold review question 20).

## Facts learned in the build

- The 48 h approval rule existed before S6a (`claimableWhere` in `actions/repo.ts`, `APPROVAL_TTL_MS`). Stage 6 only added a test for a suspended-then-resumed organization.
- The digest counted every `email.skipped` row as "older than 7 days". Stage 9 splits the count by `reason_code`: `too_old` and `suspended_backlog` have two lines.
- `retention-clear` functions use batches of 1 000 rows by id with `FOR UPDATE SKIP LOCKED`; a locked row waits for the next day.
- `chat_link_tokens` has no `id`: its key is `token_hash` and it must match `^[0-9a-f]{64}$` (test seeds need it).
- An `applied` `send` row needs `approved_at` (constraint `actions_send_approved_check`); test seeds need it.
- `claimDueOutbox` skips suspended organizations, so a pending outbox row of a long pause is ended by the retention job after 90 days (`failed` / `expired`), not by the sender.
- Test (26) in `actions-committer.test.ts` stubbed every `organizations` read as failing; the new suspend check reads the same table, so the stub lets the first read through.
- `TriageMailbox` is built in six test builders; a new field needs `resumedAt: null` in each.
- `fixtures.ts` has `suspendOrg` and `resumeOrg`. `insertTestEmail` takes `created_at`.
- The web: `isOwner = role === "owner" && canWrite(me)` is the edit right. A text that names the owner role reads `role` alone (`isOwnerRole`). List: `notes/2026-11-12-f077-s16-isowner-uses.md`.
- Playwright has no browser on this machine: use `CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e`, or install a headless shell into a temp folder.
- Stage 15 and 16 jobs each made an own e2e database (`db:worktree <name>_e2e`). Drop them after the land.

## Dev `.env` rule

Under a scope `all`, a dev server acts on every active mailbox of the dev database. Before a dev server runs with `all`, run `bun run org:status` and pause the extra dev mailboxes (or move their organization to `suspended` with `org:plan`). The same rule holds for the VPS (D2); see `deploy/README.md` "Customers (S6a)".

## Not proven at run time (open at stage 17)

- `main.ts` wiring of `channels.operator` and `platform.retention`: lint and typecheck cover it, no test starts the server. Stage 18 reads the start lines `operator notices: hourly …` and `retention: daily at 02:40` on the VPS.
- The CLI line `mailbox limit reached (max <n>)` of `mailbox:connect` has no test (stage 10).
- The hand run of `job:run --name platform.retention` ran on an empty database.

## Follow-ups (Limen tickets, planned)

- `F078-auth-verifications-cleanup`: the retention job deletes expired `auth_verifications` rows (after S6b hashes the tokens).
- `F079-approvals-at-resume`: an approval request from before a pause cannot go out unseen or late (A17).
- `F080-backfill-suspended-gate`: `mailbox:backfill` refuses a suspended organization.
- `F081-operator-notices-web`: the operator sees the notices in one place.
- F027 and F031 stay open: stage 18.5 closes them.

## Prepared for stage 18

The roadmap state line, to write after the merge, under the S5 state line in `docs/roadmap.md`:

> S6 state (<date of the merge>): S6a built (scopes for every mailbox, plan state, mailbox limit, operator notices, retention job).

The S6 row of the roadmap table already says the scope change (done in stage 17).
