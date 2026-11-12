# s6a-customer-core — Stage 10

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A8, A18, "Not verified" (the advisory lock), F8 and "Rules for every step" first, and the master plan's D6.

## Stage 10 — Mailbox limit with the advisory lock [risky]

One step. Needs stage 4 (`max_mailboxes`, `getOrgPlan`).

- [ ] **10.1 `connectMailbox` refuses the mailbox above `max_mailboxes`**
  - Goal: an organization cannot have more mailboxes than `max_mailboxes`, also when two connects run at once; the slow IMAP and SMTP logins never run inside a lock (D6).
  - Files:
    - change `apps/server/src/modules/mail/port.ts` (`MailboxLimitError`), `apps/server/src/modules/mail/repo.ts` (`countMailboxesOfOrg`, `lockMailboxLimit`), `apps/server/src/modules/mail/connect.ts` (`connectMailbox`), `apps/server/src/modules/mail/routes.ts` (`mailErrorBody`), `apps/server/src/modules/mail/index.ts`;
    - change `packages/core/src/web/errors.ts` (the `apiErrorCodes` array: add `"mailbox_limit"`; stage 8 added `"org_suspended"`) and its test;
    - change `apps/server/src/scripts/mailbox-connect.ts` (the CLI message);
    - add tests to `apps/server/test/integration/mail-connect.test.ts` and `apps/server/test/integration/web-mailboxes.test.ts`.
  - Interfaces:

    ```ts
    // mail/port.ts
    export class MailboxLimitError extends HardError { constructor(readonly max: number, options?: ErrorOptions) } // message "mailbox limit reached"
    // mail/repo.ts
    export function countMailboxesOfOrg(db: DbOrTrx, ctx: TenantContext): Promise<number>; // every status
    // Takes the `run` argument of connectMailbox (`Db | Transaction<DB>`, connect.ts:155). It must run inside a transaction:
    // `run` is always called with one (deps.db when it is a transaction, else the trx of db.transaction()). An advisory
    // xact lock outside a transaction ends at once, so the function throws `new Error("lockMailboxLimit needs a transaction")`
    // when `db.isTransaction` is false.
    export function lockMailboxLimit(db: DbOrTrx, ctx: TenantContext): Promise<void>;
    // SQL: SELECT pg_advisory_xact_lock(hashtextextended(${`mailbox_limit:${ctx.orgId}`}, 0))
    ```

  - Decisions:
    - `connectMailbox` order (A18): (1) schema parse, the duplicate check (today); (2) `const plan = await getOrgPlan(deps.db, ctx)` (`tenancy`; `undefined` → `throw new HardError("organization not found")`) and `if (await countMailboxesOfOrg(deps.db, ctx) >= plan.maxMailboxes) throw new MailboxLimitError(plan.maxMailboxes)` — before any login; (3) the IMAP and SMTP checks (today); (4) in `run(trx)`, first `await lockMailboxLimit(trx, ctx)`, then read `getOrgPlan(trx, ctx)` again and `countMailboxesOfOrg(trx, ctx)`; `count >= max` → `throw new MailboxLimitError(max)` (the transaction rolls back); then the inserts of today.
    - When `deps.db` is already a transaction (`deps.db.isTransaction`), `run(deps.db)` takes the lock in the caller's transaction; it is held until that transaction ends. That is correct (one connect per transaction).
    - Counted: every mailbox row of the organization, any status (`paused` and `auth_error` count: they hold credentials and can be resumed).
    - `mail` may import `tenancy` (`tenancy` imports only `audit`; no cycle). Import `getOrgPlan` from `../tenancy`.
    - `mailErrorBody`: `if (error instanceof MailboxLimitError) return { status: 409, error: "mailbox_limit" }` **before** the `HardError` line (`MailboxLimitError` is a `HardError`; else it maps to `502 mail_unreachable`).
    - CLI: `if (error instanceof MailboxLimitError) { log.error(\`mailbox limit reached (max ${error.max})\`); return 1; }`next to the`MailboxExistsError` case.
    - The log line of the web route stays as it is (`mapped.status >= 422` logs; 409 does not log).
  - Test:
    1. `mail-connect` (rollback): org with `max_mailboxes = 1` and one mailbox → `connectMailbox` throws `MailboxLimitError` with `max = 1`, and the fake `openProvider` and `verifySmtp` were **not** called (pre-check).
    2. `mail-connect` (rollback): `max_mailboxes = 2`, one mailbox → the second connect succeeds; a third → `MailboxLimitError`.
    3. `mail-connect` (committed org, deleted in `finally`, F8): `max_mailboxes = 1`, no mailbox; two `connectMailbox` calls with different addresses start at once. Both fake `openProvider`s wait on one shared promise that resolves only after both were called (a barrier), so both pass the pre-check and the logins before either inserts. `Promise.allSettled` → exactly one fulfilled and one rejected with `MailboxLimitError`; the org has 1 mailbox row; one `mailbox.connected` audit row.
    4. `mail-connect` (rollback): a `paused` mailbox counts (`max = 1`, one `paused` → refused).
    5. `mail-connect` (rollback): `max_mailboxes = 0` → refused before any login.
    6. `web-mailboxes`: an owner of an org at its limit `POST /api/mailboxes` with a valid body → `409 { error: "mailbox_limit" }`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the checks pass; test 3 passes 5 runs in a row (`for i in 1 2 3 4 5; do bun test apps/server/test/integration/mail-connect.test.ts -t "at once" || break; done`; paste the result).
  - Out of scope: the web text `err_mailbox_limit` (stage 16); a limit on other resources.
