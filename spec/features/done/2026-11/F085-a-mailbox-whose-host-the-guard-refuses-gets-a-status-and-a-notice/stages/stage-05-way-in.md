# F085 stage 05 — The way in: a refused host blocks the mailbox at sync and send time [risky]

Part of [`../plan.md`](../plan.md). Read its D3, D4, D7, D8, D16, D19, D20, the "States and events" table, "Rules for every stage" first. Needs stages 02 (the notice), 03 (the readers) and 04 (the way out, `host-status.ts`).

`[risky]`: sync and committer change a mailbox status; the owners get a message. A review job checks it before the land. No migration.

One `[risky]` step and the end-to-end test, about 280 changed lines. After this stage the ticket's behaviour is live: a refused host gives `host_blocked`, one notice per episode, and the re-check of stage 04 ends it.

- [ ] **5.1 `markHostBlocked` in the sync job and the committer** `[risky]`
  - Goal: a `HostNotAllowedError` while the sync job or the committer opens a mailbox makes an `active` mailbox `host_blocked`, once, with an audit row, and nothing else changes.
  - Files:
    - `apps/server/src/modules/mail/host-status.ts`: add `markHostBlocked`.
    - `apps/server/src/modules/audit/repo.ts`: `auditEvents.mailboxHostBlocked: "mailbox.host_blocked", // data: mailbox_id, source` next to `mailboxHostAllowed`.
    - `apps/server/src/modules/mail/index.ts`: export `markHostBlocked`.
    - `apps/server/src/modules/mail/jobs.ts`, the `catch` in `run()`: right after the `MailAuthError` branch, `else if (error instanceof HostNotAllowedError) { await markHostBlocked(deps.db, ctx, mailboxId, { now: deps.now(), source: "sync" }); }` (import `HostNotAllowedError` from `./port`, `markHostBlocked` from `./host-status`). The `SoftError` and the last branch stay as they are.
    - `apps/server/src/modules/actions/committer.ts`, `openFor` (line 189): after `await release(ctx, batch, now);`, right after the `MailAuthError` branch, `else if (error instanceof HostNotAllowedError) { await markHostBlocked(deps.db, ctx, mailboxId, { now, source: "committer" }); }`. Import both from `../mail` (the file already imports from `../mail`). The file has 399 lines; these 3 lines may take it just over 400, which is fine for this change; do not split the file.
    - Tests: `apps/server/test/integration/mail-jobs.test.ts`, `apps/server/test/integration/actions-committer.test.ts`, `apps/server/test/integration/mail-host-status.test.ts` (from stage 04).
  - Interfaces:

    ```ts
    // apps/server/src/modules/mail/host-status.ts
    /** The way into host_blocked (plan D3). Only an active mailbox changes. Never throws: each outcome is one log line. */
    export async function markHostBlocked(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      mailboxId: string,
      input: { now: Date; source: "sync" | "committer" }
    ): Promise<boolean>;
    //   try: changed = one transaction (the caller's when db is one, as reopenHost):
    //          done = changeMailboxStatus(trx, ctx, mailboxId, { from: "active", to: "host_blocked", at: input.now })
    //          done → recordAudit(trx, ctx, { actor: "system", event: auditEvents.mailboxHostBlocked,
    //                                       data: { mailbox_id: mailboxId, source: input.source }, at: input.now })
    //   catch (error): log.error("mailbox_host_block_failed", { mailbox_id: mailboxId, ...errorFields(error) }); return false
    //   changed → log.warn("mailbox_host_blocked", { mailbox_id: mailboxId, reason: input.source }); return true
    //   else    → log.info("mailbox_host_refused", { mailbox_id: mailboxId }); return false
    ```

  - Decisions: D3, D4, D8, D16, D20. A `SoftError` from the guard (`mail host lookup failed (<code>)`) keeps its current path: a `warn` line, no status change.
  - Test (D19: `configureMailHosts({ allowLocal: false, lookup })` with a fake `lookup` that answers by host name, `configureMailHosts({ allowLocal: true })` in `afterEach`; refused `10.0.0.7`, public `93.184.216.34`; log lines captured with `spyOn(console, …)`):
    1. `mail-jobs.test.ts` (mirror "a login error sets auth_error and the other mailbox still syncs", line 156): `bad` sorts first; the opener calls `await resolveMailHost(opts.host)` before it returns a fake, only for `bad.address`; `lookup` answers `10.0.0.7` → after `run()`: `bad` is `host_blocked`, `status_changed_at = NOW`, `last_synced_at` null; one audit row `mailbox.host_blocked` with `data = { mailbox_id: bad.mailboxId, source: "sync" }`; `good` is `active` and holds its mail; one line `mailbox_host_blocked` with `reason=sync`; no line `sync <bad id> failed`; no captured line holds `imap.x.test` or `10.0.0.7`.
    2. A second `run()` with the same `lookup` → `bad` is not opened again (not a sync target; the re-check sees `refused`); still one audit row.
    3. `actions-committer.test.ts` (the `senderOpener` and `sendJob` helpers, near line 476): the sender opener calls `await resolveMailHost(opts.host)` first; `lookup` answers `10.0.0.7` for `smtp.x.test` and `93.184.216.34` for `imap.x.test` (the IMAP fake opener calls no guard); one approved send → after the run the mailbox is `host_blocked`; the audit row has `source: "committer"`; the send stays `approved` with `attempts` unchanged and no lock (released with no count, as in "a login failure sets auth_error and releases the batch without a count", line 240); the fake sender sent nothing.
    4. The same with a guarded IMAP opener and a `move` batch (no send), `lookup` refusing `imap.x.test` → `host_blocked`; the move stays `ready` with `attempts` unchanged.
    5. `mail-jobs.test.ts`: `lookup` throws `ENOTFOUND` for `bad` → `bad` stays `active`; the `warn` line `sync <id>: mail host lookup failed (ENOTFOUND); the next tick tries again` as today; no audit row.
    6. `mail-host-status.test.ts`: `markHostBlocked` on a `paused` mailbox and on an `auth_error` mailbox → `false`; the rows keep their status and `status_changed_at`; no audit row; one `mailbox_host_refused` line each.
    7. `markHostBlocked` with the context of another organization → `false`; the row stays `active` (tenant filter).
    8. `markHostBlocked` with a `db` stub whose `transaction().execute(...)` rejects (and `isTransaction: false`) → resolves `false`, does not throw, one `mailbox_host_block_failed` line.
  - Check: `bun test apps/server/test/integration/mail-jobs.test.ts apps/server/test/integration/actions-committer.test.ts apps/server/test/integration/mail-host-status.test.ts apps/server/test/integration/mail-host-guard.test.ts apps/server/src/modules/mail`; `bun run typecheck`; `bun run lint`.
  - Done when: tests 1–8 pass; the existing tests of the three files pass unchanged.
  - Out of scope: the CLI tools, the connect form, the password check (D3: not a way in).

