# F085 stage 04 — The way out: the host re-check and the password change [risky]

Part of [`../plan.md`](../plan.md). Read its D3, D5, D6, D8, D16, D18, D19, D20, "Rules for every stage" first. Needs stage 02 (the DB and the server type accept `host_blocked`).

`[risky]`: a background job changes a mailbox status. A review job checks it before the land. No migration.

One `[risky]` step and one small normal step, about 260 changed lines. The way out lands before the way in (stage 05, D18): after this stage, a blocked mailbox (only tests make one) returns to `active` by itself when the guard passes.

- [ ] **4.1 `checkMailboxHosts` and the re-check at the start of each sync run** `[risky]`
  - Goal: at each `mail.sync` run, every `host_blocked` mailbox of an organization that is not suspended is checked with the guard (no connection, no password) and becomes `active` when both of its hosts pass; the same run syncs it.
  - Files:
    - New `apps/server/src/modules/mail/host-status.ts` (the file of stage 05's `markHostBlocked` too).
    - `apps/server/src/modules/mail/repo/mailboxes.ts` (`changeMailboxStatus`, line 142): `change: { from: MailboxStatus; to: MailboxStatus; at: Date }` (the body does not change).
    - `apps/server/src/modules/audit/repo.ts`: `auditEvents.mailboxHostAllowed: "mailbox.host_allowed", // data: mailbox_id` after `mailboxRemoved`.
    - `apps/server/src/modules/mail/jobs.ts`: the first statement of `run()` is `await recheckBlockedHosts({ db: deps.db, now: deps.now });`, before `listSyncTargets`. Read the file at your start: F100 stage 07 (the sync interval) or another ticket may have changed `run()`; the call goes first in any shape.
    - `apps/server/src/modules/mail/index.ts`: export `checkMailboxHosts` and `type HostCheck` (stage 06 and the committer use the module index). `recheckBlockedHosts` stays internal to the module (only `jobs.ts` calls it).
    - Tests: new `apps/server/src/modules/mail/host-status.test.ts` (unit, no DB), new `apps/server/test/integration/mail-host-status.test.ts`, `apps/server/test/integration/mail-jobs.test.ts`.
  - Interfaces:

    ```ts
    // apps/server/src/modules/mail/host-status.ts
    export type HostCheck = "allowed" | "refused" | "lookup_failed";

    /** The guard on both hosts of a mailbox. No connection, no password. Holds no host name in any result or error. */
    export async function checkMailboxHosts(
      mailbox: { imap_host: string; smtp_host: string },
      policy: MailHostPolicy = mailHostPolicy()
    ): Promise<{ imap: HostCheck; smtp: HostCheck }>;
    //   IMAP first, then SMTP (one after the other). For each host: resolveMailHost(host, policy) resolves → "allowed";
    //   HostNotAllowedError → "refused"; SoftError → "lookup_failed"; any other error is thrown.

    export interface HostStatusDeps {
      db: Db | Transaction<DB>;
      now(): Date;
    }

    /** The way out of host_blocked. Never throws: each failure is one log line, and the sync run goes on. */
    export async function recheckBlockedHosts(deps: HostStatusDeps): Promise<{ checked: number; reopened: number }>;
    //   now = deps.now() once.
    //   targets = listMailboxTargets(deps.db, { statuses: ["host_blocked"], includeSuspended: false })
    //     a failure → log.error("mailbox_host_recheck_failed", { ...errorFields(error) }); return { checked: 0, reopened: 0 }
    //   for each { orgId, mailboxId } (try/catch per mailbox):
    //     mailbox = getMailbox(deps.db, { orgId }, mailboxId); undefined → next
    //     hosts = await checkMailboxHosts(mailbox); checked += 1
    //     both "allowed" → reopenHost(...); when it changed the row: reopened += 1,
    //       log.info("mailbox_host_allowed", { mailbox_id: mailboxId })
    //     any "refused" → nothing (no log line: the status already says it)
    //     else (a "lookup_failed", none refused) → log.warn("mailbox_host_check_failed", { mailbox_id: mailboxId, reason: "lookup_failed" })
    //     catch (error) → log.warn("mailbox_host_check_failed", { mailbox_id: mailboxId, ...errorFields(error) })

    // internal: one transaction (the caller's when deps.db is one, as mail/status.ts does)
    async function reopenHost(db: DbOrTrx, ctx: TenantContext, mailboxId: string, now: Date): Promise<boolean>;
    //   changed = changeMailboxStatus(trx, ctx, mailboxId, { from: "host_blocked", to: "active", at: now })
    //   changed → recordAudit(trx, ctx, { actor: "system", event: auditEvents.mailboxHostAllowed, data: { mailbox_id: mailboxId }, at: now })
    //   return changed
    ```

    Imports: `resolveMailHost`, `mailHostPolicy`, `MailHostPolicy` from `./host-guard`; `HostNotAllowedError` from `./port`; `SoftError`, `errorFields` from `../../platform/errors`; `getMailbox`, `listMailboxTargets`, `changeMailboxStatus` from `./repo`; `recordAudit`, `auditEvents` from `../audit`; `createLog` from `../../platform/log` (`const log = createLog("mail")`).
  - Decisions: D5, D6, D8 (no host name in a result, a line or an audit row), D16, D18, D19, D20.
  - Test:
    - Unit (`host-status.test.ts`, a `MailHostPolicy` with a fake `lookup` passed as the second argument; no global policy change):
      1. `lookup` answers `93.184.216.34` for `imap.x.test` and `10.0.0.7` for `smtp.x.test` → `{ imap: "allowed", smtp: "refused" }`; the calls were `["imap.x.test", "smtp.x.test"]` in this order.
      2. `lookup` throws `Object.assign(new Error("getaddrinfo ENOTFOUND imap.x.test"), { code: "ENOTFOUND" })` → `{ imap: "lookup_failed", smtp: "lookup_failed" }`.
      3. `{ allowLocal: true, lookup }` → both `allowed`, `lookup` never called.
      4. A host `127.0.0.1` with `allowLocal: false` → `refused` without a `lookup` call.
    - Integration (`mail-host-status.test.ts`; `withRollback`; `createOrgWithMailbox`; `NOW = 2026-11-14T12:00:00Z`; the mailbox set `host_blocked` at `NOW - 1 h` with `setMailboxStatus`; `configureMailHosts({ allowLocal: false, lookup })` per test and `configureMailHosts({ allowLocal: true })` in `afterEach` (D19); log lines captured with `spyOn(console, "log")` and `spyOn(console, "error")` as `channels-notices.test.ts` does):
      1. `lookup` answers `93.184.216.34` for both hosts → `recheckBlockedHosts({ db: trx, now: () => NOW })` makes the row `active` with `status_changed_at = NOW`; one audit row `mailbox.host_allowed` with `data = { mailbox_id }` and actor `system`; one line with `mailbox_host_allowed` and the mailbox id; no captured line holds `imap.x.test`, `smtp.x.test` or `93.184.216.34`.
      2. A second call → no second audit row (the row is `active` and no longer a target).
      3. `lookup` answers `10.0.0.7` for `smtp.x.test` only → the row stays `host_blocked` with the old `status_changed_at`; no audit row; no captured line names the mailbox id.
      4. `lookup` throws `ENOTFOUND` → the row stays; one `mailbox_host_check_failed` line with `reason=lookup_failed`.
      5. The organization is `suspended` (the fixture helper `suspendOrg`) → its hosts are never looked up (the fake records the names it gets: neither `imap.x.test` call for this mailbox); the row stays.
      6. The row is set `paused` after the list and before the update: call `reopenHost` through the public path by making `getMailbox` see `paused` (set the row `paused` inside the fake `lookup` the first time it runs) → `changed` is false: the row stays `paused`, no audit row, no `mailbox_host_allowed` line.
    - `mail-jobs.test.ts` (the `addBox`, `openers`, `jobFor`, `mailboxRow` helpers; the fakes of `openers` call no guard):
      7. A `host_blocked` mailbox with a fake provider and a public `lookup` → after `jobFor(trx, o).run()` the row is `active` and `last_synced_at = NOW` (the same run synced it) and the fake was opened once.
      8. An `active` mailbox only, with a `lookup` that would refuse → the run syncs it as before (the re-check lists no row; the fake opener calls no guard).
  - Check: `bun test apps/server/src/modules/mail apps/server/test/integration/mail-host-status.test.ts apps/server/test/integration/mail-jobs.test.ts apps/server/test/integration/mail-host-guard.test.ts`; `bun run typecheck`; `bun run lint`.
  - Done when: unit tests 1–4 and integration tests 1–8 pass; the existing tests of `mail-jobs.test.ts` pass unchanged.
  - Out of scope: who sets `host_blocked` (stage 05); `mailbox:check` (stage 06); a "works again" notice (D5: none).

- [ ] **4.2 A password change reactivates a blocked mailbox**
  - Goal: a successful login test with a new password (it went through the guard) makes a `host_blocked` mailbox `active`, as for `auth_error`.
  - Files:
    - `apps/server/src/modules/mail/connect.ts` (`updateMailboxPassword`, line 262): `const reactivated = locked.status === "auth_error" || locked.status === "host_blocked";` and the comment above the function (line 212) names both statuses.
    - Tests: `apps/server/test/integration/mail-password.test.ts`.
  - Interfaces: none new.
  - Decisions: D5.
  - Test (mirror "auth_error becomes active; the new password is stored; one audit row", line 98, and the file's `deps(...)` helper):
    1. A `host_blocked` mailbox; `updateMailboxPassword` with the passing fakes → `{ status: "active", reactivated: true }`; the row is `active` with `status_changed_at` = the input `now`; one `mailbox.password_changed` audit row with `reactivated: true`.
    2. `deps({ openProvider: () => Promise.reject(new HostNotAllowedError()) })` on a `host_blocked` mailbox → the call rejects with `HostNotAllowedError`; the row stays `host_blocked`; the stored secret is unchanged; no audit row.
    3. `deps({ verifySmtp: () => Promise.reject(new HostNotAllowedError()) })` → the same as test 2.
  - Check: `bun test apps/server/test/integration/mail-password.test.ts`.
  - Done when: tests 1–3 pass; the existing tests of the file pass unchanged.
  - Out of scope: the web route mapping (`HostNotAllowedError` already gives `400 host_not_allowed`, `mail/routes.ts:46`).

## Done when

- Steps 4.1 and 4.2 are done and committed by explicit paths.
- `grep -rnE 'imap_host|smtp_host' apps/server/src/modules/mail/host-status.ts` shows them only as arguments of `checkMailboxHosts`, never in a log call or an audit row.
- The Proof command of `plan.md` for stage 04 (`/tmp/f085-s04`) prints `PROOF_OK`.
