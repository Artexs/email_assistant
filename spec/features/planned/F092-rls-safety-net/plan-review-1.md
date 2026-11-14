FAIL a03104e7a2a2501f1d67821de52973e83f6d0ca4

Blocking: 1. Non-blocking: 6. HEAD is a03104e7a2a2501f1d67821de52973e83f6d0ca4, the same as the candidate. The tree was clean.

## Blocking

**B1 (proven). Stage 02 test 22 cannot pass as written. Its driver rule and test 8 contradict it.**
- Files: `spec/features/planned/F092-rls-safety-net/stages/stage-02-tenant-scope.md`, `db-tenant-scope.test.ts` list, item 22. Also `plan.md` D15 rule 2, and stage 02 test 8.
- Test 22 builds a new `max: 1` pool. Its first and only query runs in `withoutTenantScope`, so the wanted value is `""`.
- D15 rule 2 says a connection with no entry has the value `""`. So the driver writes nothing, and test 8 checks that it writes nothing.
- On a new session, `current_setting('app.org_id', true)` returns NULL, not `""`. Plan P1 says this too. The test helper `setting()` returns that NULL, but test 22 expects `""`.
- Proof: on a scratch Postgres 18.6 cluster with `db/roles.sql`, a new session as `app` returned NULL (`coalesce(…, '<NULL>')` → `<NULL>`).
- Test 24 has the same weakness. It passes only because calls 0 and 1 of the `Promise.all` are scoped and open the two connections.
- The worker rule says "a deviation is a question, not a choice", so stage 02 would stop at this test.
- Fix, option 1 (recommended): define `setting(db)` as `select coalesce(current_setting('app.org_id', true), '') as s`.
- Fix, option 2: treat a new connection as `UNKNOWN`, so the driver always writes on the first acquire. Then change test 8. This option is also robust against an `ALTER ROLE app SET app.org_id` or `options=-c` in `DATABASE_URL`.

## Unverified

- The planned tests and code do not exist yet, so the stage tests were not run. Only the migration text was run (see below).
- Behaviour on Postgres 17: the scratch cluster is 18.6, the same limit as plan § Not verified.
- I ran no lint, typecheck, unit, int or e2e suite. They would only show the state of HEAD, which this plan does not change.

## Notes

**N1 (plausible): the catalog walk does not see views.**
- Where: `plan.md` D10, and stage-01 tests 1–5.
- The walk checks only `relkind IN ('r','p')` and SECURITY DEFINER functions.
- A future view or materialized view owned by `migrator` would bypass RLS, because a view runs as its owner unless it has `security_invoker`.
- Today `public` has 0 views (scratch catalog).
- Add one test: every view or matview in `public` has `security_invoker=true`, or there are none.

**N2 (plausible): one pool-wait case is not tested.**
- Where: `stage-02-tenant-scope.md`, tests 23–24.
- In both tests, each call chain makes only one query after it waits on the pool.
- Add a chain whose first query waits on a full pool and whose second query then reads the setting. This proves that the second acquire still reads its own scope.
- My Bun 1.4.4 probe shows the risk is low: after a promise resolved from another context, the await continuation kept its own context (`after-wait:B later:B`).

**N3 (plausible, wording of the claim): the database does not enforce isolation against code that runs as `app`.**
- Where: `ticket.md` § Outcome ("enforced in the database") and the stage-04 doc text.
- Any SQL that runs as `app` can run `set_config('app.org_id', '', false)`, and an empty value admits every row (the default is open).
- The docs and the auditor sentence should say "a safety net against a missed `org_id` filter", not protection against SQL injection.

**N4 (plausible): callbacks of objects made in a request keep the request scope.**
- Where: `plan.md` D20.
- My Bun probe showed that an EventEmitter callback runs in the context of the emit call, not of the listener (`emitter-cb:A`).
- So a long-lived object made in a request (an IMAP IDLE client, a stream) keeps the request scope in its callbacks.
- Nothing does this today. Make the D20 rule (and its stage-04 text) cover callbacks of objects made in a request, not only started work.

**N5 (plausible): the migration can wait on locks at deploy.**
- Where: `deploy/README.md:51`, and plan U2.
- `db:migrate` runs while the old server still runs.
- `ENABLE ROW LEVEL SECURITY` on 19 tables in one dbmate transaction takes ACCESS EXCLUSIVE locks, so it waits for running job transactions.
- A lock wait or deadlock aborts the migration and dbmate rolls it back cleanly.
- U2 can name this: "expect a short lock wait; repeat on a deadlock".

**N6 (proven, board drift; the plan already reports it):**
- `spec/build.md:27` still says "needs plan; waits for the owner's yes".
- `docs/product/stage-2/07-foundation-plan.md:16` says 3 stages for F092, but the plan has 4.
- The coordinator corrects both. I did not repair them in this worktree.

**N7 (proven, small): one line number in plan K1 is off by one.**
- `node_modules/kysely/dist/kysely.js`: the throw is at line 568, not 567 (565 is the `@deprecated` comment).

## Design verdicts

