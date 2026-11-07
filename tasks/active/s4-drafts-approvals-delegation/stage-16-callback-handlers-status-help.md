# s4-drafts-approvals-delegation — Stage 16

Part of [`../s4-drafts-approvals-delegation.md`](../s4-drafts-approvals-delegation.md). Read that file's "Input" and "Rules for every step" first.

## Stage 16 — Telegram: the taps (approve, reject, set, send again, done), `/status`, `/help` [risky]

Why risky: a tap is the approval record of ADR 0003. The handler must check the owner role and the tenant, answer the same for an unknown id and another organization's id, and never leak state across organizations.

- [ ] **16.1 The tap handlers (D18, D26)**
  - Goal: an owner's tap approves or rejects a send (or a set), asks for a resend, or closes a delegation; the tapped message shows the outcome; every other case gets a short, honest answer.
  - Files: change `apps/server/src/modules/channels/callbacks.ts`, `channels/repo.ts` (`findOutboxByDedup(db, ctx, userId, dedupKey): Promise<{ id; text } | undefined>`), `channels/texts.ts`, `channels/telegram/runtime.ts` and `channels/commands.ts` (`CallbackDeps` and `CommandDeps` gain `hooks: DelegationHooks`, `uidplus(ctx, mailboxId)`, `sendScope: SendScope`; `createUpdateHandlers` (`commands.ts:222-226`) builds `CallbackDeps` field by field today, `{ db: deps.db, now: deps.now, actionsScope: deps.actionsScope }`, so it passes the three new fields too: M12), `apps/server/test/integration/channels-callbacks.test.ts`.
  - Interfaces:

    ```ts
    export interface CallbackDeps {
      // channels/callbacks.ts:19-23 (S3): db, now, actionsScope stay; the Undo tap reads deps.actionsScope (`callbacks.ts:69`)
      db;
      now(): Date;
      actionsScope: ActionsScope;
      hooks: DelegationHooks;
      uidplus(ctx, mailboxId): Promise<boolean>;
      sendScope: SendScope;
    }
    export const APPROVAL_TEXTS = {
      owner_only: "Only an owner can approve or reject a send.",
      approved: "⏳ Sending within a minute.",
      approved_held: "Approved. Sending is held by SEND_SCOPE on the server; /status shows it.",
      approved_paused: "Approved. The mailbox is paused, so the send waits; /status shows it.",
      approved_auth_error:
        "Approved. The mailbox login fails, so the send waits until the password is fixed; /status shows it.",
      already_approved: (clock: string) => `Already approved ${clock}.`,
      sending: "Already approved, sending now.",
      sent: "Already sent.",
      rejected: "This send was rejected.",
      expired: "This approval expired (48 h). The mail was not sent.",
      failed: "This send failed. See the result notice.",
      rejected_now: "✖️ Rejected. The draft will be removed.",
      not_found: "This mail is not in your account.", // the S2 text
      send_again: "⏳ A new send was approved. Sending within a minute.",
      send_again_already: "A resend was already approved for this mail.",
      send_again_not_failed: "This send is not in a failed state.",
      send_again_draft_gone: "The draft is gone: the mail must be triaged again.",
      done: "✅ Done.",
      done_already: "Already done.",
    };
    ```

  - Decisions:
    - **Order in `handleCallback` (M12).** Today `handleCallback` calls `getLabelTarget(deps.db, ctx, callback.emailId)` for every kind except `cancel` (`callbacks.ts:63`). The six new kinds carry an action, set or delegation id and no `emailId`: handle them right after the `cancel` branch and before `getLabelTarget` (one `switch` or early returns); the S2 and S3 kinds keep the `getLabelTarget` path.
    - `handleCallback`, new kinds (after `parseCallback`; the S2 and S3 kinds unchanged): `approve`, `reject`, `approve_set`, `reject_set`, `send_again` → `link.role !== "owner"` → `{ answer: owner_only }` before any query. `delegation_done` → every member.
    - `approve`: `result = approve(db, ctx, actionId, { userId: link.userId, via: "telegram", now })`; `approved` → the held check: `send = getSend(actionId)`, `mailbox = getMailbox(send.email.mailbox_id)`, `admits = sendScopeAdmits(sendFilterFor(deps.sendScope, mailbox.address), payload.to)` (a pure helper in `actions/scope.ts`: `none` → false, `self` → every address in the list, `all` → true); `heldBy` = `!admits` → `scope`, else `mailbox.status === "paused"` → `paused`, else `mailbox.status === "auth_error"` → `auth_error`, else none (the S3 committer claims nothing of a mailbox that is not `active`, so the toast "within a minute" would be false: review round 2 N17, the S3 D10 held pattern) → answer `approved`, or `approved_held` / `approved_paused` / `approved_auth_error`; `edit` = `approvalEdit({ original, outcome: heldBy ? "approved_held" : "approved", heldBy, at: now, timeZone, actionId })` (stage 14: the held variant keeps the `[✖️ Reject]` button, so the user can still cancel a held send; `reject` accepts an `approved` row with `locked_at` null) where `original` = `findOutboxByDedup(db, ctx, link.userId, approval:<actionId>)?.text ?? ""` (an empty original → no edit, only the answer); `expired` (the 48 h passed before the tap: `approve` expired the row) → the `expired` text and the `rejected`-style edit with `⌛ Expired <HH:MM>.`; `already_approved` → the clock of `at` in the organization timezone; the other kinds → their texts, no edit (the message of another owner stays as it is; a second tap on the same message after an edit cannot happen: the buttons are gone).
    - `reject`: `reject({ db, hooks, uidplus }, ctx, actionId, …)` → `rejected` → answer `rejected_now`, `edit` with `"rejected"`; `already` → the text of that status (`sent` for `applied`, `sending` for `applying` / locked `approved`, `rejected`, `expired`, `failed`); `not_found` → the S2 text.
    - `approve_set` / `reject_set`: `approveSet` / `rejectSet` → answer `⏳ <approved> reminders go out within a minute, <skipped> skipped.` / `✖️ <rejected> reminders skipped.`; `edit` with `approved_set` / `rejected_set` and the counts from the `approval_set:<setId>` outbox row text; a set with 0 affected rows → `Nothing to approve: the reminders were handled already.` and no edit.
    - `send_again`: `sendAgain(db, ctx, actionId, …)` → `created` → `send_again`, `edit` of the `send_result:<actionId>` message with `"approved"`; `already` → `send_again_already` (no edit); `not_failed` → `send_again_not_failed`; `draft_gone` → `send_again_draft_gone`; `not_found` → the S2 text.
    - `delegation_done`: `closeDelegation(trx, ctx, delegationId, { actor: link.userId, at: now })` in one transaction → `done` (`edit` of the `delegation_answered:<id>` message with `"done"`), `already`, `not_found` (the S2 text).
    - The tenant comes from the link; every service call carries `ctx = { orgId: link.orgId, userId: link.userId }`. The handler logs the kind and the ids only.
    - `/help` gets the lines `📤 under an approval sends the draft; ✖️ rejects it (the draft is removed).` and `✅ Done under an answered delegation closes it.`
  - Test (`channels-callbacks.test.ts`, `withRollback`, fixtures; org A owner O1 and O2 linked, assistant A linked; an `approval` outbox row per owner (inserted by the fixture or by running `detectApprovals`); `sendScope` `{ kind: "all", mailboxAddress: <fixture address> }` unless said otherwise; `hooks` recording; `uidplus` true): (1) O1 taps `ap:<id>` → `approved` text, the row `approved` by O1, `edit.text` = the outbox text + `⏳ Approved HH:MM, sending.` with no buttons; (2) O2 taps the same → `Already approved HH:MM.`, no edit; (3) A taps → `owner_only`, the row unchanged; (4) a tap on `ap:` of org B's send and of a random uuid → the S2 not-found text; (5) `sendScope` `off` → `approved_held`, the row still `approved`, the edit keeps one `[✖️ Reject]` button; then `ar:<id>` → `rejected_now` and the row `rejected`; (5a) the mailbox `paused` with `sendScope` `all` → `approved_paused`, the edit with the paused line and the `[✖️ Reject]` button; `auth_error` → `approved_auth_error`; (5b) a row with `notified_at` 49 h ago → the `expired` text, the row `expired` / `timeout`, no `approved_by`; (6) O1 taps `ar:<id>` on an `awaiting_approval` send → `rejected_now`, the row `rejected`, a reverse draft row, `hooks.onCancelled`, the edit with `✖️ Rejected`; a tap `ap:` after it → `rejected`; (7) `as:<setId>` with two waiting sends → both `approved`, the answer with `2 reminders`, the edit with the counts; `rs:` on the same set → `Nothing to approve…`; (8) `ag:<id>` on `failed` / `outcome_unknown` → a new `approved` row, the answer, the edit of the result message; the same tap again (and by O2) → `send_again_already`, still one new row; on an `applied` row → `send_again_not_failed`; (9) `dd:<delegationId>` by the assistant → `done`, the delegation `done`, audit with the assistant's user id; again → `done_already`; (10) a forged `ap:nope` → the S2 "not valid" text; (11) the S2 and S3 taps still work (one assertion each: `fr:`, `fu:`).
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: `/status` (16.2), the runtime wiring (stage 18).