- [ ] **5.2 The end-to-end test with a fake resolver (ticket acceptance)**
  - Goal: one test shows the whole episode: guard refuses → status → one notice for the owner with no host name or address → the guard passes → `active` again, the notice outdated, no false "sync is late" notice.
  - Files: new `apps/server/test/integration/mail-host-blocked.test.ts`.
  - Setup (one `withRollback`): `createOrgWithMailbox` with `address: "box-<uuid>@firma.test"`; credentials as `mail-jobs.test.ts` `addBox` does; `addMember` for an assistant; `linkChat` for owner and assistant at `NOW - 1 h`; `markSynced` at `NOW - 5 min`; `isolateChannels(trx)`. `NOW = 2026-11-14T12:00:00Z` (13:00 in Europe/Warsaw, outside the quiet hours). A `lookup` that answers from a `Map<string, string>` (default `93.184.216.34`). The sync job (`createMailSyncJob`) with a guarded fake opener for this mailbox only (`await resolveMailHost(opts.host)`, then `createFakeMailProvider({ uidValidity: 7 })`); every other address throws `new Error("no fake for this address")`. The notifier through `detectNotices({ db: trx, now: () => <time>, startedAt: NOW - 1 h })`.
  - Test (one `test`, steps in order):
    1. `imap.x.test → 10.0.0.7`; sync run at `NOW` → the mailbox is `host_blocked` with `status_changed_at = NOW`; one audit row `mailbox.host_blocked` (`source: "sync"`).
    2. `detectNotices` at `NOW + 1 min` → exactly one outbox row of kind `host_blocked`: `user_id` = the owner, `dedup_key = host_blocked:<mailboxId>:<NOW ms>`, `status` `pending`; none for the assistant. `renderedOf(row).text` contains the mailbox address and none of `imap.x.test`, `smtp.x.test`, `10.0.0.7`.
    3. Sync run at `NOW + 5 min` and `detectNotices` at `NOW + 6 min` (still refused) → still one `host_blocked` row and one `mailbox.host_blocked` audit row; no `sync_stale` row.
    4. `imap.x.test → 93.184.216.34`; sync run at `NOW + 10 min` → the mailbox is `active` with `status_changed_at = NOW + 10 min` and `last_synced_at = NOW + 10 min`; one audit row `mailbox.host_allowed`.
    5. `detectNotices` at `NOW + 11 min` → the `host_blocked` row is `failed` / `outdated`; no `sync_stale` and no new `host_blocked` row.
    6. No captured log line holds `imap.x.test`, `smtp.x.test`, `10.0.0.7` or `93.184.216.34`.
  - Decisions: D5, D7, D8, D19.
  - Check: `bun test apps/server/test/integration/mail-host-blocked.test.ts`.
  - Done when: the test passes three times in a row (`for i in 1 2 3; do bun test apps/server/test/integration/mail-host-blocked.test.ts || break; done`).
  - Out of scope: the Telegram send itself (the sender is covered by `channels-sender.test.ts`).

## Done when

- Steps 5.1 and 5.2 are done and committed by explicit paths.
- `grep -rn "HostNotAllowedError" apps/server/src/modules/mail/jobs.ts apps/server/src/modules/actions/committer.ts` shows one branch in each.
- The Proof command of `plan.md` for stage 05 (`/tmp/f085-s05`) prints `PROOF_OK`.
