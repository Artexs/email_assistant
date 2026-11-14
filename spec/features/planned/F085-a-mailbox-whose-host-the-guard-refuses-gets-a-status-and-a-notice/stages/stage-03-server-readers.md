# F085 stage 03 — Server readers: pause and resume, expiry, `/status`, taps, operator count, `org:status`

Part of [`../plan.md`](../plan.md). Read its D10, D11, D12, D13, "Rules for every stage" first. Needs stage 01 (the texts, `HeldBy`) and stage 02 (the DB and the server type accept `host_blocked`).

No migration. Three normal steps, about 250 changed lines. After this stage every server reader of the mailbox status names `host_blocked` correctly. No code sets it yet (stage 05).

Tests set the status by hand (`setMailboxStatus(trx, ctx, mailboxId, "host_blocked", at)` from `apps/server/src/modules/mail/repo`, or an `updateTable("mailboxes")` as the files already do).

- [ ] **3.1 Pause and resume refuse it; the expiry walks it**
  - Goal: a blocked mailbox cannot be paused or resumed (web and Telegram say why), and a held send of it still expires.
  - Files:
    - `apps/server/src/modules/mail/status.ts`: `SwitchResult` gains `| { kind: "host_blocked" }`. The end of `run` becomes an exhaustive `switch (mailbox.status)` with no `default` (D10): `auth_error` → `{ kind: "auth_error" }`, `host_blocked` → `{ kind: "host_blocked" }`, `active` and `paused` → `{ kind: "already", mailbox }`. `changed` and `not_found` stay as they are.
    - `apps/server/src/modules/mail/routes.ts:78`: `auth_error` or `host_blocked` → `409 { error: "wrong_status" }`.
    - `apps/server/src/modules/channels/commands.ts` (`switchMailboxes`, line 229): a helper `skipText(mailbox.status, address, texts)` with an exhaustive `switch`: `auth_error` → `texts.loginError(address)`, `host_blocked` → `texts.hostBlocked(address)`, `active` / `paused` → `null`. A mailbox with a skip text is not switched (its text goes to `extra`). After `switchMailboxStatus`, the result `auth_error` → `texts.loginError(address)` (as now) and `host_blocked` → `texts.hostBlocked(address)` (the status changed between the list and the switch).
    - `apps/server/src/modules/actions/expiry.ts:196`: `statuses: ["active", "paused", "auth_error", "host_blocked"]`.
    - Tests: `apps/server/test/integration/mail-status.test.ts`, `web-mailboxes.test.ts`, `channels-commands.test.ts`, `actions-expiry.test.ts`, `mail-remove.test.ts`.
  - Interfaces:

    ```ts
    // apps/server/src/modules/mail/status.ts
    export type SwitchResult =
      | { kind: "changed"; mailbox: MailboxSummary }
      | { kind: "already"; mailbox: MailboxSummary }
      | { kind: "auth_error" }
      | { kind: "host_blocked" }
      | { kind: "not_found" };
    ```

  - Decisions: D10, D11, D12.
  - Test:
    1. `mail-status.test.ts` (mirror "an auth_error mailbox stays as it is", line 95): a `host_blocked` mailbox, `switchMailboxStatus(..., { to: "paused" })` and `{ to: "active" }` → `{ kind: "host_blocked" }` both; the row stays `host_blocked` with the same `status_changed_at`; no `mailbox.paused` or `mailbox.resumed` audit row.
    2. `web-mailboxes.test.ts` (mirror the `wrong_status` case near line 219): `POST /api/mailboxes/:id/pause` and `/resume` on a `host_blocked` mailbox (owner session) → `409 { error: "wrong_status" }`.
    3. `channels-commands.test.ts` (mirror "an auth_error mailbox stays auth_error", line 476): an organization with one `active` and one `host_blocked` mailbox; `/pause` (`pauseMailboxes`) → the text holds `⏸ Paused: <active address>` and the line `⛔ <blocked address>: its mail server is not allowed; the system checks it again at each sync.`; the blocked row is unchanged. `/resume` after it → the same skip line.
    4. `mail-remove.test.ts`: `removeMailbox` of a `host_blocked` mailbox → `{ kind: "removed" }`, the row is gone, the audit row `mailbox.removed` exists, and no `mailbox.paused` row was written.
    5. `actions-expiry.test.ts` (mirror "(5) a paused mailbox is walked", line 216): a `host_blocked` mailbox with a send notified 49 h ago → the expiry run sets it `expired`.
  - Check: `bun test apps/server/test/integration/mail-status.test.ts apps/server/test/integration/web-mailboxes.test.ts apps/server/test/integration/channels-commands.test.ts apps/server/test/integration/actions-expiry.test.ts apps/server/test/integration/mail-remove.test.ts apps/server/src/modules/mail`.
  - Done when: tests 1–5 pass; the existing tests of these files pass unchanged.
  - Out of scope: the way out (stage 04).

