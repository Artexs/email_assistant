# s6a-customer-core — Stage 9

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A9, A16, A17, S3, "Differences found at collect" item 6 and "Rules for every step" first, and the master plan's D4 ("Back from `suspended`").

## Stage 9 — Resume: backlog rule, sync-late grace, urgent look-back, digest count [risky]

One step. Every rule reads `organizations.resumed_at` (set by `setOrgPlan`, stage 4). With `resumed_at` null, every rule behaves as today.

- [ ] **9.1 The three resume rules and the split skip count**
  - Goal: after a pause, old mail costs no LLM call, the owner gets no false "sync late" notice in the first 30 minutes, no urgent notice for mail of before the pause, and the digest names the backlog skips correctly (D4, S3).
  - Files:
    - change `apps/server/src/modules/triage/service.ts` (`TriageMailbox.resumedAt`, `triageOne`, a `skipBacklog` next to `skipTooOld`), `apps/server/src/modules/triage/jobs.ts` (the per-organization cache holds `{ timezone, resumedAt }`), `apps/server/src/modules/mail/repo.ts:996` (the `finishEmail` `skipReason` union gets `"suspended_backlog"`);
    - change the test builders of `TriageMailbox` (the compiler finds them: `triage-service.test.ts:52,864,1316`, `triage-settings-race.test.ts:63`, `mail-remove.test.ts:251`, `actions-send.test.ts:899`) to add `resumedAt: null`;
    - change `apps/server/src/modules/channels/notices.ts` (`detectForOrg` passes `organization.resumed_at`; `detectUrgent`, `detectSync`);
    - change `apps/server/src/modules/audit/repo.ts` (`countEventsBetween` gets an optional `reasonCode`), `apps/server/src/modules/reports/digest.ts:122`, `packages/core/src/digest/digest.ts` (input `skippedBacklog`, the footer line), `packages/core/src/digest/digest.test.ts`;
    - add tests to `apps/server/test/integration/{triage-job,channels-notices,reports-digest}.test.ts` and `triage-requeue.test.ts` (or `mail-backfill.test.ts`, where the backfill re-queue is tested).
  - Interfaces:

    ```ts
    // triage/service.ts
    export interface TriageMailbox {
      /* … */ resumedAt: Date | null;
    }
    export const BACKLOG_GRACE_MS = 24 * 3_600_000;
    // audit/repo.ts
    export function countEventsBetween(
      db: DbOrTrx,
      ctx: TenantContext,
      event: string,
      range: { after: Date; until: Date },
      opts?: { reasonCode?: string }
    ): Promise<number>;
    // packages/core digest input
    skippedTooOld: number; // reason_code too_old only
    skippedBacklog: number; // reason_code suspended_backlog
    ```

  - Decisions:
    - `triageOne` order: (1) the existing `too_old` rule; (2) new: `email.backfilled_at === null && mailbox.resumedAt !== null && email.received_at.getTime() < mailbox.resumedAt.getTime() - BACKLOG_GRACE_MS && email.created_at.getTime() < mailbox.resumedAt.getTime() + BACKLOG_GRACE_MS` → `skipBacklog` (the second time limit keeps the rule to the backlog that the first syncs after the resume fetch; a mail that is stored later, for example from a folder switched on later, is triaged as usual; cold review finding 21). If `ClaimedEmail` has no `created_at`, add it to the `claimEmails` select; (3) the hard rules, cap and classifier as today.
    - `skipBacklog` is `skipTooOld` with `skipReason: "suspended_backlog"` and `reasonCode: "suspended_backlog"` (same transaction, same `markReply`, same `email.skipped` event). Write it as one function with the reason as a parameter, so the two cannot drift.
    - `jobs.ts`: replace the `timezones` map by `orgs: Map<string, { timezone: string; resumedAt: Date | null }>` filled from `getOrganization` (it returns the new columns after stage 4's `db:types`); set `mailbox.resumedAt`.
    - `detectSync`: `const resumed = organization.resumed_at; const grace = within(mailbox.status_changed_at) || (mailbox.last_synced_at === null && within(mailbox.created_at)) || (resumed !== null && within(resumed));` (the rest unchanged). The episode key stays `last_synced_at`.
    - `detectUrgent`: `sinceOf(member) = Math.max(member.linkedAt.getTime(), lookbackStart, resumedAt?.getTime() ?? 0)`; `earliest` follows.
    - Digest: `skippedTooOld = countEventsBetween(…, auditEvents.emailSkipped, range, { reasonCode: "too_old" })`, `skippedBacklog = … { reasonCode: "suspended_backlog" }`. Footer: after the `too_old` line, `if (input.skippedBacklog > 0) footer.push(\`📭 Not processed (from the account pause): ${input.skippedBacklog}\`)`. An `email.skipped` row with another reason (none exists today) is in neither count.
    - Backfill: the re-queue query (`mail/repo.ts:1099`, `skip_reason = 'too_old'`) does not change, so backlog mail is never re-queued (A16). Test 6 pins it.
  - Test (fixed clock: `resumedAt = 2026-11-12T08:00:00Z`, `now = 2026-11-12T08:05:00Z` unless the case says other):
    1. `triage-job`: org resumed at `resumedAt` (`resumeOrg`), mails with `received_at` = `resumedAt − 25 h`, `resumedAt − 23 h`, `now − 8 d` → no prompt for the first (status `skipped`, `skip_reason = suspended_backlog`, one `email.skipped` audit row with that `reason_code`), one prompt for the second, the third `skipped` with `too_old` (too_old wins).
    2. `triage-job`: `resumed_at` null, a mail at `now − 3 d` → triaged (no rule without a pause).
    3. `triage-job`: a mail at `resumedAt − 25 h` with `backfilled_at` set → triaged.
       3b. `triage-job`: a mail with `received_at = resumedAt − 25 h` and `created_at = resumedAt + 2 d`, triaged at `resumedAt + 2 d` → triaged (stored after the backlog window).
    4. `channels-notices` sync-late: an `active` mailbox with `status_changed_at` and `created_at` set explicitly to `resumedAt − 10 d` (else the existing grace on `status_changed_at` hides the new one), `last_synced_at = resumedAt − 3 d`, a linked owner, `startedAt` = `now − 1 h` (past the start grace); at `now` (`resumedAt + 5 min`) → no `sync_stale` row; at `resumedAt + 31 min` with the same `last_synced_at` → one `sync_stale` row; with `last_synced_at = resumedAt + 2 min` at `resumedAt + 31 min` → no row.
    5. `channels-notices` urgent: a linked member (`linkedAt = resumedAt − 10 d`); urgent mail triaged at `resumedAt − 2 h` and at `resumedAt + 1 min`; at `resumedAt + 3 min` → an `urgent` row only for the second mail.
    6. `triage-requeue` / `mail-backfill`: a `skipped` / `suspended_backlog` mail in the backfill window → the re-queue leaves it `skipped`.
    7. `digest.test.ts` (core, unit): `skippedTooOld: 2, skippedBacklog: 3` → both footer lines in that order; `skippedBacklog: 0` → no backlog line.
    8. `reports-digest`: two `email.skipped` rows (`too_old`, `suspended_backlog`) in the range → the digest text has `(older than 7 days): 1` and `(from the account pause): 1`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the checks pass.
  - Out of scope: digest content over a long pause (A17); approval requests at resume (A17); a web view of skipped mail.