- [ ] **16.2 `/status` and `/help` lines (D16, D25)**
  - Goal: `/status` shows the approvals that wait, the sends held by the scope, the send scope and the open delegations.
  - Files: change `apps/server/src/modules/channels/commands.ts`, `channels/texts.ts`, `apps/server/test/integration/channels-commands.test.ts`.
  - Decisions:
    - After the S3 `Actions:` line: `Approvals: <waiting> waiting for your tap` + (` (oldest <clock>)` when `oldestNotifiedAt`) + ` · <approvedHeld> approved, held` when `approvedHeld > 0` (`countApprovals`); `Send: <off | only to your test addresses (SEND_SCOPE=self) | real delegates of the test mailbox (SEND_SCOPE=all)>`; `Delegations: <open> waiting for a reply, <overdue> overdue` (`countOpenDelegations`). The held part names the cause (the same order as the toast of 16.1, review round 3): the mailbox `paused` → `<n> approved, held: the mailbox is paused`; `auth_error` → `<n> approved, held: the mailbox login fails`; else the scope is not `all` → `<n> approved, held by SEND_SCOPE=<kind>`; else (`all`, an `approved` row with `locked_at` null) → `<n> approved, in a retry wait`. `/status` shows one line per mailbox when the organization has more than one. The `/help` lines of 16.1.
  - Test (`channels-commands.test.ts`): `/status` with one waiting send (notified 2 h ago) and one approved under scope `off` → `Approvals: 1 waiting for your tap (oldest HH:MM) · 1 approved, held by SEND_SCOPE=off`; the mailbox paused → `held: the mailbox is paused`; `Send: off`, `Delegations: 0 waiting for a reply, 0 overdue`; with scope `self` → the `self` text; with two delegation rows → the counts; `/help` has the two new lines.
  - Check: `bun run lint && bun run typecheck && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: a web page (S5).
