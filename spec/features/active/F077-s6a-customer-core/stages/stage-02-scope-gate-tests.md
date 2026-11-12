# s6a-customer-core — Stage 2

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A1, A5, "Rules for every step", and the master plan's D1 and D2 first.

## Stage 2 — Two-organization gate tests [risky]

After stage 1, `all` reaches every mailbox. This stage proves that the other gates (the mode, the `auto` flags, the switches, the tap) still hold for a second organization. It adds tests only; a failing test means a gap in the gates → stop and tell the main session (do not change a gate rule without a decision).

- [ ] **2.1 `scope-two-orgs.test.ts`: triage, actions and sends for two organizations under `all`**
  - Goal: one integration file shows D2 end to end for two organizations, so a later change that breaks a gate fails a named test.
  - Files: create `apps/server/test/integration/scope-two-orgs.test.ts`. Reuse the helpers of `triage-job.test.ts` (`fakeLlm`, `job`, `mailboxWithSettings`), `actions-committer.test.ts` (`jobFor`, `openerFor`, `addBox`, `addMail`) and `fixtures.ts` (`createOrgWithMailbox`, `insertTestEmail`, `insertTriagedWithActions`, `insertDraftAndSend`, `pauseOtherMailboxes`). If a helper is local to its test file, copy the few lines into the new file (do not export test internals from another test file). Mode and policy changes go through the config service (`setMode`, `setCategoryAuto` with the `settingsDeps` builder, see `config-settings.test.ts:108`), not by SQL.
  - Interfaces: none new.
  - Decisions:
    - "Only `logged` action rows" (segment "Done when") means: in `shadow`, no row of a mailbox-changing type (`move`, `mark_read`, `flag`, `create_draft`, `send`) has a status other than `logged`. `save_summary` is a DB-only action and is `ready` in every mode (`docs/architecture.md` §4.3, row "Save summary (DB only): apply"). The tests assert exactly this.
    - Each test runs in `withRollback`, calls `pauseOtherMailboxes(trx)` first, and creates org A and org B with `createOrgWithMailbox` (two different organizations, not two mailboxes of one).
    - Scope values: triage `{ kind: "all" }`, actions `{ kind: "all" }`, send `{ kind: "all" }`.
  - Test (fixed `now` = `2026-11-12T10:00:00Z` for every job and service call; mail `received_at` = `now − 1 h`):
    1. "two organizations: both mailboxes are triaged under all": one pending mail in A and one in B; one triage run → two prompts, both mails `triaged`, a `triage_results` row in each organization (tenant filter: each row's `org_id` is its mailbox's org).
    2. "shadow: no mailbox-changing action leaves logged": B in `shadow` (the default); the fake LLM answers `info` with a summary → B's actions: `save_summary` `ready`, `move` `logged`; no other status for a mailbox-changing type. Then one committer run with `{ kind: "all" }` → the opener is never called for B's mailbox (`opener.calls` does not hold B's address), B's `move` stays `logged`.
    3. "assist with auto off: the move is logged": B in `assist` (`setMode` with `keepSwitches: false`), `auto` off for `info` → the `move` is `logged`.
    4. "assist with auto on: the move is applied by the committer": B in `assist`, `setCategoryAuto(deps, ctx, mailboxId, { category: "info", auto: true, gate: { decision: "skipped", precision: null, kept: 0, forced: true }, actor: "test" })` (`forced: true` skips the go/no-go check, `config/service.ts:215-230`) → the `move` is `ready`; one committer run → `applied`, and the fake IMAP server of B shows the mail in `AI/Info` (or the folder of `folderMap`), and A's mail is not touched.
    5. "send under all needs the tap": B in `assist` with `create_draft` on; `insertDraftAndSend` with the draft `applied` and the send `awaiting_approval` → one committer run → the send stays `awaiting_approval` and the fake SMTP sender has no call. Then approve it with `approve` of `actions/approvals.ts` (the service of the Telegram tap; `now` + 1 min) → the next committer run sends it (`applied`, one SMTP call with B's recipient) and A has no SMTP call.
    6. "synthetic scope still limits both organizations": triage `{ kind: "synthetic" }` with one synthetic and one real mail in each organization → only the two synthetic mails are triaged.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the six tests pass; no source file changed (if one had to change, the stage stopped and the main session decided).
  - Out of scope: the `suspended` gate (stage 6); a mailbox in `paused` or `auth_error` (existing tests cover them).
