# F088 stage 06 — Detector registry: one file per detector

Part of [`../plan.md`](../plan.md). Decisions: D4, D21, D22 (server unit test). Needs stage 05 landed. No behaviour change: a move of code plus one loop. Two steps.

Size: the diff is large (about 750 lines leave `notices.ts` and land in ten files) but mechanical. Commit the move first with no other change (one commit: the new files and the deleted `notices.ts`, with the bodies copied as they are), then the `Detector` wrappers and the loop in a second commit, then the test. `git diff --color-moved=zebra HEAD~2 HEAD~1` shows the first commit as moved lines only; say so in the final message.

## Step 1 — Split `notices.ts` into `channels/notices/`

**Goal.** `apps/server/src/modules/channels/notices.ts` (about 780 lines after stage 04) becomes a folder with one file per detector and a list that `detectForOrg` iterates (review §3.3; ticket scope "the detector registry").

**Files.** Delete `apps/server/src/modules/channels/notices.ts`. New, in `apps/server/src/modules/channels/notices/`:

| File | Holds (moved code, unchanged unless this table says so) |
| --- | --- |
| `run.ts` | `NoticeDeps`, `DbOrTrx`, `OrgRun`, `Detector`, `APPROVAL_LIMIT`, `inTransaction`, `warnSkipped` (with its `warnedRows` set; the detectors of stage 04 call it), the local `queue` helper, `const log = createLog("channels")` |
| `urgent.ts` | `URGENT_LOOKBACK_MS`, `URGENT_LIMIT`, `detectUrgent` → `urgentDetector` |
| `action-failed.ts` | `ACTION_FAILED_LOOKBACK_MS`, `ACTION_FAILED_LIMIT`, `isMailboxActionType`, `detectActionFailed` → `actionFailedDetector` |
| `auth-error.ts` | `detectAuthError` → `authErrorDetector` (it loops over `run.mailboxes`) |
| `sync.ts` | `SYNC_LATE_MS`, `STALE_GRACE_AFTER_START_MS`, `detectSync` → `syncDetector` (it loops over `run.mailboxes`; `kinds: ["sync_stale", "sync_ok"]`) |
| `approval.ts` | `approvalViewFor`, `detectApprovals` → `approvalDetector` |
| `approval-set.ts` | `detectApprovalSets` → `approvalSetDetector` |
| `send-result.ts` | `SEND_KINDS`, `EXPIRY_REASONS`, `stringOf`, `numberOf`, `resultKindOf`, `detectSendResults` → `sendResultDetector` |
| `delegation-answered.ts` | `detectDelegationAnswered` → `delegationAnsweredDetector` |
| `mailbox-removed.ts` | `queueMailboxRemovedNotices` (unchanged signature) |
| `index.ts` | `detectors`, `queuedBy`, `detectForOrg` (not exported), `detectNotices`; re-exports `NoticeDeps`, `queueMailboxRemovedNotices`, `SYNC_LATE_MS` |

Importers keep their import paths: `channels/index.ts` (`./notices`), `channels/commands.ts` (`./notices`, for `SYNC_LATE_MS`), `channels/telegram/runtime.ts` (`../notices`) resolve to `notices/index.ts`. Cross-module imports inside the folder are `../../actions`, `../../audit`, `../../config`, `../../delegation`, `../../mail`, `../../tenancy`, `../../triage`, `../../../platform/…` (index files only; the F086 lint fails on anything else). Imports of channels files: `../repo`, `../port`, `../notice-queue`.

**Interfaces.** `run.ts`:

```ts
export interface OrgRun {
  deps: NoticeDeps;
  db: DbOrTrx;
  ctx: TenantContext;
  now: Date;
  timeZone: string;
  resumedAt: Date | null;
  members: LinkedChat[];
  owners: LinkedChat[];
  mailboxes: MailboxSummary[];
  pausedMailboxIds: Set<string>;
}

/** One notice source. `kinds` are the outbox kinds it may queue. */
export interface Detector {
  name: string;
  kinds: readonly NoticeKind[];
  detect(run: OrgRun): Promise<void>;
}
```

