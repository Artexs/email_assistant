# s6a-customer-core — Stage 17

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read the whole segment file and the master plan's D28 (ADR 0020 is written in S6e) first.

## Stage 17 — Docs, notes, follow-ups

Two steps. Docs only; no code. The words follow ASD-STE100 (the repo docs already do). Write what was built, with the real names from stages 1–16 (read the code, not only this plan).

- [ ] **17.1 Docs describe the built rules**
  - Goal: a new agent or the operator learns the new meaning of the scopes, the plan state, the `suspended` rules, the mailbox limit, the operator notices and the retention job from `docs/` and `deploy/README.md`, without this task file.
  - Files: change `docs/architecture.md` (§4.3, §4.6, §5, §7, §8), `docs/modules.md` (§3.0 jobs, §3.1 `tenancy`, §3.2 `mail`, §3.8 `channels`), `docs/code-patterns.md`, `deploy/README.md`, `docs/roadmap.md` (the S6 state line), `.env.example` (check only: stages 1, 7, 11 changed it).
  - Decisions (what each place says):
    - `architecture.md` §4.3: replace the `all` sentences of `ACTIONS_SCOPE` and `SEND_SCOPE` ("every mail of the mailbox `TEST_MAILBOX_ADDRESS` …", "The server refuses `all` without `TEST_MAILBOX_ADDRESS`") with the D1 meaning: `all` = every active mailbox of an organization that is not `suspended`, by the mode, the switches and the `auto` flags; a send still needs the tap. Add one sentence: "The modes are the consent (D2): `shadow` changes nothing in the mailbox."
    - §4.6 `emails.status`: add `processing → skipped (received more than 24 h before resumed_at and not backfilled, reason suspended_backlog)`.
    - §5 data model, `organizations` row: add `plan` (`trial` / `active` / `suspended`), `trial_ends_at`, `max_mailboxes` (default 2), `resumed_at`.
    - §7 retention table: remove "(the retention job does not exist yet …)"; add one line under the table: the job `platform.retention` runs daily at 02:40 for every organization (all plans), clears in batches, skips rows that a job holds, and logs counts only; old `chat_link_tokens` rows go after 1 day. The pending / processing rule of the body.
    - §8: the scheduler list gets `platform.retention` (daily 02:40) and `channels.operator` (hourly at minute 13); a new bullet "**Plan state (S6a):**" with the D4 rules as built (which jobs skip a suspended organization, which run, Telegram and web answers, the resume rules, the 48 h rule), and "**Operator notices (S6a):**" with the three events, the keys and the at-least-once rule.
    - `modules.md`: the jobs table/list gets the two new jobs; `tenancy` owns the plan state, `setOrgPlan`, `org:plan`, `org:status`; `mail` owns the mailbox limit; `channels` owns the operator notices. The dependency graph (§2, `modules.md:71-100`) gets the new edges: `mail → tenancy` (stage 10, `getOrgPlan`), `channels → tenancy` and `mail` (already there; check), and the composition file `retention.ts` beside `web.ts`.
    - `code-patterns.md`: stages 4, 6, 8 and 11 already wrote their rules (the write gate and `SUSPENDED_WRITE_ALLOW`, the job rule, the entry points `listOrganizations`, `countSyncTargets`, `listAuthErrorMailboxesBefore`, the `includeSuspended` options). Here only check that they are all there and match the code; fix gaps.
    - `deploy/README.md`: the `ACTIONS_SCOPE` and `SEND_SCOPE` sections and the "First install" key list say the new meaning; "`TEST_MAILBOX_ADDRESS` (test mailbox only)" becomes "(only for the `testmail` and probe tools)". A new section "## Customers (S6a)" with: `org:create --plan`, `org:plan` (examples with placeholders `<org id>`), `org:status`, what `suspended` does, the mailbox limit, `OPERATOR_CONTACT`, `OPERATOR_TELEGRAM_CHAT_ID`, and the rule "Before you set a scope to `all` on a server with more than one mailbox, run `org:status` and pause every mailbox whose owner did not agree (D2)". `job:run` gets `platform.retention`.
    - `roadmap.md`: one state line under the S5 state line: "S6 state (<date>): S6a built (scopes for every mailbox, plan state, mailbox limit, operator notices, retention job)." — written at stage 18 after the merge; in this stage only prepare the line in the task log.
  - Test: none (docs). The reviewer reads the diff against the code.
  - Check: `bunx prettier --check docs/architecture.md docs/modules.md docs/code-patterns.md deploy/README.md`; `grep -n "TEST_MAILBOX_ADDRESS" docs/architecture.md deploy/README.md` (paste: only the test-tool lines are left); `grep -rnE "tail[0-9a-f]{6}|ts\.net" docs deploy | grep -v "<machine>\.<tailnet>"` → no match (public repo rule).
  - Done when: the checks pass; no doc line contradicts the code.
  - Out of scope: ADR 0020 (S6e); Polish docs.

- [ ] **17.2 Notes and follow-ups**
  - Goal: what a later agent needs and what S6a did not do is on the board.
  - Files: create `notes/2026-11-12-s6a-customer-core.md` (or the build date); create four Limen tickets (below); change `tasks/planned/s6c-account-data.md` (the line about `SUSPENDED_WRITE_ALLOW`) and `tasks/planned/s6b-public-login.md` (the operator notice frame: add the auth-mail event through `createOperatorNotices`).
  - Decisions:
    - The note holds: the facts learned in the build (each stage log's "learned" items), the plan-default change of A6 (column default `active`, CLI default `trial`) for ADR 0020, the A13 gate places, the operator dedup by audit key, the identifier columns that retention keeps (A23, for the S6e papers), and the dev `.env` rule (pause the extra dev mailboxes before a dev server runs with `all`).
    - Follow-ups are Limen tickets (since `67cca12`, `CLAUDE.md` § Work: new work that is not S6 goes to `spec/features/`). If the `limen` CLI exists, use `limen ticket new "<what becomes true>"`; else copy `spec/features/_template/ticket.md` into `spec/features/planned/F<NNN>-<slug>/ticket.md` with the next free number (highest `F<NNN>` in `spec/features/*/` and `spec/features/done/*/` + 1; F075 was the highest on 2026-11-12), set `opened:` to the day, delete the template note, and fill Outcome, Scope, Out of scope, Acceptance:
      - `auth-verifications-cleanup`: expired Better Auth `auth_verifications` rows are deleted by the retention job (after S6b hashes the tokens).
      - `approvals-at-resume`: after a pause, an approval request of a draft from before the pause cannot go out unseen or late (A17; decide: expire unnotified sends at resume, or re-queue the cancelled request).
      - `backfill-suspended-gate`: the `mailbox:backfill` CLI refuses a suspended organization (today it does not check the plan).
      - `operator-notices-web`: the operator sees the notices in one place (today: Telegram or log lines).
    - Do not close F027 and F031 here: stage 18.5 closes them when the segment is done.
  - Test: none.
  - Check: `bunx prettier --check notes/2026-11-12-s6a-customer-core.md spec/features/planned/F*-{auth-verifications-cleanup,approvals-at-resume,backfill-suspended-gate,operator-notices-web}/ticket.md`.
  - Done when: the files exist and pass the check.
  - Out of scope: decisions on the follow-ups.
