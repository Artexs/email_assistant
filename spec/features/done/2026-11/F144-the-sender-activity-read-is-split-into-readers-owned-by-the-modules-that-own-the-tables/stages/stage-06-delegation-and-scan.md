# F144 stage 06 — delegation reader, the scan test and the docs

Part of [`../plan.md`](../plan.md). Lands on the worker's proof; its land closes the ticket.

Needs stages 03 and 04: `contacts/activity.ts` with no `sent_emails` statement. Needs stage 05: `contacts/activity.ts` with no triage statement. Needs F142 stage 01: `normalizedAddress` in `apps/server/src/platform/db`. Needs stage 01: `contacts-activity-golden.test.ts`.
Runs last. The delegation step alone touches only `delegation/`; if 03, 04 or 05 is late, the coordinator may start this job for step 1 and continue it for steps 2–3.

## Step 1 — delegations per delegate address (D2, D5, D6, D10)

- **Goal:** the last raw statement of the read becomes a delegation reader.
- **Files:** new `apps/server/src/modules/delegation/activity-repo.ts`, exported through `delegation/index.ts`; `contacts/activity.ts`.
- **Interfaces:** `delegationCountsByDelegateAddress(db: DbOrTrx, ctx: TenantContext, options: { mailboxId: string; since: Date; until: Date }): Promise<{ address: string; delegations: number }[]>` — delegations of the mailbox created in `[since, until]`, joined to their active delegate, grouped by `normalizedAddress` of the delegate's e-mail.
- **Test** (new `apps/server/test/integration/delegation-activity-repo.test.ts`; `NOW` and `ago` of `contacts-fixtures.ts`):
  1. Active delegate `boss@example.com` with 3 delegations at 1, 30 and 89 days and one at 91 days: `[{ address: "boss@example.com", delegations: 3 }]`.
  2. An inactive delegate with 2 delegations: no row.
  3. A delegation of a second mailbox of the organization: not counted.
  4. Tenant: org B has a delegate with the same e-mail and 4 delegations; org A returns 3; org A's `ctx` with org B's mailbox id returns `[]`.
  5. A delegate stored as `Boss@Example.com` (direct insert) gives the row address `boss@example.com` (rule form).
- **Guard check:** remove `dn.org_id`, see the `[]` part of test 4 fail; remove `d.active`, see test 2 fail.

## Step 2 — contacts only composes; the scan test (D7, D12)

- **Goal:** `contacts/activity.ts` holds the options, the reader calls, the merge, the exclusions, `relationOf`, the domain post-filter and the sort, and nothing else.
- **Files:** `contacts/activity.ts`; new unit test `apps/server/src/modules/contacts/activity-sql-scan.test.ts`.
- **Interfaces:** `readSenderActivity` and its exported types unchanged (D7). Remove helpers that no longer have a caller (`escapeLike`, `scopeCondition`, `notAutomatic`, the row interfaces), if any stayed.
- **Test:**
  1. Scan: the text of `contacts/activity.ts` matches none of `/\bsql\s*[<`.(]/` (`` sql` ``, `` sql<T>` ``, `sql.raw(`), `selectFrom(`, `.execute(`, and no value import from `"kysely"` (type imports allowed). One `expect` per pattern, so the failure names it.
  2. Scan: the file has fewer than 400 lines.
  3. The golden test (stage 01) passes unchanged.
- **Guard check:** add `` sql<{ n: number }>`SELECT 1` `` to `activity.ts` locally, see scan test 1 fail, restore.
- **Check:** `bun test apps/server/src/modules/contacts/activity-sql-scan.test.ts apps/server/test/integration/contacts-activity-golden.test.ts apps/server/test/integration/delegation-activity-repo.test.ts apps/server/test/integration/contacts-refresh.test.ts apps/server/test/integration/contacts-activity-only.test.ts`.

## Step 3 — docs (D13)

- **Files:** `docs/capabilities/sender-context.md` (the code table: `readSenderActivity` composes; one row per new reader with its module path); `docs/code-patterns.md` § Data access (the one rule of D13: a module that needs rows of another module's tables calls a reader of that module; a set-based read across modules passes the owner's typed query part, as `senderWindow` of the mail module; the F100 metric readers predate the rule); `docs/modules.md` only where it lists the contacts imports or the readers of these tables.
- **Done when:** the scan test, the golden test and the new tests pass, the docs name the readers, and the Proof prints `PROOF_OK`.
- **Out of scope:** other cross-module reads in contacts (`contacts/privacy.ts`, the suggestion commands); the F100 metric readers; any rename of `listDelegateAddresses`.
