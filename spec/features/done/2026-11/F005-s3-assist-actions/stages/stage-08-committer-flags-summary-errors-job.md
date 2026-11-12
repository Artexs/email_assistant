# s3-assist-actions — Stage 8

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 8 — Committer: flags, summaries, error rules, scope, the job [risky]

Checkpoint 2 addendum (group review 2026-11-07, finding 3; main session decision under the user's "use the defaults"): `FinishNext` gets `at: Date` for every branch, and `finishAction` sets `updated_at` (and `applied_at` for `applied`) from it; `releaseAction` / `releaseActions` take `now: Date` and set `updated_at` from it. The committer passes its run `now`. Why: stages 12 and 13 compare `updated_at` with the job `now`; one clock in tests. Update the stage 7 callers and tests.

- [x] **8.1 `applyAction` for `save_summary`, `flag`, `mark_read` (original and reverse) and the error rules (D5, D7)**
  - Goal: one function applies one claimed action against a `MailProvider` and writes the result, the email location and the audit row in one transaction; errors map to the §4.1 rule 7 outcomes.
  - Files: create `apps/server/src/modules/actions/apply.ts`, `apps/server/test/integration/actions-apply.test.ts`; change `apps/server/src/modules/actions/index.ts`, `apps/server/src/modules/audit/repo.ts` (`auditEvents`: `actionApplied: "action.applied"`, `actionFailed: "action.failed"`, `actionUndone: "action.undone"`, `actionUndoRequested: "action.undo_requested"`, `actionExpired: "action.expired"`, `emailReturned: "email.returned"`, `mailboxFolderCreated: "mailbox.folder_created"`).
  - Interfaces:

    ```ts
    export const HARD_ERROR_TRIES = 3;
    export const RETRY_WAIT_MS = 5 * 60_000;
    export type ApplyOutcome =
      | { kind: "applied" }
      | { kind: "failed"; reason: "mail_not_found" | "hard_error" | "no_provider" }
      | { kind: "retry"; soft: boolean }
      | { kind: "auth_error" }
      | { kind: "lost" };
    export interface ApplyDeps {
      db: Db | Transaction<DB>;
      now(): Date;
      folderMap: Record<string, string>;
      mailboxId: string;
    }
    export async function applyAction(
      deps: ApplyDeps,
      ctx: TenantContext,
      action: ClaimedAction,
      provider: MailProvider | null
    ): Promise<ApplyOutcome>;
    ```

  - Decisions:
    - Every `action.*` audit row of the committer sets `actionId` = the action's id (for `action.undone`: the original's id) and `emailId` = the mail's id (m8): the stage 20 audit-coverage query joins `audit_log.action_id`.
    - `save_summary`: no provider. One transaction: `finishAction(applied, appliedAt = now)` → false → `lost`; audit `action.applied` (`data: { action_type, mailbox_id, reverse: false }`).
    - `flag` / `mark_read` original: `provider` null → `failed` / `no_provider` is impossible by construction (the job opens a provider when a mailbox-changing action is claimed); keep the branch as a guard that releases the action (`retry`, soft) and logs an error. `meta = locateMessage(provider, action.email.folder, locateKeyOf(action.email, action.email.uid), { excludeUids: await listFolderUids(db, ctx, mailboxId, action.email.folder, { exceptEmailId: action.email.id, messageId: action.email.message_id_header, contentHash: action.email.content_hash }) })` (the B2 rule of 9.1a also for flags: with two identical copies in one folder and a hint miss, the search must not return the other row's copy, else the flag goes to the wrong copy and this row gets the other row's UID; re-review Rm3); null → one transaction: `finishAction(failed, reason mail_not_found)`, audit `action.failed` with `reason_code: "mail_not_found"` → `failed`. Else `provider.setFlags(folder, meta.uid, { add: ["\\Flagged"] })` (or `\\Seen`); then one transaction: `updateEmailLocation` when `meta.uid !== action.email.uid` (M7): `folder` = `action.email.folder`, `uid` = `meta.uid`; when the folder is INBOX also `inboxUid: meta.uid`; in another folder no `inboxUid`; never `movedAt` (undefined keeps `moved_at`); then `finishAction(applied, providerResult: { uid: meta.uid })`, audit `action.applied`. Reverse rows (`reverses_action_id` set): the same with `remove` instead of `add`; a reverse with `mail_not_found` ends `failed` / `mail_not_found` like an original, and stage 12 notifies it (Q1 default); the transaction also runs `markUndone(original, { reason: "undo" })` and audits `action.undone` on the original (`data: { reverse_action_id }`). A reverse whose original is not `applied` any more (already `undone` by `user_moved_back`) still applies the IMAP part (harmless) and finishes `applied`; `markUndone` false is not an error.
    - `move`: stage 9 (this step throws `HardError("move not built")`, replaced in stage 9; the stage 8 tests use no move).
    - Error mapping around the provider calls: `MailAuthError` → `auth_error` (no DB change here; the job handles the mailbox); `SoftError` → `releaseAction(nextAttemptAt: now + RETRY_WAIT_MS, countAttempt: false, lastError: describeError)` → `retry soft`; any other error (`HardError`, `MailNotFoundError`, unknown) → `action.attempts + 1 >= HARD_ERROR_TRIES` ? one transaction `finishAction(failed, reason hard_error, lastError: describeError)` + audit `action.failed` (`reason_code: "hard_error"`, `data: { attempts: action.attempts + 1, error: describeError }`) → `failed` : `releaseAction(now + RETRY_WAIT_MS, countAttempt: true, lastError)` → `retry hard`. A failed release (DB error) throws to the job.
    - A DB error inside the final transaction (after the IMAP change) throws to the job; the action stays `ready` and locked until stale; the next run repeats the (idempotent) IMAP call. For flags this is a no-op on the server.
    - Log lines: `action <id>: applied <type>` (debug), `action <id>: failed <reason>` (warn), `action <id>: <Class code>, try <n> of 3` (warn). No subject, no address, no folder path from mail data (folder keys only).
  - Test (`actions-apply.test.ts`, `withRollback`, fake provider, fixtures): (1) `save_summary` → `applied`, `applied_at` set, one `action.applied` audit row, no provider call; (2) `flag` → the fake mail has `\\Flagged`; `applied`; `provider_result.uid`; audit; (3) `mark_read` → `\\Seen`; (4) the row's `uid` is 5 but the fake holds the mail at UID 7 (same identity) → located by search, `emails.uid` and `inbox_uid` become 7, applied; (4b) a reverse `flag` of a mail in `AI/Info` (`moved_at` set) whose UID there changed from 5 to 7 → `uid` 7, `inbox_uid` and `moved_at` unchanged (M7); (4d) two rows #1 and #2 of one identity in `AI/Spam` (the fake holds #1's copy at UID 3 and #2's copy at UID 8); a `flag` of #2 whose row says UID 5 (a stale hint) → the copy at UID 8 gets `\\Flagged`, the copy at UID 3 does not, #2's `uid` becomes 8, #1's row is unchanged; (4c) every audit row of tests 1–8 has `action_id` and `email_id` set (m8); (5) the mail is not in the folder → `failed` / `mail_not_found`, audit `action.failed` `mail_not_found`, `notified_at` null, `attempts` 0; (6) `failOn("setFlags", new SoftError(…))` → `retry soft`, `attempts` 0, `next_attempt_at` = now + 5 min, `locked_at` null, `last_error` = `SoftError`; (7) `failOn("setFlags", new HardError(…), 3)` with `attempts` 0, 1, 2 across three calls → `retry hard` twice (`attempts` 1, 2), then `failed` / `hard_error` with `last_error` `HardError`; (8) a reverse `flag` row → `\\Flagged` removed, the reverse `applied`, the original `undone` with `status_reason` `undo`, audit `action.undone` on the original; (9) `MailAuthError` from the provider → `auth_error`, the row unchanged (still locked); (10) a wrong `locked_at` (another run took it) → `lost`, no audit row.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: `move` (stage 9), the job (8.2), the notice (stage 12).