Each detector file exports `const <name>Detector: Detector = { name: "<file name>", kinds: [<kind>], detect: (run) => <the old function>(<its old arguments taken from run>) }`. The old function bodies stay as they are; only their parameter source changes. `authErrorDetector.detect` runs `for (const mailbox of run.mailboxes) await detectAuthError(run.db, run.ctx, run.owners, mailbox, run.timeZone, run.now);`; `syncDetector.detect` the same loop over `detectSync(run.deps, …)`.

`index.ts`:

```ts
// The run order of one organization (the order of the old detectForOrg; auth errors and syncs now run one after the other
// for all mailboxes, which changes no row: each row has its own dedup key and the same created_at).
export const detectors: readonly Detector[] = [
  urgentDetector, actionFailedDetector, authErrorDetector, syncDetector,
  approvalDetector, approvalSetDetector, sendResultDetector, delegationAnsweredDetector,
];

// Kinds that a producer outside the detector list queues.
export const queuedBy = {
  digest: "channels/digest-job.ts",
  mailbox_removed: "channels/notices/mailbox-removed.ts",
} as const satisfies Partial<Record<NoticeKind, string>>;
```

`detectForOrg(deps, orgId, members, now)` builds the `OrgRun` exactly as the old function built its locals (organization, `timeZone`, mailboxes, owners, `pausedIds`, `resumedAt = organization.resumed_at`) and runs `for (const detector of detectors) await detector.detect(run);`. A detector that throws stops the organization's run, as before; `detectNotices` keeps its two `try` blocks and log lines.

Export `detectors` and `queuedBy` from `notices/index.ts` only (the test imports them from there); the module `index.ts` does not export them.

**Decisions.** D4, D21.

**Test.** Every case of `channels-notices.test.ts`, `actions-logs.test.ts`, `actions-send-logs.test.ts`, `channels-commands.test.ts` passes with no change to the test files.

**Check.**
- `bun test apps/server/test/integration/channels-notices.test.ts apps/server/test/integration/channels-commands.test.ts apps/server/test/integration/actions-logs.test.ts apps/server/test/integration/actions-send-logs.test.ts`
- `wc -l apps/server/src/modules/channels/notices/*.ts`: every file under 400 lines.
- `test ! -e apps/server/src/modules/channels/notices.ts && echo gone`.
- `bun run graph:modules` then `git status --short docs/diagrams` prints nothing.

**Done when.** The checks pass; `git diff --stat` shows no test file changed by this step.

**Out of scope.** Any change of a query, a text, a dedup key or a transaction. Splitting `send-result.ts` further.

## Step 2 — The completeness test

**Goal.** A new notice kind without a renderer, or without a detector or a `queuedBy` entry, fails a unit test (ticket acceptance line 1; D22).

**Files.** New: `apps/server/src/modules/channels/notices/registry.test.ts`.

**Interfaces.** None.

**Decisions.** D5, D22.

**Test.** `registry.test.ts` (unit, `bun run test:unit` picks up `apps/server/src`):

1. The list `[...detectors.flatMap((d) => d.kinds), ...Object.keys(queuedBy)]` has no repeated kind.
2. Its sorted form equals `[...noticeKinds].sort()` (from `@ea/core`).
3. `Object.keys(noticeRenderers).sort()` equals `[...noticeKinds].sort()` (the same check as core, here next to the detectors so one failing test names both gaps).
4. Every `detector.name` is unique.

Mutation check, then revert: remove `"sync_ok"` from `syncDetector.kinds` → test 2 fails; restore it; `git diff --stat` shows only the new test file.

**Check.** `bun test apps/server/src/modules/channels/notices/registry.test.ts`.

**Done when.** Tests 1–4 pass; the mutation check failed and was reverted; the Proof of `plan.md` with `NN` = `06` ends with `PROOF_OK`.

**Out of scope.** The `pg_constraint` comparison (stage 03 has it).
