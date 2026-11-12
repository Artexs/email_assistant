# s6a-customer-core — Stage 6

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A3, A13, A17, "Facts checked" F1–F3, "Differences found at collect" item 3 and "Rules for every step" first, and the master plan's D4.

## Stage 6 — `suspended` gate in the jobs [risky]

One step. The gate sits in the four target queries (A13); no job gets its own check.

- [ ] **6.1 Target queries skip `suspended` organizations; expiry and retention keep them**
  - Goal: a `suspended` organization gets no sync, triage, `triage.returned`, committer work (mailbox change, draft or send), chaser reminder, notice or digest, while another `active` organization gets its work in the same tick. The approval expiry still runs for it (D4).
  - Files:
    - change `apps/server/src/modules/mail/repo.ts` (`listMailboxTargets`, `listSyncTargets`, new `countSyncTargets`), `apps/server/src/modules/mail/index.ts`;
    - change `apps/server/src/modules/actions/expiry.ts:197` (`includeSuspended: true`);
    - change `apps/server/src/modules/channels/repo.ts` (`listLinkedChats` option, `claimDueOutbox` filter), `apps/server/src/modules/channels/notices.ts:716`, `apps/server/src/modules/channels/digest-job.ts:73` (pass `{ includeSuspended: false }`);
    - change `apps/server/src/modules/mail/jobs.ts`, `apps/server/src/modules/triage/jobs.ts`, `apps/server/src/modules/actions/committer.ts` (the per-mailbox re-check, below);
    - change `apps/server/src/main.ts` (the A3 start line);
    - change `apps/server/test/integration/fixtures.ts` (two helpers below);
    - add one test each to `apps/server/test/integration/{mail-jobs,triage-job,actions-committer,triage-returned,delegation-chaser,channels-notices,channels-digest-job,channels-sender,actions-expiry,channels-linking}.test.ts` (next to the existing tests, reusing their local helpers);
    - change `docs/code-patterns.md` (the entry-point list: `listMailboxTargets` and `listLinkedChats` skip `suspended` organizations unless asked; `countSyncTargets`; and the rule "A job that walks organizations uses `listSyncTargets`, `listMailboxTargets`, `listLinkedChats` or `listOrganizations`, and states whether it runs for `suspended` organizations." — code-patterns line 4: code and doc in the same commit).
  - Interfaces:

    ```ts
    // mail/repo.ts — no TenantContext (scheduler entry points)
    export function listMailboxTargets(
      db: DbOrTrx,
      opts: { statuses: readonly MailboxStatus[]; includeSuspended: boolean }
    ): Promise<{ orgId: string; mailboxId: string }[]>;
    export function listSyncTargets(db: DbOrTrx): Promise<{ orgId: string; mailboxId: string }[]>; // statuses ["active"], includeSuspended false
    export function countSyncTargets(db: DbOrTrx): Promise<{ mailboxes: number; organizations: number }>; // the same rows as listSyncTargets
    // channels/repo.ts
    export function listLinkedChats(db: DbOrTrx, opts: { includeSuspended: boolean }): Promise<LinkedChat[]>;

    // test/integration/fixtures.ts
    export async function suspendOrg(trx: Transaction<DB>, orgId: string): Promise<void>; // UPDATE organizations SET plan = 'suspended'
    export async function resumeOrg(trx: Transaction<DB>, orgId: string, at: Date): Promise<void>; // plan = 'active', resumed_at = at
    ```

  - Decisions:
    - `listMailboxTargets`: `selectFrom("mailboxes").innerJoin("organizations", "organizations.id", "mailboxes.org_id")`; without `includeSuspended`, `where("organizations.plan", "<>", "suspended")`. Keep the order `mailboxes.created_at, mailboxes.id` (qualified column names after the join).
    - `listLinkedChats`: the existing select (`selectLinkedChats`) joins `organizations` the same way when `includeSuspended` is false. `findChatLink` and `listLinkedChatsOfOrg` do not change (the Telegram gate is stage 7; the web notices of a suspended org cannot happen because the web refuses writes, stage 8). The call in `channels-linking.test.ts:269` (test "listLinkedChats contains the test links", line 261) passes `{ includeSuspended: true }` (it lists all links).
    - `claimDueOutbox`: in the `picked` CTE add `.where((eb) => eb.not(eb.exists(eb.selectFrom("organizations").select("organizations.id").whereRef("organizations.id", "=", "outbox.org_id").where("organizations.plan", "=", "suspended"))))`. Rows of a suspended organization stay `pending` (or `sending` when stale) and are not claimed. At resume, the 24 h rule of the sender ends the old ones (`OUTBOX_MAX_AGE_MS`); the hook of stage 5 already cancelled the ones queued before the pause.
    - Callers stay as they are except: `actions/expiry.ts` → `includeSuspended: true` (D4: the expiry runs for every organization). Search `listMailboxTargets(` and `listLinkedChats(` in `apps/server/src` and in `apps/server/src/scripts`; every caller passes the option explicitly (the compiler forces it).
    - Per-mailbox re-check (D4: "a job that is running finishes its current item", not its whole list): in the loops of `mail/jobs.ts` (sync), `triage/jobs.ts` and `actions/committer.ts`, before each mailbox, `if (await isOrgSuspended(deps.db, { orgId })) continue;` (`tenancy`; one primary-key read). So a suspend during a long run stops the next mailbox, not only the next run. The other jobs act per organization in one short pass and keep only the list gate.
    - The 48 h rule (difference 3) needs no code. Test 9 shows that a resume after more than 48 h does not send an old approval.
    - A3 start line in `main.ts`, right after the scheduler setup, only when one of the three scopes is `all`: `const targets = await countSyncTargets(db); const suspended = (await listOrganizations(db)).filter((org) => org.plan === "suspended").length; log.warn(\`scope targets: ${targets.mailboxes} active mailboxes in ${targets.organizations} organizations, ${suspended} suspended organizations\`)`. A DB error here logs `scope targets: count failed (<describeError>)` and the start goes on.
    - Jobs and their gate (F3; the reviewer checks this table against `main.ts`):
      | Job | Gate |
      | --- | --- |
      | `mail.sync`, `triage.worker`, `actions.committer`, `triage.returned`, `delegation.chaser` | `listSyncTargets` (skips) |
      | `actions.expiry` | `listMailboxTargets` with `includeSuspended: true` (runs) |
      | `channels.notifier` (detection) | `listLinkedChats` (skips) |
      | `channels.notifier` (sender) | `claimDueOutbox` (skips) |
      | `channels.digest` | `listLinkedChats` (skips) |
      | `platform.heartbeat` | no organization |
      | `platform.retention` (stage 14), `channels.operator` (stage 11) | `listOrganizations`; retention runs for all, the operator job skips `suspended` |
  - Test (each in `withRollback`, `pauseOtherMailboxes` (and `isolateChannels` for the channel jobs) first; org A `active`, org B `suspended` with `suspendOrg`, both with the same setup; fixed `now` from the file's helpers):
    1. `mail-jobs`: one sync run → A's provider opened and `last_synced_at` set; B's provider never opened.
    2. `triage-job`: one pending mail each, scope `all` → one prompt (A); B's mail stays `pending` with `attempts = 0`, no `llm.call` audit row in B.
    3. `actions-committer`: a `ready` `flag` in each → A `applied`; B `ready`, B's address not in `opener.calls`; an `approved` send in B (draft `applied`, `approved_at = now − 1 h`) → no SMTP call.
    4. `triage-returned`: a mail with `returned_at` set in each → A gets its feedback row; B's `returned_at` stays.
    5. `delegation-chaser`: an overdue delegation in each (both `assist`, `create_draft` on, the 07:30 gate passed or `force`) → A gets its reminder rows; B gets none and no `delegation.chaser_run` audit row.
    6. `channels-notices`: an urgent triaged mail and a linked owner in each → an `urgent` outbox row for A only.
    7. `channels-digest-job`: a due slot for a linked member in each → a digest row for A only.
    8. `channels-sender`: one `pending` row in each, a fake channel → A's row `sent`, B's row still `pending` with `locked_at` null.
    9. `actions-expiry`: in B, an `awaiting_approval` send with `notified_at = now − 49 h` → one expiry run → B's send `expired` / `timeout` (the expiry runs for a suspended organization). Then a second B send `approved` with `approved_at = now − 49 h`; `resumeOrg(B, now)`; one committer run → no SMTP call (not claimed: the 48 h rule), and the next expiry run ends it `held_timeout`.
    10. `channels-linking`: `listLinkedChats(trx, { includeSuspended: false })` holds A's link and not B's; `{ includeSuspended: true }` holds both.
    11. `triage-job`: a mid-run suspend: two mailboxes of org A in one run, a fake LLM whose first call sets A `suspended` (`suspendOrg` on the same `trx`) → the second mailbox gets no prompt (the per-mailbox re-check).
    12. `mail-repo` (or `mail-jobs`): `countSyncTargets` counts A's active mailbox and not B's; a `paused` mailbox of A is not counted.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`; `grep -n "listMailboxTargets(\|listLinkedChats(" -r apps/server/src` (paste: every call passes `includeSuspended`).
  - Done when: the checks pass; the table above matches `main.ts` (no job without a row).
  - Out of scope: Telegram taps (stage 7) and the web (stage 8); resume rules (stage 9); the operator and retention jobs (stages 11–14).