- [ ] **3.2 `/status` and the tap answers name the cause**
  - Goal: `/status` shows the state; an owner who approves a send of a blocked mailbox learns that it waits and why.
  - Files:
    - `apps/server/src/modules/channels/commands.ts`: `statusText` (line 171) becomes an exhaustive `switch (mailbox.status)`: `active` → `t.stateActive`, `paused` → `t.statePaused(since)`, `auth_error` → `t.stateAuthError(since)`, `host_blocked` → `t.stateHostBlocked(since)`. `approvedText` (line 125): the mailbox state first, as now, with a `switch` on `mailbox?.status`: `paused` → `t.approvedPaused(total)`, `auth_error` → `t.approvedAuthError(total)`, `host_blocked` → `t.approvedHostBlocked(total)`, `active` or no mailbox → the scope lines as now.
    - `apps/server/src/modules/channels/callbacks.ts`: replace the three `"scope" | "paused" | "auth_error"` unions (the `edit` extra near line 205, `heldReason`, `heldReasonOfAny`) with `HeldBy` from `@ea/core`. `heldAnswers` returns `{ scope: taps.approvedHeld, paused: taps.approvedPaused, auth_error: taps.approvedAuthError, host_blocked: taps.approvedHostBlocked }` typed `Record<HeldBy, string>`. `heldReason`: an exhaustive `switch (mailbox.status)` before the scope check: `paused` → `"paused"`, `auth_error` → `"auth_error"`, `host_blocked` → `"host_blocked"`, `active` → the scope check as now. `getMailbox` returns `MailboxRow`, whose `status` is a `string` (`mail/repo/mailboxes.ts:10`): parse it with `mailboxStatusSchema` before the `switch` (a wrong value then throws, as `listMailboxes` does). The schema is not exported from the module yet: add `mailboxStatusSchema` to the exports of `mail/repo/index.ts` and `mail/index.ts`, and import it from `../mail`.
    - Tests: `apps/server/test/integration/channels-commands.test.ts`, `channels-callbacks.test.ts`.
  - Interfaces: `HeldBy` (stage 01, `@ea/core`).
  - Decisions: D10, D12.
  - Test:
    1. `channels-commands.test.ts`, "status, late sync and never synced" (line 262): `setBox({ status: "host_blocked", status_changed_at: 2026-11-06T09:40:00Z })` → the text contains `Status: mail server not allowed since 10:40 (checked again at each sync)`.
    2. The approvals test near line 195: after the `auth_error` case, set `host_blocked` → the text contains `1 approved, held: the mail server is not allowed` and not `SEND_SCOPE=off`.
    3. `channels-callbacks.test.ts`, "(5a) a paused or auth_error mailbox holds the send and names the cause" (line 553): add a `host_blocked` case → the answer equals `textTables.en.bot.taps.approvedHostBlocked`, and the card edit holds `The mail server is not allowed, so the send waits; /status shows it.`
    4. "(7) approve set approves both" (line 616) with the mailbox set `host_blocked` before the tap → the answer holds `textTables.en.bot.taps.heldNotes.host_blocked`; "(8) send again on a failed send" (line 668) with the mailbox set `host_blocked` before the tap → `textTables.en.bot.taps.sendAgainHeld.host_blocked`.
  - Check: `bun test apps/server/test/integration/channels-commands.test.ts apps/server/test/integration/channels-callbacks.test.ts apps/server/src/modules/channels`.
  - Done when: tests 1–4 pass; the existing assertions of both files pass unchanged.
  - Out of scope: other texts of `/status`.

- [ ] **3.3 Operator count and `org:status`**
  - Goal: the operator sees blocked mailboxes in the organization list and in `org:status`.
  - Files:
    - `packages/core/src/web/operator.ts:38`: the `mailboxes` object gets `hostBlocked: z.number().int()` after `authError`.
    - `apps/server/src/modules/operator/service.ts:76`: `hostBlocked: count("host_blocked")`.
    - `apps/web/src/components/operator/OrgTable.tsx`: the cell becomes `${org.mailboxes.total} / ${org.mailboxes.authError} / ${org.mailboxes.hostBlocked}`; `apps/web/src/i18n/en.ts` and `pl.ts`: `op_col_mailboxes` gets the D9 text.
    - `apps/server/src/scripts/org-status-lines.ts:44`: `… auth_error=${count("auth_error")} host_blocked=${count("host_blocked")} last_sync=…`.
    - Tests: `apps/server/test/integration/web-operator-orgs.test.ts` (the expected `mailboxes` objects near lines 168 and 178 gain `hostBlocked`), `apps/server/test/integration/org-cli.test.ts:213` (the line pattern gains `host_blocked=0`).
  - Interfaces: `OperatorOrgRow["mailboxes"]` = `{ total, active, paused, authError, hostBlocked }`.
  - Decisions: D13.
  - Test:
    1. `web-operator-orgs.test.ts`: an organization with one `active` and one `host_blocked` mailbox → `mailboxes: { total: 2, active: 1, paused: 0, authError: 0, hostBlocked: 1 }`.
    2. `org-cli.test.ts`: the line matches `/^ {2}mailboxes total=2 active=1 paused=0 auth_error=1 host_blocked=0 last_sync=(never|\S+)$/` for the existing case.
    3. `apps/web/src/i18n/i18n.test.ts` passes.
  - Check: `bun test apps/server/test/integration/web-operator-orgs.test.ts apps/server/test/integration/org-cli.test.ts apps/web/src/i18n`; `bun run typecheck`.
  - Done when: tests 1–3 pass.
  - Out of scope: an operator notice (D21); the operator detail page (it uses `StatusBadge`, stage 01).

## Done when

- Steps 3.1–3.3 are done and committed by explicit paths.
- `grep -rn '"scope" | "paused" | "auth_error"' apps/server/src packages/core/src` prints nothing.
- The Proof command of `plan.md` for stage 03 (`/tmp/f085-s03`) prints `PROOF_OK`.
