# F103 stage 08 — Convert the committer and the expiry job

Part of [`../plan.md`](../plan.md). Needs stage 01 landed. May run next to one other conversion stage.

Two steps.

## Step 1 — Convert 18 calls

**Goal.** Every log call in `modules/actions/committer.ts` and `modules/actions/expiry.ts` is an event (D5, D6, D7). Behaviour, DB writes and audit rows do not change.

**New field names** (each only if missing): number `applied`, `failed`, `retry`, `closed`, `sent`, `expired_timeout`, `expired_draft_missing`, `expired_not_notified`, `expired_not_seen`, `expired_held_timeout`. No new UUID or code name.

**Children.** Each committer function that handles one mailbox, and the per-mailbox loop of `expiry.ts`: `mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId })`.

**Errors.** Where the old text printed `label` (`describeError(error)`), the line takes `...errorFields(error)` of the same error. `label` stays where it goes into a DB row (`lastError`, audit data). If only the label is in scope, pass the error object down; never log the label.

File, old text (start) → event: fields. Levels stay.

- `committer.ts`: `committer: ACTIONS_SCOPE=off, N mailbox actions wait` → `committer_actions_held`: `mailbox_id`, `count`, `scope: "off"`, `config_key: "ACTIONS_SCOPE"`
- `committer.ts`: `committer …: SEND_SCOPE=…, N approved sends wait` → `committer_sends_held`: `mailbox_id`, `count`, `scope: sendScope.kind`, `config_key: "SEND_SCOPE"`
- `committer.ts`: `committer …: login failed, status is now auth_error` (×2) → `committer_auth_error`: (mailboxLog)
- `committer.ts`: `committer …: ${describeError}; the next tick tries again` → `committer_soft_error`: `...errorFields`
- `committer.ts`: `committer …: open failed:` → `committer_open_failed`: `...errorFields`
- `committer.ts`: `committer …: release failed:` (×3) → `committer_release_failed`: `...errorFields(releaseError)`
- `committer.ts`: `committer …: applied N, failed N, retry N[, closed N][, sent N]` → `committer_done`: `applied`, `failed`, `retry`, `closed`, `sent` (always all five)
- `committer.ts`: `committer …: expired N stale actions` → `committer_stale_expired`: `count`
- `committer.ts`: `committer …: sync folders failed:` → `committer_folders_failed`: `...errorFields`
- `committer.ts`: `committer …: facts failed:` → `committer_facts_failed`: `...errorFields`
- `committer.ts`: `committer …: close failed:` → `committer_close_failed`: `...errorFields`
- `committer.ts`: `committer … failed:` → `committer_failed`: `...errorFields`
- `expiry.ts`: `applied draft … has no folder or kind: no reverse row` → `draft_reverse_missing`: `action_id: draftId`
- `expiry.ts`: `expiry …: expired N (timeout …, draft_missing …, …)` → `expiry_done`: `mailbox_id`, `count: total`, `expired_timeout`, `expired_draft_missing`, `expired_not_notified`, `expired_not_seen`, `expired_held_timeout`
- `expiry.ts`: `expiry … failed:` → `expiry_failed`: `mailbox_id`, `...errorFields`

- Levels stay. `committer_done` keeps the old condition (it logs only when a count is above 0).
- The send-limit hold of F099 in the committer logs no old-form line at `560e74e7`; if one appears, convert it by D5 and list it.

**Decisions.** D2, D5, D6, D7, D16, D17.

**Test.**

1. Tests that matched an old text match the event text (at least `actions-committer.test.ts`, `actions-expiry.test.ts`, `actions-logs.test.ts` may).
2. `actions-logs.test.ts` and `actions-send-logs.test.ts` still prove that no line holds a recipient, a subject, a task, a draft text or an SMTP reply.
3. `actions-committer.test.ts` (or the file that runs one tick with a fixed `now`): the tick writes `committer_done` with `mailbox_id`, `org_id` and the five numbers.

**Done when.** No `no-restricted-syntax` message in the two files; the tests pass.

## Step 2 — Lint level and known alerts

- `eslint.config.js`: add `actions/committer.ts` and `actions/expiry.ts` to the `error` block (stage 09 replaces them with the folder).
- `log-lint.test.ts`: an old-form line at `modules/actions/committer.ts` gives `[2]`.
- Docs by D17. Known quotes: `expiry <mailboxId> failed` and the expiry counts.

**Done when.** No old text of the table in either doc; the Proof (`/tmp/f103-s08`) prints `PROOF_OK`; the final message gives the warning count, new field names and calls not in the table.

**Out of scope.** `apply.ts`, `drafts.ts`, `send.ts` (stage 09). Retries, statuses, audit data.
