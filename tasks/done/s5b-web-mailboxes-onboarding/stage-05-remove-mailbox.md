# s5b-web-mailboxes-onboarding — Stage 5

Part of [`../s5b-web-mailboxes-onboarding.md`](../s5b-web-mailboxes-onboarding.md). Read that file's "Done when", "Owns", S1–S12, "Facts checked", B1–B17, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 5 — `removeMailbox`, the owners' notice, the race and lock tests [risky]

One step. Uses the function of stage 4 and the helper `test/integration/mailbox-rows.ts`.

- [x] **5.1 `mail/remove.ts`, `queueMailboxRemovedNotices`, the tests (B8, D11, P5)**
  - Goal: the service that the web's remove route calls: the typed address must match, the data goes in one transaction with its audit row and the owners' Telegram notice, and a job that holds a claimed mail of the mailbox writes nothing afterwards.
  - Files: create `apps/server/src/modules/mail/remove.ts`, `apps/server/test/integration/mail-remove.test.ts`; change `mail/index.ts` (exports), `modules/audit/repo.ts` (`mailboxRemoved: "mailbox.removed"`), `channels/repo.ts` (`listLinkedChatsOfOrg`), `channels/notices.ts` (`queueMailboxRemovedNotices`), `channels/texts.ts` (`MAILBOX_REMOVED_TEXT`), `channels/index.ts` (exports).
  - Interfaces:

    ```ts
    // mail/remove.ts
    export interface RemoveDeps {
      db: Db;
      // Runs inside the delete transaction (fact 6: mail cannot import channels; web.ts wires channels here).
      onRemoved(trx: Transaction<DB>, ctx: TenantContext, input: { mailboxId: string; now: Date }): Promise<void>;
    }
    export type RemoveResult = { kind: "removed" } | { kind: "not_found" } | { kind: "confirm_mismatch" };
    export async function removeMailbox(
      deps: RemoveDeps,
      ctx: TenantContext,
      mailboxId: string,
      input: { userId: string; confirmAddress: string; now: Date }
    ): Promise<RemoveResult>;
    // channels/repo.ts
    export async function listLinkedChatsOfOrg(db: DbOrTrx, ctx: TenantContext): Promise<LinkedChat[]>; // selectLinkedChats + org filter, ordered by user_id
    // channels/texts.ts
    export const MAILBOX_REMOVED_TEXT = "Mailbox removed. Change its password in your mail provider's settings now.";
    // channels/notices.ts
    export async function queueMailboxRemovedNotices(
      trx: Transaction<DB>,
      ctx: TenantContext,
      input: { mailboxId: string; now: Date }
    ): Promise<number>; // rows inserted
    ```

  - Decisions:
    - `removeMailbox` order (B8): `getMailbox` (none → `not_found`); `sameAddress(confirmAddress, mailbox.address)` from `@ea/core` (stage 1) false → `confirm_mismatch` with no change; `changeMailboxStatus(db, ctx, id, { from: "active", to: "paused", at: now })` in its own commit (the result is ignored: `paused` and `auth_error` pass; no audit row); then `db.transaction().execute(trx => …)`: ``await sql`SELECT delete_mailbox(${ctx.orgId}::uuid, ${mailboxId}::uuid)`.execute(trx)``; `recordAudit(trx, ctx, { actor: input.userId, event: auditEvents.mailboxRemoved, data: { mailbox_id: mailboxId }, at: now })`; `deps.onRemoved(trx, ctx, { mailboxId, now })`. An error with `code === "P0002"` from the transaction → `not_found` (the transaction rolled back; for example a second remove at the same time). `40P01` (a deadlock with a concurrent `saveTriage` or committer) → run the transaction once more. Any other error, or a second `40P01`: when this call paused the mailbox (`changeMailboxStatus` returned `true`), run `changeMailboxStatus` `paused` → `active` and rethrow (B8; cold review finding 6). After the commit: `log.info(`mailbox ${mailboxId} removed by user ${input.userId}`)` (`createLog("mail")`; no address).
    - `deps.db` is a plain `Db` (not a transaction): the pause must commit before the delete, and the delete opens its own transaction.
    - `queueMailboxRemovedNotices`: for each chat of `listLinkedChatsOfOrg` with `role === "owner"`, `insertOutbox(trx, ctx, { userId, kind: "mailbox_removed", dedupKey: `mailbox_removed:${mailboxId}`, message: { text: MAILBOX_REMOVED_TEXT, buttons: [] }, createdAt: now, nextAttemptAt: now })` with **no** `mailboxId` and **no** `emailId`; returns the count of non-null ids. An assistant gets no row (owners connect and remove mailboxes, P4).
    - The sender handles the new kind like every non-digest kind (quiet hours apply; no change in `sender.ts`). Check `sender.ts` and `notices.ts` for a `switch` over `kind` that would need the new value (none known at plan time; the typecheck shows an exhaustive switch).
  - Test (`mail-remove.test.ts`; all tests are committed with their own organizations and a cleanup in `afterEach` (`deleteFrom("organizations")`), because `removeMailbox` opens its own transactions on a plain `Db`; fixtures that take a `Transaction<DB>` run through `db.transaction().execute((trx) => …)`, B17):
    1. `confirmAddress: "wrong@x.test"` → `confirm_mismatch`; status, rows and audit unchanged.
    2. A mailbox id of another organization → `not_found`; that mailbox's counts unchanged. A random UUID → `not_found`.
    3. Success with `confirmAddress` in another case and with outer spaces: `removed`; `countMailboxRows(…, { exceptEvents: ["mailbox.removed"] })` all 0 (the `mailbox.removed` row carries `data.mailbox_id` on purpose; cold review finding 5); one `mailbox.removed` audit row with `actor` = the user and `data` exactly `{ mailbox_id }`; a linked owner gets one `pending` outbox row of kind `mailbox_removed` with `text` = `MAILBOX_REMOVED_TEXT`, `mailbox_id` and `email_id` null; a linked assistant and an unlinked owner get none; no outbox row of the organization holds the address (`text ILIKE '%' || address || '%'`).
    4. A second mailbox of the same organization and a mailbox of another organization keep all their rows (the counts before = after).
    5. Race (fact 8, fact 11): insert a `pending` email with `insertTestEmail` (through `db.transaction().execute(…)`, B17; `fillMailbox` makes a triaged one); `claimEmails` claims it (committed); `removeMailbox` → `removed`; then `saveTriage(db, ctx, mailboxView, claimedEmail, decision, now)` with the settings version read before the removal (the pattern of `triage-settings-race.test.ts`) → `{ kind: "lost" }`; no `triage_results` and no `actions` row exists for the email id; `listSyncTargets(db)` holds no entry for the mailbox (the next tick is clean).
    6. Lock wait: a second transaction (`db.transaction().execute` with a promise you resolve by hand) runs `SELECT id FROM emails WHERE mailbox_id = $1 FOR UPDATE` and waits; `removeMailbox` starts; after 300 ms its promise has not settled (a flag set in `.then`); release the second transaction; `removeMailbox` resolves `removed` within 5 s; counts 0.
    7. Two `removeMailbox` calls at once (`Promise.all`) → one `removed`, one `not_found` (or both `removed` is a failure); one `mailbox.removed` row.
       7a. A failing delete restores the status: `deps.onRemoved` throws `new Error("boom")` → `removeMailbox` rejects; the mailbox is `active` again and every row is intact (the transaction rolled back). A mailbox that was `paused` before stays `paused`.
       7b. Tenant filter of `listLinkedChatsOfOrg`: a linked owner of another organization is not in the list.
    8. No "[removed]" text is ever claimed: with a `sent` and a `pending` digest in the organization before the removal, `claimDueOutbox(db, { now, limit: 50, staleBefore, orgIds: [orgId] })` after the removal returns no row whose `text` is `[removed]` (the pending one is gone; the sent one is not claimable).
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; `grep -n "address" apps/server/src/modules/mail/remove.ts` shows no log or audit use of the address.
  - Out of scope: the route and the wiring of `onRemoved` (stage 7).
