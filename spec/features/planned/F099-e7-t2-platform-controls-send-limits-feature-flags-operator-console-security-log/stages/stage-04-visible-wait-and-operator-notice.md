# F099 stage 04 — Visible wait and operator notice

Part of [`../plan.md`](../plan.md). Read its D2, D8, D10, D11 (a), "Facts checked" and "Rules for every stage" first. Needs stage 03 (`SendLimitHit`, `CommitterDeps.sendLimits`, `CommitterDeps.onSendLimited`, `last_error = send_limit:<kind>`).

Three steps. About 220 changed lines.

- [ ] **4.1 The panel and digest phrase "approved, waiting: send limit"**
  - Goal: wherever the system describes a send (panel activity, digest, notices), a held send reads as waiting on the send limit.
  - Files:
    - change `packages/core/src/digest/would-do.ts` (`ActionView.waiting`, `WouldDoAction`, the send phrase);
    - change `packages/core/src/digest/would-do.test.ts`;
    - change the file that holds `listActionsForEmails` after F091 (`actions/repo/reads.ts`): select `last_error` and `next_attempt_at`, set `waiting`;
    - change `apps/server/test/integration/activity-repo.test.ts` or `reports-activity.test.ts` (one case; use the file that already builds send rows for the activity list).
  - Interfaces:

    ```ts
    // would-do.ts
    export interface ActionView {
      …; // unchanged fields
      waiting?: "send_limit"; // plan.md D11 (a): an approved send held by the send limit
    }
    export type WouldDoAction = Pick<ActionView, "type" | "status" | "folder" | "reverse" | "kind" | "delegateId" | "waiting">;
    // describeAction and describeActions: a send with status "approved" and waiting "send_limit" → "approved, waiting: send limit";
    // every other send phrase is unchanged (SEND_PHRASES).

    // listActionsForEmails: waiting = row.status === "approved" && sendLimitOfError(row.last_error) !== null && row.next_attempt_at !== null
    //   ? "send_limit" : undefined  (do not set the key at all when undefined: other tests compare whole objects)
    ```

  - Decisions: D11 (a). An auth-error release sets `next_attempt_at` to null, so a send that waits for a new password never reads as "waiting: send limit".
  - Test:
    1. `would-do.test.ts`: `describeAction({ type: "send", status: "approved", waiting: "send_limit", … })` is `"approved, waiting: send limit"`; without `waiting` it stays `"approved, sending"`; `describeActions` of `[flag (ready), that send]` is `"will flag; approved, waiting: send limit"`.
    2. Integration (activity or reports test): an approved send with `last_error = "send_limit:mailbox_hour"` and `next_attempt_at = NOW + 10 min` → its activity action phrase is `"approved, waiting: send limit"`; the same row with `next_attempt_at = null` → `"approved, sending"`; a row with `last_error = "smtp_421"` → `"approved, sending"`.
  - Check: `bun test packages/core/src/digest apps/server/test/integration/activity-repo.test.ts apps/server/test/integration/reports-activity.test.ts apps/server/test/integration/reports-digest.test.ts`; `bun run typecheck`.
  - Done when: tests 1–2 pass; no other phrase test changed.
  - Out of scope: a web change (the panel prints the server's phrase); the `/status` Telegram command.

- [ ] **4.2 The `held_timeout` text names the send limit**
  - Goal: a send that waited 48 h after the tap tells the user that the send limit can be the reason too.
  - Files: change `packages/core/src/digest/approvals.ts` (the `held_timeout` line) and `packages/core/src/digest/approvals.test.ts` (the expected text).
  - Interfaces: the line becomes exactly `⌛ Not sent: it waited 48 h after your approval and was not sent (held by SEND_SCOPE, the send limit or the mailbox state) · ${subject}`.
  - Decisions: D8. The view of `send_result` does not change, so rows queued before the deploy render with the new text (`docs/code-patterns.md` § Notices are facts: a text change is allowed; a view change is not).
  - Test: 3. The `held_timeout` case of `approvals.test.ts` expects the new line.
  - Check: `bun test packages/core/src/digest/approvals.test.ts packages/core/src/notices`; `bun test apps/server/test/integration/channels-notices.test.ts`.
  - Done when: test 3 passes; `grep -rn "held by SEND_SCOPE or the mailbox state" packages apps` finds nothing.
  - Out of scope: the other `SEND_SCOPE` texts (they speak of the scope only).

- [ ] **4.3 Operator notice `send_limit` and the wiring**
  - Goal: the committer of the server and of `job:run` uses the configured limits; the first hold of a mailbox in a UTC day reaches the operator once.
  - Files:
    - change `apps/server/src/modules/channels/operator.ts` (kind `send_limit`, `sendLimitReached`);
    - change `apps/server/src/composition.ts` (`committerDeps` input: `sendLimits`, `onSendLimited?`);
    - change `apps/server/src/main.ts` (pass `sendLimits(config)` and the callback; one start log line);
    - change `apps/server/src/scripts/job-run.ts` (pass `sendLimits(config)`; no callback);
    - change `apps/server/src/platform/log-fields.ts` (three field names);
    - change `apps/server/test/integration/channels-operator.test.ts`;
    - change `apps/server/test/integration/main-start-log.test.ts` (if it lists the start lines; else no change).
  - Interfaces:

    ```ts
    // channels/operator.ts
    export type OperatorNoticeKind = "trial_ending" | "llm_cap" | "auth_error_24h" | "auth_mail_failed" | "send_limit";
    // OperatorNotices: Called by the committer after a hold commits. Never throws, never blocks.
    sendLimitReached(ctx: TenantContext, hit: { mailboxId: string; limit: SendLimitKind; until: Date; at: Date }): void;
    //   key  = `send_limit:${hit.mailboxId}:${hit.at.toISOString().slice(0, 10)}`
    //   text = `Mailbox ${hit.mailboxId} of org ${ctx.orgId} hit the send limit ${hit.limit} at ${hit.at.toISOString()}; its sends wait until ${hit.until.toISOString()}.`
    //   same start/notify path and dedup as authMailFailed

    // composition.ts
    export function committerDeps(input: {
      db: Db; secrets: SecretBox; scope: ActionsScope; sendScope: SendScope;
      sendLimits: SendLimits;
      onSendLimited?: CommitterDeps["onSendLimited"];
    }): CommitterDeps;

    // main.ts, after `const scopeOfSends = …`
    const limitsOfSends = sendLimits(config);
    log.info("send_limits", { mailbox_hour: limitsOfSends.mailboxHour, mailbox_day: limitsOfSends.mailboxDay, recipient_day: limitsOfSends.recipientDay });
    // committerDeps({ …, sendLimits: limitsOfSends, onSendLimited: (ctx, hit) => operator.sendLimitReached(ctx, hit) })

    // log-fields.ts: add "mailbox_hour", "mailbox_day", "recipient_day" (numbers) to logFieldNames, in a "send limits" group
    ```

  - Decisions: D2, D10. A hold during `bun run job:run actions.committer` gets no operator notice (the script has no operator notifier); the next server run holds the send again and sends the notice.
  - Test (`channels-operator.test.ts`, the file's `withRollback` and `send` fake; `AT = 2026-11-20T10:00:00Z`):
    4. `sendLimitReached(ctx, { mailboxId, limit: "mailbox_hour", until: 10:10Z, at: AT })` → `idle()` → the fake got one text, exactly `Mailbox <mailboxId> of org <orgId> hit the send limit mailbox_hour at 2026-11-20T10:00:00.000Z; its sends wait until 2026-11-20T10:10:00.000Z.`; one `operator.notice` audit row with `data = { kind: "send_limit", key: "send_limit:<mailboxId>:2026-11-20" }`.
    5. A second call at `AT + 3 h` (same UTC day) → no second text. A call at `2026-11-21T00:30:00Z` → a second text.
    6. A fake `send` that throws → no throw out of `sendLimitReached`; no audit row; one error line with the label only.
    7. The text holds no `@`.
  - Check: `bun test apps/server/test/integration/channels-operator.test.ts apps/server/test/integration/main-start-log.test.ts apps/server/src/main.test.ts`; `bun run typecheck`; `bun run lint`.
  - Done when: tests 4–7 pass; `main.ts` and `job-run.ts` pass `sendLimits(config)`.
  - Out of scope: the Telegram notice to owners (stage 05); docs (stage 14).

## Done when

- Steps 4.1–4.3 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 04 (`/tmp/f099-s04`) prints `PROOF_OK`.
