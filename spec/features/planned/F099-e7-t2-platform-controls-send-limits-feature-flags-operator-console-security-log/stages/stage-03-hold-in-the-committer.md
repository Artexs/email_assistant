# F099 stage 03 — Hold in the committer [risky]

Part of [`../plan.md`](../plan.md). Read its D4, D6, D7, D8, D10, D12, "Facts checked" and "Rules for every stage" first. Needs stages 01 and 02 (`checkSendLimits`, `sendLimitError`, `DEFAULT_SEND_LIMITS`, `send_started_at`, `listRecentSends`, `markApplying({ sendStartedAt })`).

`[risky]`: sending to people and at-most-once. A review job checks it before the land; the reviewer tries to pass a limit with two committers or a crash between the hold and its commit.

One step. About 300 changed lines (most of them tests).

- [ ] **3.1 The limit check where a send becomes `applying`**
  - Goal: a send over a limit is not sent; it waits as `approved` until the window lets it go, with its reason, an audit row and one callback; two committers at once never pass a limit.
  - Files:
    - add `apps/server/src/modules/actions/send-limit.ts`;
    - change `apps/server/src/modules/actions/send.ts` (step 2 calls `startSendWithinLimits`; the held branch);
    - change the file that holds the send-row queries after F091 (`actions/repo/sends.ts`): add `lockMailboxSends`; list it in `actions/repo/index.ts`;
    - change the file that holds `ApplyDeps` after F091 (`actions/apply-shared.ts`, else `apply.ts`): two optional fields;
    - change `apps/server/src/modules/actions/committer.ts` (`CommitterDeps`: two optional fields, passed into `ApplyDeps`);
    - change `apps/server/src/modules/actions/index.ts` (export `SendLimitHit`);
    - change `apps/server/src/modules/audit/repo.ts` (`auditEvents.actionSendLimited`);
    - change `apps/server/src/modules/actions/transitions.ts` (row `E12`: one reason);
    - add `apps/server/test/integration/actions-send-limit.test.ts`.
  - Interfaces:

    ```ts
    // audit/repo.ts
    actionSendLimited: "action.send_limited", // data: limit, until, mailbox_id; reason_code send_limit

    // actions/repo/sends.ts — serializes the limit check of one mailbox until the transaction ends.
    // Shape of `lockMailboxLimit` (mail/repo): it throws outside a transaction.
    export async function lockMailboxSends(trx: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<void>;
    //   sql`SELECT pg_advisory_xact_lock(hashtextextended(${`send_limit:${ctx.orgId}:${mailboxId}`}, 0))`

    // ApplyDeps and CommitterDeps — both optional; absent = DEFAULT_SEND_LIMITS and no callback (old tests)
    sendLimits?: SendLimits;
    onSendLimited?: (ctx: TenantContext, hit: SendLimitHit) => void;

    // actions/send-limit.ts
    export interface SendLimitHit {
      mailboxId: string;
      limit: SendLimitKind;
      until: Date;
      at: Date; // the committer's now
    }

    export type SendStart = { kind: "started" } | { kind: "held"; hit: SendLimitHit } | { kind: "lost" };

    // plan.md D6. Runs inside the caller's transaction (step 2 of applySend):
    // 1. lockMailboxSends; 2. listRecentSends(since = now − 24 h); 3. checkSendLimits({ now, recent, to, limits });
    // ok   → markApplying({ outgoingMessageId, sendStartedAt: now }) and the `action.applying` audit row (today's data);
    //        false from markApplying → { kind: "lost" }
    // held → releaseAction({ toStatus: "approved", nextAttemptAt: until, countAttempt: false, now, lastError: sendLimitError(limit) })
    //        and recordAudit({ emailId, actionId, actor: "system", event: auditEvents.actionSendLimited,
    //          reasonCode: "send_limit", data: { limit, until: until.toISOString(), mailbox_id }, at: now });
    //        false from releaseAction → { kind: "lost" }
    export async function startSendWithinLimits(
      trx: Transaction<DB>,
      ctx: TenantContext,
      input: {
        action: ClaimedAction;
        mailboxId: string;
        to: readonly string[]; // payload.to of the parsed send payload
        kind: string; // payload.kind, for the applying audit row
        outgoingMessageId: string;
        limits: SendLimits;
        now: Date;
      }
    ): Promise<SendStart>;
    ```

    `send.ts` step (2) becomes:

    ```ts
    const start = await inTransaction(deps.db, (trx) =>
      startSendWithinLimits(trx, ctx, { action, mailboxId: deps.mailboxId, to: payload.to, kind: payload.kind,
        outgoingMessageId: message.messageId, limits: deps.sendLimits ?? DEFAULT_SEND_LIMITS, now }));
    if (start.kind === "lost") return { kind: "lost" };
    if (start.kind === "held") {
      log.info("send_limited", { action_id: action.id, mailbox_id: deps.mailboxId, kind: start.hit.limit });
      try { deps.onSendLimited?.(ctx, start.hit); } catch (error) { log.warn("send_limited_callback_failed", { action_id: action.id, ...errorFields(error) }); }
      return { kind: "retry", soft: false };
    }
    // (3) the SMTP call, as today
    ```

    `transitions.ts` row `E12`: add the reason `"send limit"` and the caller `"send-limit.ts"` (it calls `releaseAction`).
  - Decisions: D4, D6 (the lock, the transaction, the outcome), D7 (`recoverSend` is not touched), D8 (no attempt counted; `approved_at` unchanged), D10 (the callback after the commit, never awaited, never throws out), D12 (`now` from `deps.now()`).
  - Rules for this step:
    - The check and `markApplying` are in one transaction under the lock; nothing else moves between them. Do not call `checkSendLimits` outside that transaction.
    - The held branch makes no SMTP call and does not open the sender. (The committer opened it already for the batch; it closes it as today.)
    - Do not change `recoverSend`, `sendFailed`, `composeFailed` or the soft-cap rule (D9).
  - Test (`actions-send-limit.test.ts`; `withRollback` except case 6; rows from `createOrgWithMailbox` and `insertDraftAndSend`; claimed rows through `claimActions` as in `actions-send.test.ts`; the `ApplyDeps` builder of `actions-send.test.ts` copied with `sendLimits` and `onSendLimited` added; `NOW = 2026-11-20T10:00:00Z`; a local helper `insertCountedSends(trx, ctx, mailboxId, times, to)` inserts `applied` sends with `send_started_at` set by one `UPDATE`; `hits` collects `onSendLimited` calls):
    1. 20 counted sends at −50…−31 min; one approved send to `n@x.test` → `applySend` returns `{ kind: "retry", soft: false }`; the fake sender has 0 calls; the row is `approved`, `locked_at` null, `next_attempt_at = 2026-11-20T10:10:00Z`, `last_error = "send_limit:mailbox_hour"`, `attempts` unchanged, `approved_at` unchanged, `send_started_at` null; exactly one `action.send_limited` audit row with `reason_code = "send_limit"` and data `{ limit: "mailbox_hour", until: "2026-11-20T10:10:00.000Z", mailbox_id: <id> }`; no `action.applying` row for it; `hits` = `[{ mailboxId, limit: "mailbox_hour", until: 10:10Z, at: NOW }]`.
    2. Same rows, through `createCommitterJob` with `now` = `NOW`, then `NOW + 5 min`, then `2026-11-20T10:10:00Z`: the first run holds it, the second does not claim it (sender 0 calls, still one audit row), the third sends it (sender 1 call; row `applied`; `send_started_at = 10:10Z`).
    3. 5 counted sends to `dlg@x.test` at −10, −8, −6, −4, −2 h; an approved send to `DLG@x.test` → held, `last_error = "send_limit:recipient_day"`, until `2026-11-21T00:00:00Z`.
    4. 19 counted sends at −50…−32 min → the send goes out; `send_started_at = NOW`; `hits` empty.
    5. 20 sends at −50…−31 min in status `failed` / `smtp_rejected` with `send_started_at` set → the send goes out (they do not count).
    6. Two committers at once (committed rows, not `withRollback`; two pools `testDb()`; the organization is deleted in `afterAll`): 19 counted sends at −50…−32 min; two approved sends A and B of the mailbox, both claimed. In `db1.transaction().execute(async (trx) => { … })`: `lockMailboxSends(trx, ctx, mailboxId)`, then mark one more counted send `applying` with `send_started_at = NOW` (the 20th); start `pB = applySend(depsOn(db2), ctx, B, provider)` without awaiting; `waitFor` (from `apps/server/test/wait-for.ts`) until `pg_locks` has an advisory lock with `granted = false`; return (commit). Then `await pB` → `{ kind: "retry", soft: false }`; B is held with `last_error = "send_limit:mailbox_hour"`; the sender of `depsOn(db2)` has 0 calls. (Without the lock, `waitFor` times out: the test proves the lock.)
    7. An `applying` send (a crash after step 2) with 20 counted sends in the hour → the recovery runs as today (`locateByActionId`; with no copy in Sent the row ends `failed` / `outcome_unknown`); no `action.send_limited` row.
    8. A batch with a held send and a `flag` action on a later mail of the same mailbox → the flag is applied in the same run (the held send does not stop the batch).
    9. `onSendLimited` that throws → `applySend` still returns `{ kind: "retry", soft: false }`; the row is held; one `send_limited_callback_failed` warn line.
    10. Logs (capture as in `actions-send-logs.test.ts`): case 1 writes one `send_limited` line with `action_id`, `mailbox_id`, `kind: "mailbox_hour"`; no captured line holds `@x.test` or `dropped_fields`.
    11. `lockMailboxSends` outside a transaction throws.
  - Check: `bun test apps/server/test/integration/actions-send-limit.test.ts apps/server/test/integration/actions-send.test.ts apps/server/test/integration/actions-committer.test.ts apps/server/test/integration/actions-transitions.test.ts apps/server/test/integration/actions-send-logs.test.ts apps/server/test/integration/actions-end-to-end.test.ts`; `bun run typecheck`; `bun run lint`.
  - Done when: tests 1–11 pass; the existing send, committer and transitions tests pass unchanged except the `E12` reason list.
  - Out of scope: the wiring in `main.ts` and `composition.ts` and the operator notice (stage 04); the panel phrase (stage 04); the Telegram notice (stage 05).

## Done when

- Step 3.1 is done and committed by explicit paths.
- The Proof command of `plan.md` for stage 03 (`/tmp/f099-s03`) prints `PROOF_OK`.
