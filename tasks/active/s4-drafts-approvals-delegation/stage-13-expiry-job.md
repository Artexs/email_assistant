# s4-drafts-approvals-delegation — Stage 13

Part of [`../s4-drafts-approvals-delegation.md`](../s4-drafts-approvals-delegation.md). Read that file's "Input" and "Rules for every step" first.

## Stage 13 — `actions.expiry`: 48 h, `draft_missing`, `not_notified`, `held_timeout`; cancel and draft removal; the gate-close expiry [risky]

Why risky: an expired approval must never send later, a send held after the tap must not go out days later without a new tap, and a missed expiry leaves a draft in the user's real Drafts folder for ever.

- [ ] **13.1 `createExpiryJob` (D22, D13, D6)**
  - Goal: every hour, approvals that timed out, lost their draft, or never reached an owner, and approved sends that were held for 48 h, become `expired`; their drafts get a removal row (or are expired before they land), their delegations are cancelled, and the result notice follows.
  - Files: change `apps/server/src/modules/actions/expiry.ts` (stage 7.1 created it with `expireSend` and `closeDraftOfSend`; this step adds the job), `apps/server/test/integration/actions-expiry.test.ts` (create), `apps/server/src/modules/actions/index.ts`, `apps/server/src/modules/mail/repo.ts` and `mail/index.ts` (`listMailboxTargets(db, opts: { statuses: readonly MailboxStatus[] })`, a scheduler entry point like `listSyncTargets`, which becomes `listMailboxTargets(db, { statuses: ["active"] })`); `docs/code-patterns.md` is updated in stage 21 (the entry-point list).
  - Interfaces:

    ```ts
    export const APPROVAL_TTL_MS = 48 * 3_600_000; // the same constant as stage 10 (one export, re-used); also the held-send limit after approved_at
    export const UNNOTIFIED_TTL_MS = 7 * 24 * 3_600_000;
    export const EXPIRY_BATCH = 200;
    export interface ExpiryDeps {
      db;
      now(): Date;
      hooks: DelegationHooks;
      uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
    }
    export function createExpiryJob(deps: ExpiryDeps): { run(): Promise<void> };
    // expireSend(trx, ctx, sendId, { reason, now, actor, hooks, uidplus }) and closeDraftOfSend: stage 7.1
    ```

  - Decisions:
    - `run()`: `listMailboxTargets(db, { statuses: ["active", "paused", "auth_error"] })` (expiry is time, not sync: a paused mailbox's approvals still age); per mailbox `ctx = { orgId }`, `rows = listExpiredApprovals(db, ctx, mailboxId, { now, limit: EXPIRY_BATCH, staleBefore: now − STALE_AFTER_MS })` (stage 10.2; `expiry.ts` imports `STALE_AFTER_MS` from `./constants`, stage 7.1, never from `./committer`: S3 feature 6), `uidplus = await deps.uidplus(ctx, mailboxId)` once per mailbox; for each row one transaction `expireSend(trx, ctx, row.id, { reason: row.reason, now, actor: "system", hooks, uidplus })`. One mailbox's error never stops the next (the S1a job pattern); the error line holds the mailbox id and `describeError`.
    - `expireSend` (stage 7.1) does the per-row steps: the conditional `setExpired` (false: a tap, a send or another close won the race; nothing is written), audit `action.expired`, `closeDraftOfSend` (the reverse row for an `applied` draft with UIDPLUS, the expiry of a `ready` draft), the delegation `cancelled` (`draft_missing` for `draft_missing`, else `expired`) for a delegation send, `result_notified_at` null so the notifier sends the result (D20). Reminder sends that expire change the delegation nothing (it stays `overdue`; the chaser makes a new reminder after the 3-day gap: D23).
    - `held_timeout` (D22 (d), review round 2 N1): an `approved` send with `approved_at` older than 48 h and no fresh lock (the scope held it, the mailbox was paused or in `auth_error`, or a soft retry waited) is expired, so it never goes out later without a new tap, also not at the switch from `SEND_SCOPE=self` to `all` (stage 23.1). A send in flight (a fresh `locked_at`) is not touched: it finishes.
    - `uidplus(ctx, mailboxId)` = `mailboxHasUidplus` (the `mail` index, stage 7.1), given as a dependency so the tests can set it; the job reads it once per mailbox per run.
    - An `awaiting_approval` row whose draft is `applying` or `ready` is not `draft_missing` (the draft may still land); only `failed` and `undone` drafts count.
    - Log: `expiry <mailboxId>: expired <n> (timeout <a>, draft_missing <b>, not_notified <c>, held_timeout <d>)` when `n > 0`.
  - Test (`actions-expiry.test.ts`, `withRollback`, `pauseOtherMailboxes` first, fixtures, a recording `hooks` fake, `uidplus` → true): (1) a send `awaiting_approval` with `notified_at` 49 h ago and an applied draft → `expired` / `timeout`, audit `action.expired`, a reverse `create_draft` row `ready` with `reason: "expired"`, `hooks.onCancelled` with `expired`; (2) `notified_at` 47 h ago → unchanged; (3) a send whose draft is `failed` → `expired` / `draft_missing`, no reverse row, the hook with `draft_missing`; (4) `notified_at` null and `created_at` 8 days ago → `expired` / `not_notified`, the hook with `expired`; 6 days → unchanged; (4b) `timeout` with a `ready` draft → the draft `expired` / `send_closed`, no reverse row; (5) a paused mailbox's send 49 h → expired (the job walks paused mailboxes); (6) an `approved` send with `approved_at` 49 h ago and `locked_at` null → `expired` / `held_timeout`, a reverse row, the hook with `expired`; with `approved_at` 47 h ago → unchanged; with `approved_at` 72 h ago and `locked_at` 1 min ago → unchanged (in flight); (7) a clarification send → expired, no hook call; a reminder send → expired, no hook call; (8) `uidplus` false → no reverse row; (9) a race: the test approves the row in another transaction before `expireSend` → `expireSend` false, no audit row, no reverse; (10) two organizations in the run → both handled; an error on the first mailbox (`listExpiredApprovals` made to throw once through a test seam) → the second mailbox is still handled; (11) tenant: the rows of org B are untouched by org A's ctx.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: the schedule in `main.ts` (stage 18), the notice text (stage 14).

- [ ] **13.2 Gate close for drafts and sends (S3 D13, D33)**
  - Goal: when the user turns the `create_draft` switch off or sets the mode to `shadow`, the sends that wait for approval are closed (with their drafts) in the same transaction, so nothing planned under the old setting lands or asks for a tap later (the S3 rule B3 for mailbox actions, extended to S4).
  - Files: change `apps/server/src/modules/config/service.ts` (S3 stage 14: `closedBy`), `apps/server/src/modules/actions/expire.ts` (S3 stage 10: `expireReady`), `actions/repo.ts` (`ExpireFilter`), `apps/server/src/scripts/mailbox-settings.ts` (S3 stage 14.2: the composition root of `SettingsDeps.expireReady`), `apps/server/test/integration/config-settings.test.ts`, `apps/server/test/integration/actions-undo.test.ts` (the S3 `expireReady` cases still pass).
  - Interfaces:

    ```ts
    // actions/repo.ts (S3 7.1b, extended)
    export interface ExpireFilter {
      mailboxId: string;
      emailId?: string;
      types: readonly MailboxActionType[];
      sends?: true; // also close the awaiting_approval sends of the mailbox (and their drafts)
      category?: …; // S3
    }
    // actions/expire.ts (S3 stage 10; S4 adds `sendClose`)
    export async function expireReady(
      trx: Transaction<DB>,
      ctx: TenantContext,
      filter: ExpireFilter,
      opts: {
        now: Date;
        reason: "policy_changed" | "undo" | "manual";
        actor: string;
        sendClose?: { hooks: DelegationHooks; uidplus: boolean }; // required when filter.sends is true (else a HardError)
      }
    ): Promise<{ id: string; emailId: string; type: ActionType }[]>;
    // config/service.ts closedBy (S3 14.1, `service.ts:60-62`): the return type widens to
    //   { types: MailboxActionType[]; category?: { is: string } | { not: string }; sends?: true } | null (M5)
    // switch create_draft off → { types: [], sends: true }; mode shadow → { types: ["move", "mark_read", "flag"], sends: true }
    // the setter spreads it into the filter as today (`{ mailboxId, ...filter }`, `service.ts:161-166`), so `sends` reaches expireReady
    ```

  - Decisions:
    - **Why the cascade is complete (S3 feature 1).** The setter locks the settings row `FOR UPDATE`; `saveTriage` (S3 `4376875`) and the chaser (stage 17.1, M13) share-lock it and compare its version before they insert a draft-and-send pair. So a pair planned under the old setting either commits before the setter's lock (and this close sees it) or sees the new version and writes nothing. Do not add a path that plans a new draft and `awaiting_approval` send pair without that guard (`sendAgain`, stage 10.2, inserts an `approved` row after a tap; a gate close does not touch `approved` sends).
    - **Where the send close runs (M5).** In `expireReady` (`actions/expire.ts`), after its S3 call to `expireReadyOriginals` and its audit loop; never inside `expireReadyOriginals` (`repo.ts:672`): that function returns `[]` at once when `filter.types` is empty (`repo.ts:678-680`), and `create_draft off` gives `types: []`.
    - `expireReady` with `filter.sends`: after the S3 part, each `awaiting_approval` send of the mailbox (`FOR UPDATE`, oldest first) → `expireSend(trx, ctx, id, { reason: "policy_changed", now, actor, hooks, uidplus })` (stage 7.1: the draft reverse row when the draft is `applied`, the draft expired when `ready`, the delegation `cancelled` / `expired`, `result_notified_at` null, so the user gets `⌛ Not sent: the setting was changed`: the stage 14 text); the closed sends join the returned list (`type: "send"`). The drafts are closed through their sends, so `types` never holds `create_draft`.
    - `SettingsDeps.expireReady` keeps its S3 type (the setters call it with `{ now, reason, actor }`). Every composition root wraps it (review round 2, N23): `expireReady: async (trx, ctx, filter, opts) => expireReady(trx, ctx, filter, { ...opts, sendClose: { hooks, uidplus: await mailboxHasUidplus(trx, ctx, filter.mailboxId) } })` with `hooks = delegationHooks({ db })` (the `delegation` index). The roots are `scripts/mailbox-settings.ts` (`:55`, `deps: SettingsDeps = { db, now: () => now, expireReady }`; this step) and the test files; S5's settings page does the same. **The test helper (M5):** `config-settings.test.ts:41` builds `deps: { db: trx, now: () => NOW, expireReady }` with the bare function and calls `setMode shadow` (lines 121, 235, 333); with `closedBy` giving `sends: true` and no `sendClose`, `expireReady` throws. Wrap `expireReady` in that helper the same way (with a recording `hooks` fake and `uidplus` from `mailboxHasUidplus`). `triage-settings-race.test.ts` (`:47`, `:87`, `:124`) passes the bare function too, but it changes only the `move` switch (no `sends`): it can stay as it is. The S3 `expire-ready` subcommand passes no `sends` and needs no `sendClose`.
    - **`setMode assist` (S3 feature 5, `9f9f166`):** without `--keep-switches` it closes the gates of the switches it turns off (`alsoClose`, `config/service.ts:201`). `ASSIST_DEFAULT_SWITCHES` (`packages/core/src/triage/settings.ts:53`) sets `move`, `mark_read`, `flag`, `move_unsure` and leaves `create_draft` as it is, so `setMode assist` never turns `create_draft` off and closes no send: test (17) holds.
    - `approved` sends are not touched by a gate close (the user tapped; they go out, are held by the scope, or expire as `held_timeout` after 48 h: 13.1).
    - The CLI text: S3 stage 14.2 prints `expired <n> ready actions`; `n` now also counts the closed sends (one line change, done here).
  - Test (`config-settings.test.ts`): (15) `setToolSwitch create_draft off` on a mailbox with a `ready` draft + `awaiting_approval` send pair (delegation) and an `applied` draft + `awaiting_approval` send pair → both sends `expired` / `policy_changed`, the `ready` draft `expired` / `send_closed`, a reverse row for the applied draft, the delegation rows `cancelled` / `expired`, `hooks.onCancelled` called twice; an `approved` send untouched; (16) `setMode shadow` does the same plus the S3 mailbox rows; (17) `setMode assist` (also without `--keep-switches`: S3 feature 5) and `switch on` expire nothing; (18) `expireReady` with `sends: true` and no `sendClose` → throws; (19) the S3 unit row `expect(closedBy({ field: "switch", name: "create_draft", to: false })).toBeNull()` (`config-settings.test.ts:394`) becomes `toEqual({ types: [], sends: true })`, and the `mode shadow` row (`:374`) gets `sends: true`. `actions-undo.test.ts`: the S3 cases unchanged.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: the S5 settings page.
