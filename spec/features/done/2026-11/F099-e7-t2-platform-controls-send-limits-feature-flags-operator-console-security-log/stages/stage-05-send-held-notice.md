# F099 stage 05 — Notice `send_held` [risky]

Part of [`../plan.md`](../plan.md). Read its D11 (b), D12, "Rules for every stage" and `docs/code-patterns.md` § Notices are facts and § Add a notice kind first. Needs stages 03 and 04 (held sends with `last_error = send_limit:<kind>`; `sendLimitOfError`).

`[risky]`: a migration (the `outbox.kind` CHECK) and a message to people. A review job checks it before the land. No other migration of any ticket may be in build while this stage runs. After the land the coordinator runs `bun run db:migrate` on the shared dev DB (plan.md step C1).

One step (the checklist "Add a notice kind", steps 1–5, plus the hourly scan of plan.md D10). About 320 changed lines.

- [ ] **5.1 The notice kind `send_held`**
  - Goal: each owner with a linked Telegram chat learns once per mailbox and UTC day that sends of a mailbox wait on the send limit, how many wait, and when the next one goes out.
  - Files (the checklist order):
    - core: change `packages/core/src/notices/kinds.ts` (`"send_held"` after `"mailbox_removed"`), `views.ts` (`sendHeldView`), `renderers.ts` (entry), `packages/core/src/digest/notices.ts` (`renderSendHeldNotice`), and their tests (`packages/core/src/digest/notices.test.ts`, `packages/core/src/notices/registry.test.ts` if it lists kinds);
    - migration: add `db/migrations/<build day>100002_outbox_send_held.sql` (a timestamp later than the newest file, also later than stage 02's file); `bun run db:types` (no type change expected: `kind` is `string`);
    - server: change the file that holds the held-send queries after F091 (`actions/repo/notify.ts`, the notice queries): add `listSendLimitHolds`; list it in `actions/repo/index.ts` and `actions/index.ts`; add `apps/server/src/modules/channels/notices/send-held.ts`; change `channels/notices/index.ts` (`detectors`: after `sendResultDetector`);
    - change `apps/server/src/modules/channels/operator.ts`: `run()` gets a fourth part `runSendLimits(now)`: for each organization of `listOrganizations` (skip `suspended`), `listSendLimitHolds({ orgId }, now)`, and for each hold the `sendLimitReached` key and text with `at = now`, `limit = sendLimitOfError(lastError)`, `until = nextAt` (plan.md D10: the catch for a lost callback);
    - tests: change `apps/server/test/integration/channels-notices.test.ts`, `channels-operator.test.ts`, `telegram-schema.test.ts` (the CHECK list), `channels/notices/registry.test.ts`;
    - docs: the `outbox` row of `docs/architecture.md` §5 (kind and dedup key) and the `channels` table of `docs/modules.md` §3.8.
  - Interfaces:

    ```ts
    // views.ts — strict, as the other views (`text`, `id`, `isoDate`, `timeZone` are the file's helpers)
    const sendHeldView = z.strictObject({
      mailboxId: id,
      address: text, // the mailbox's own address, as in auth_error
      limit: z.enum(sendLimitKinds),
      waiting: z.number().int().min(1),
      nextAt: isoDate,
      now: isoDate,
      timeZone,
    });

    // digest/notices.ts
    export function renderSendHeldNotice(input: {
      address: string; mailboxId: string; limit: SendLimitKind; waiting: number; nextAt: Date; now: Date; timeZone: string;
    }): OutMessage;
    //   text, two lines joined by "\n", no buttons:
    //   `⏸ Sends from ${cutText(address, 60)} wait: ${LIMIT_TEXT[limit]}.`
    //   `${waiting} waiting; the next one goes out at about ${formatClock(nextAt, timeZone, now)}.`
    //   LIMIT_TEXT: mailbox_hour → "the hourly send limit of this mailbox is reached",
    //               mailbox_day → "the daily send limit of this mailbox is reached",
    //               recipient_day → "the daily limit for one recipient is reached"

    // actions/repo/notify.ts — tenant-scoped; one row per mailbox that has held sends now
    export async function listSendLimitHolds(
      db: DbOrTrx,
      ctx: TenantContext,
      now: Date
    ): Promise<{ mailboxId: string; waiting: number; nextAt: Date; lastError: string }[]>;
    //   actions JOIN emails (org filter on both); type = 'send', status = 'approved', last_error LIKE 'send_limit:%',
    //   next_attempt_at > now; GROUP BY emails.mailbox_id; waiting = count(*), nextAt = min(next_attempt_at),
    //   lastError = the last_error of the row with the smallest next_attempt_at (ties: smallest id)

    // channels/notices/send-held.ts
    export const sendHeldDetector: Detector; // name "send-held", kinds ["send_held"]
    //   for each hold of listSendLimitHolds(run.db, run.ctx, run.now) whose mailbox is in run.mailboxes with status "active":
    //     limit = sendLimitOfError(lastError) (skip the row with a warn line when null);
    //     for each owner of run.owners: queue(… { userId, locale, kind: "send_held",
    //       dedupKey: `send_held:${mailboxId}:${run.now.toISOString().slice(0, 10)}`, mailboxId,
    //       view: { mailboxId, address: <mailbox address from run.mailboxes>, limit, waiting, nextAt, now: run.now, timeZone: run.timeZone } }, run.now)
    //   no source mark: the dedup key stops a second row (like `sync_stale`)
    //   for each mailbox of run.mailboxes with no hold (or not active): cancelPendingOutbox(run.db, run.ctx, { kind: "send_held", mailboxId })
    //   (widen the `kind` type of cancelPendingOutbox in channels/repo.ts to include "send_held")
    ```

    Migration (exact; the `down` part deletes the rows of the kind first):

    ```sql
    -- migrate:up
    ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
    ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
      'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
      'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held'));
    -- A send_held row names its mailbox (as auth_error, sync_stale and sync_ok do).
    ALTER TABLE outbox ADD CONSTRAINT outbox_send_held_mailbox_check CHECK (kind <> 'send_held' OR mailbox_id IS NOT NULL);

    -- migrate:down
    DELETE FROM outbox WHERE kind = 'send_held';
    ALTER TABLE outbox DROP CONSTRAINT outbox_send_held_mailbox_check;
    ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
    ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
      'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
      'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed'));
    ```

    Before you write it, read the newest migration that touches `outbox_kind_check` (`grep -l outbox_kind_check db/migrations/*.sql`): if a later ticket added a kind, keep its list and add `'send_held'`.
  - Decisions: D11 (b), D12. The notice waits for the quiet hours like every non-urgent notice (the sender's rule); when the holds of the mailbox end before it goes out, the cancel above drops it. A mailbox that is not `active` gets no `send_held` notice: the committer does not serve it, so the promised time would be false.
  - Test:
    1. `notices.test.ts`: `renderSendHeldNotice({ address: "boss@x.test", mailboxId: "<uuid>", limit: "mailbox_hour", waiting: 3, nextAt: 2026-11-20T10:10:00Z, now: 2026-11-20T10:00:00Z, timeZone: "Europe/Warsaw" })` → text exactly `⏸ Sends from boss@x.test wait: the hourly send limit of this mailbox is reached.\n3 waiting; the next one goes out at about 11:10.`, buttons `[]`. The two other limits give their texts.
    2. The registry test and the `telegram-schema.test.ts` CHECK test pass with the new kind (they fail until all parts exist).
    3. `channels-notices.test.ts`: an organization with one owner and one assistant with linked chats and two held sends of one mailbox (`last_error = "send_limit:mailbox_hour"`, `next_attempt_at` +10 and +20 min) → one `send_held` outbox row, for the owner only, with `waiting: 2`, `nextAt` = +10 min, `mailbox_id` set, dedup key `send_held:<mailboxId>:2026-11-20`.
    4. A second notifier run the same UTC day → no second row. Then set `next_attempt_at` of both sends to `2026-11-21T01:00:00Z` and run at `2026-11-21T00:30:00Z` → a second row with dedup key `send_held:<mailboxId>:2026-11-21`.
    5. A held send with `next_attempt_at <= now` (the hold ended, the committer has not run yet) → no row. An `approved` send with `last_error = "smtp_421"` → no row.
    6. Tenant filter of `listSendLimitHolds`: the held sends of organization A are not returned with the context of organization B.
    8. A pending `send_held` row, then the holds end (`next_attempt_at` in the past) → the next run marks the row `failed` / `outdated`. A paused mailbox with held sends → no row.
    9. The hourly operator run: `createOperatorNotices(…).run()` with one held send of A (no earlier `send_limit` notice) → one `send_limit` text with key `send_limit:<mailboxId>:<UTC date of now>`; a second `run()` → no second text.
    7. `telegram-schema.test.ts`: an insert of a `send_held` row with `mailbox_id` null fails with `23514` (check violation).
  - Check: `bun run db:migrate`; `bun run db:types`; `bun test packages/core/src/notices packages/core/src/digest apps/server/src/modules/channels apps/server/test/integration/channels-notices.test.ts apps/server/test/integration/channels-operator.test.ts apps/server/test/integration/telegram-schema.test.ts apps/server/test/integration/channels-sender.test.ts`; `bun run db:rollback` and `bun run db:migrate` once more; `bun run typecheck`; `bun run lint`.
  - Done when: tests 1–9 pass; `docs/architecture.md` §5 and `docs/modules.md` §3.8 name the kind.
  - Out of scope: Polish text (E7-T1); a button; the operator notice (stage 04).

## Done when

- Step 5.1 is done and committed by explicit paths.
- The Proof command of `plan.md` for stage 05 (`/tmp/f099-s05`) prints `PROOF_OK`.
- The final message tells the coordinator to run `bun run db:migrate` on the shared dev DB (step C1).