**D7 (scope per connection acquire):**
- The reasons are correct: `mail/remove.ts:44` and `tenancy/routes.ts:114` call `db.transaction()` directly. Kysely refuses a nested transaction (`kysely.js:568`). `config/rules.ts:58-66` maps the FK error only when it owns the transaction. The connect deadline is 25 s (`mail/routes.ts:32`).
- The `onReserveConnection` leak is real: `postgres-driver.js:22-46` has no `try`.
- The driver interface matches `driver/driver.d.ts`.
- The driver writes `set_config` before `begin`, so a rollback cannot undo it. A local `set_config(…, true)` in a test returns to the driver's value.
- Only `apps/server/src/modules/tenancy/operator-routes.ts:16` reads across organizations in the web path (grep).
- No route uses streaming, `.connection()`, `controlledTransaction` or a raw `begin` (grep).
- The only `void (` in a web path is `web.ts:111`, which is on the auth path and outside the scope.
- Better Auth uses its own pool (`platform/auth.ts:487`) and touches no table with RLS (grep).
- The design is sound apart from B1.

**SECURITY DEFINER:**
- `delete_mailbox` is the only definer function. There are no triggers and no views (migration grep and scratch catalog).
- The guard calls the function by its schema name, `public.app_current_org()`, and the function's `search_path` is fixed.
- `app_current_org()` is a non-definer SQL function. Policies store the function by OID, and `REVOKE CREATE ON SCHEMA public FROM PUBLIC` (`db/roles.sql`) stops shadowing.
- The ACL stays `{migrator=X,app=X}` after the up and the down migration.

**Down path:**
- The order is correct: restore `delete_mailbox`, then drop the policies and disable RLS, then drop the function.
- After rollback, the md5 of the `delete_mailbox` source is the same as on a new database at the old head (`e6d3d2eb…`).
- After rollback there are 0 RLS tables and no `app_current_org`.

**Stage size:** 330, 400, 250 and 90 lines. This is acceptable. Stage 02 (26 tests in one step) is the upper limit.

**Pre-mortem:**
- No `/api` route escapes the scope: all module routers mount inside `api` after `requireTenant` (`web.ts:240-289`, `platform/http.ts` `createApp`).
- No scope can leak to another chain: the driver compares the value on each acquire, and Bun ALS keeps the awaiting context.
- The leak risks that remain are N1 (views) and N4 (callbacks of objects made in a request), plus the open default by design (N3).

## Checks I ran

1. `git rev-parse HEAD` → `a03104e7a2a2501f1d67821de52973e83f6d0ca4`.
2. `bun install --frozen-lockfile` → rc 0, 967 packages. Log: `/tmp/f092-review-install.log`.
3. I read every code fact the plan cites, and every helper and export it names. All exist: `orderApp`, `webTestApp` options, `fillMailbox`, `insertDigest`, `insertLinkToken`, `upsertOrgFeature`, `insertMailbox`, `insertInboxFolder`, `testDb` → `createDb`, and the `package.json` scripts.
   - The doc anchors match: `docs/architecture.md:305` and `:474-475`, ADR 0011 lines 21 and 27, ADR 0027 lines 8 and 21, `docs/code-patterns.md:120`, `.agents/limen/styleguide.md:33`, `docs/modules.md:103-110`.
   - The `onConflict` claims hold: there are no `doUpdate` calls except `org_features`, which is keyed by `org_id`.
4. Scratch cluster: `initdb` in `/tmp`, socket only, port 55491, then `db/roles.sql`.
   - I ran all 17 real migrations, then the stage-01 migration text built exactly from the stage file, with dbmate: migrate, rollback, migrate → all applied.
   - As `app`: the catalog query returned the 18 tables of D9, all with `org_id NOT NULL`; there were 19 `tenant_rows` policies for `{app}`, 19 RLS tables, and the stored policy text was the same as P9.
   - `'not-a-uuid'` gave `22P02` also on an empty table.
   - A new session gave NULL (B1).
   - I stopped the cluster and deleted it. No log of it is saved.
5. Bun 1.4.4 AsyncLocalStorage probe (in `/tmp`, deleted after): `after-wait:B later:B emitter-cb:A then:C`.

I wrote nothing to the shared DB, read no `.env`, did not push and did not use `limen wait`.

## Note check

- Every code fact of the plan files is checked at HEAD a03104e: proven. The cited files were read in this worktree, for example `apps/server/src/modules/mail/remove.ts`, `apps/server/src/modules/config/rules.ts`, `node_modules/kysely/dist/dialect/postgres/postgres-driver.js`, `db/migrations/20261113100001_outbox_view.sql`.
- D7, SECURITY DEFINER, down path, stage size and pre-mortem each have a verdict: not proven. The verdicts are in this message. The scratch-cluster and ALS runs used `;`-joined calls and their files are deleted, so no saved log remains.
- The final message has the first line `FAIL <sha>`, the counts, then the list with file:line: not proven. This message is the evidence; it is not a file.
- Easy-to-miss rule ("No DB writes outside a scratch cluster, no .env, no VPS, no push. Never use limen wait; no tool call over 120 s."): not proven. In this session every DB command went to `/tmp/f092-review-pg` on port 55491, no command read `.env` or pushed, and every timeout was ≤120 s. But the final `git status` call was joined with `;`, so it is no proof under the note rules.