- [x] **8.2 `createCommitterJob` with the scope gate (D6, D8)**
  - Goal: a job that every 15 s applies the claimable actions of every active mailbox with one IMAP connection per mailbox and the scope filter of P1.
  - Files: create `apps/server/src/modules/actions/committer.ts`, `apps/server/src/modules/actions/scope.ts` (`ActionsScope`, `claimFilterFor`), `apps/server/src/modules/actions/scope.test.ts`, `apps/server/test/integration/actions-committer.test.ts`; change `apps/server/src/modules/actions/index.ts`, `apps/server/src/modules/mail/index.ts` (export `setMailboxStatus`: today only `changeMailboxStatus` is exported, m7).
  - Interfaces:

    ```ts
    export type ActionsScope = { kind: "off" } | { kind: "synthetic" } | { kind: "all"; mailboxAddress: string };
    export function claimFilterFor(scope: ActionsScope, mailboxAddress: string): ClaimFilter; // pure; the committer and the Undo tap (stage 10) use it
    export interface CommitterDeps {
      db;
      secrets: SecretBox;
      openProvider(opts: ImapConnectOptions): Promise<MailProvider>;
      scope: ActionsScope;
      now(): Date;
      batchSize?: number /* 20 */;
    }
    export const STALE_AFTER_MS = 10 * 60_000;
    export function createCommitterJob(deps: CommitterDeps): { run(): Promise<void> };
    ```

  - Decisions:
    - Filter per mailbox = `claimFilterFor(scope, mailbox.address)`: `off` → `{ kind: "none" }`; `synthetic` → `{ kind: "synthetic" }`; `all` → the mailbox address equals `mailboxAddress` (case-insensitive) ? `{ kind: "all" }` : `{ kind: "none" }` (another mailbox gets no mailbox change, also for synthetic mail: D8). `save_summary` is applied under every scope (DB only).
    - Per mailbox (`listSyncTargets`, active only; `ctx = { orgId }`; it returns only `{ orgId, mailboxId }`): first `getMailbox` (the address for `claimFilterFor` and the `folder_map` for the resolver; undefined → next mailbox; re-review Rm4), then `expireStaleReady(…, { now, staleBefore: now − STALE_AFTER_MS })` (D21) in one transaction with one `action.expired` audit row per row (`actionId`, `emailId`, `data: { action_type, reason: "stale" }`); a warn line `committer <mailboxId>: expired <n> stale actions` when `n > 0`. Then `countClaimable` → `total` 0 → next mailbox. `claimed = claimActions(…)`. When `claimed` has a mailbox-changing type: `openMailboxProvider` (errors: `MailAuthError` → `setMailboxStatus(auth_error)` + `releaseActions(all)` + warn; `SoftError` → `releaseActions(all)` + warn `the next tick tries again`; other → `releaseActions(all)` + error). Then for each action in order: `applyAction`; on `auth_error` → `setMailboxStatus(auth_error)`, `releaseActions(rest incl. this one)`, stop the mailbox; on `retry soft` → `releaseActions(rest)` (this one is released already), stop the mailbox; on `retry hard`, `failed`, `applied`, `lost` → continue. `finally`: close the provider (errors logged as warn with `describeError`). One mailbox's error never stops the next (the S1a job pattern; the catch releases the untried actions).
    - The job keeps no state between runs except `warnedOff` (one info line per process when the scope is `off` and a mailbox had held-back actions: `committer: ACTIONS_SCOPE=off, <n> mailbox actions wait in mailbox <id>` once per mailbox).
    - Per run per mailbox one info line: `committer <mailboxId>: applied <a>, failed <f>, retry <r>` (only when a + f + r > 0).
  - Test: `scope.test.ts` (unit): `claimFilterFor` for `off`, `synthetic`, `all` with the same address in other case (`all`) and with another address (`none`).
  - Test (`actions-committer.test.ts`, `withRollback`, `pauseOtherMailboxes` first, fake provider through `openProvider`; the job's `db` is the test transaction): (1) scope `synthetic`: a synthetic `info` mail with `save_summary` + `flag` ready and a real mail with `flag` ready → after `run()`: both summaries applied, the synthetic flag applied, the real flag still `ready` and unlocked, `openProvider` called once; (2) scope `off`: only summaries; `openProvider` not called; (3) scope `all` with the mailbox address → everything applied; with another address → like `off`; (4) a mailbox with nothing claimable → no `openProvider` call; (5) `openProvider` throws `MailAuthError` → the mailbox is `auth_error` with `status_changed_at`, the actions `ready` and unlocked, `attempts` 0; (6) a soft error on the first of two flags → the first released with `next_attempt_at`, the second released untouched (`next_attempt_at` null), the provider closed; (7) two mailboxes in the org, the first fails hard on open → the second is still processed; (8) a stale locked action (`locked_at` = now − 11 min) is applied; (9) the fake's `closed` is true after the run; (10) a `ready` `move` created 25 h ago is `expired` / `stale` after the run with an `action.expired` audit row, and the fake shows no move; a `save_summary` of the same age is applied.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: `main.ts` wiring and the config key (stage 15), moves (stage 9).
