# Implicit state machines in the app

Date: 2026-11-11. Method: read the code (no run). Search for `transition`, `stateDiagram` in `docs/`, `apps/`, `packages/` found nothing.
No state machine has an explicit definition IN CODE (no transition table, no `canTransition`). `docs/architecture.md` §4.6 "Status flows" (and §4 rule 6) describe several of them as ASCII/prose: that is the only written map. Each one lives in a `status` text column, a CHECK constraint, and `UPDATE ... WHERE status IN (...)` guards in `repo.ts` files.

Legend: `A -> B [fn, file]`. "Guard" = the WHERE clause that allows the move.

## A. DB status columns (main machines)

### 1. `actions.status` (10 states) — most complex

Table: `actions`. Types: move, mark_read, flag, save_summary, create_draft, send.
States: ready, applying, applied, awaiting_approval, approved, rejected, expired, undone, logged, failed.
Initial state is set by `actionStatusFor(decision)` in `packages/core/src/triage/policy.ts`: apply -> ready, await_approval -> awaiting_approval, log_only -> logged.
Transitions:

- Idempotent actions (move, flag, mark_read, save_summary) go ready -> applied DIRECTLY, with no `applying` state (architecture.md §4 rule 6; `finishAction` default `from` = ready|applying). Only `create_draft` and `send` use `applying`.
- ready|approved -> applying [`markApplying`, actions/repo.ts:593; callers: drafts.ts:150, send.ts:380 only]. Guard: `locked_at` = claim token. A send starts only from `approved` with `approved_at`. (Its guard also admits non-send types, but no caller uses it for them [not verified by test].)
- applying -> applied [`finishAction`, repo.ts:640]
- applying|ready -> failed [`finishAction`, `countAttempt`; 3 hard tries, `HARD_ERROR_TRIES`]
- applying -> ready|approved [`releaseAction`, retry with `next_attempt_at`; "SMTP never started" goes back to approved]
- ready -> expired("stale") [repo.ts:759]; ready -> expired [repo.ts:1050 `expireReadyDraft`]; applying -> expired("send_closed") [repo.ts:1300]
- applied -> undone [`markUndone`, repo.ts:783] (a reverse action row is inserted by `insertReverse`)
- awaiting_approval -> approved [repo.ts:1342, user tap]
- awaiting_approval|approved -> rejected [repo.ts:1367]
- awaiting_approval|approved -> expired [`setExpired` / `expireSend`, expiry.ts]. Reasons: timeout, draft_missing, not_notified, held_timeout, policy_changed, delegation_closed. `approved` closes only for held_timeout and delegation_closed.
- failed -> (new row) approved [`insertSendAgain`, repo.ts:1395]. Not a transition on the same row: a NEW send row with key `<id>:again`.
  Hidden extras:
- Crash recovery: a stale `applying` send ends as `failed/outcome_unknown` (send.ts:412-450). A claim older than `STALE_AFTER_MS` (10 min) counts as dead.
- Coupling: `send` depends on `create_draft` (`depends_on_action_id`). Send needs draft `applied`; draft `failed|undone` closes the send (`draft_missing`). Two rows move as one pair.
- CHECK constraints guard some edges: `applied_at` required for applied/undone; send never `ready`; send needs `approved_at` for approved/applying/applied.
- Sub-state in flags: `notified_at` (owner got the request), `result_notified_at` (owner got the result), `approved_*`.
  Risk: guards are spread over about 12 functions in one 1600-line file; no single list of legal edges. `undone` and `rejected` have no tests-as-table.

### 2. `emails.status` (5 states) — triage queue

States: pending, processing, triaged, done, skipped.

- pending -> processing [`claimEmails`, mail/repo.ts:~900]. Also stale processing (`locked_at < staleBefore`) -> processing again, `attempts + 1`.
- processing -> pending [`releaseEmail`, retry, `next_attempt_at`]
- processing -> triaged | skipped("too_old") [`finishEmail`]
- skipped -> pending [backfill, repo.ts:1094, sets `backfilled_at`]
- `done` is in the CHECK list and architecture.md §4.6 says "triaged -> done (done = all its actions have an end status)". A grep of `apps/server/src` and `packages/core/src` (non-test, non-delegation) for a `"done"` status writer found none. So it is a design-vs-code gap: either never built, or dead. Do NOT delete it; ask the user.
  Guard: optimistic lock `status='processing' AND locked_at = <token>`.

### 3. `emails` location flags — a hidden machine in 5 columns

Columns: `folder`, `source_folder`, `moved_at`, `returned_at`, `undo_pending_at` (+ `uid`, `inbox_uid`).
Derived states:

- in source: `folder = source_folder`
- system-moved: `folder <> source_folder` (set after a move action; `moved_at` set)
- returned: user moved it back into a synced folder; `returned_at` set by sync [`markEmailReturned`], cleared by `clearReturned` after feedback is written (D8/D12)
- relocated: user moved it between synced folders [`markEmailRelocated`]
- undo in flight: `undo_pending_at` set by `setUndoPending` (undo.ts:71) and cleared by `updateEmailLocation({undoPendingAt:null})` or on failure (apply.ts:88)
  This machine has no status column. States come from comparing columns; the comment markers D8, D12, D22 are the only map.
  Risk: highest. The sync job, the undo service and the move apply step all write these columns.

### 4. `mailboxes.status` (3 states)

States: active, auth_error, paused. Plus `status_changed_at`.

- active <-> paused [`changeMailboxStatus`, conditional; user via web/telegram, `switchMailboxStatus` in mail/status.ts]
- any -> auth_error [`setMailboxStatus`, UNCONDITIONAL; sync job mail/jobs.ts:71, committer.ts:200,282]. It overrides paused.
- auth_error -> active [connect.ts:242, new password]. A paused mailbox stays paused.
- active -> paused -> (deleted | back to active) during `removeMailbox`: the pause is a lock step, and a failed delete restores `active` (remove.ts:42-66). This is a saga inside one function.
  Consumers read this as a machine: notices.ts `detectAuthError` / `detectSync` use `status_changed_at` as an "episode id" in the dedup key.
  Risk: `setMailboxStatus` is unconditional, so "paused -> auth_error -> active" loses the pause (comment in repo.ts:403 says it is on purpose).

### 5. `outbox.status` (4 states) — Telegram message queue

States: pending, sending, sent, failed.

- pending -> sending [claim, channels/repo.ts:299]; stale sending (`locked_at < staleBefore`) -> sending again (`was_stale`)
- sending -> sent [`markOutboxSent`]; sending -> pending [`releaseOutbox`, retry]; sending -> failed [`failOutbox`, error_code]
- pending -> failed("outdated") [`cancelPendingOutbox`, repo.ts:406]
  CHECK ties: `sent` <=> `sent_at` not null; `sending` needs `locked_at`.
  Special: `dedup_key` makes enqueue idempotent.

### 6. `delegations.status` (6 states)

States: drafted, sent, answered, overdue, done, cancelled.

- drafted -> sent [`markDelegationSent`, when the paired send action applies; hook `onSent`]
- cancelled -> sent [same function; "Send again" after outcome_unknown]
- drafted -> cancelled [`markDelegationCancelled`, hook `onCancelled`]
- sent -> overdue [`markDelegationOverdue`, chaser job]
- sent|overdue -> answered [`markDelegationAnswered`, when a reply mail arrives]
- answered|overdue -> done [`markDelegationDone`, user closes]
  Sub-state: `reminders_sent` (max 2 while overdue), `last_reminder_at` (3-day gap), `answered_notified_at`.
  Cross-machine link: delegation moves are driven by `actions` machine hooks (`DelegationHooks` in actions/hooks.ts). Two machines, one event source.
  Note: `cancelled -> sent` is a back edge that the name "cancelled" hides.

## B. Timestamp-as-state (no status column)

### 7. `chat_link_tokens` (Telegram linking)

States are derived from `used_at` and `expires_at`: fresh -> used | expired. Consume guard: `used_at IS NULL AND expires_at > now` (channels/repo.ts:87-90). Cleanup deletes used or old rows.
The web UI mirrors it as the `link` state of `TelegramLink.tsx`.

### 8. `digests` (`slot_key`, `sent_at`)

States: planned (row exists) -> sent (`sent_at` set). `UNIQUE (org_id, user_id, slot_key)` makes a slot run once.

### 9. Notice episodes (notices.ts)

Not stored as a state: derived from `mailbox.status`, `status_changed_at`, `last_synced_at` and outbox rows.

- auth_error episode: key `auth_error:<id>:<status_changed_at>`; leaving the status cancels pending notices.
- sync episode: ok -> grace -> stale (notice sent) -> ok again (`sync_ok` notice, only for members that got the stale notice, `listSentStaleEpisodes`).
  Also a boot grace: `STALE_GRACE_AFTER_START_MS` after the process starts.
  Risk: the machine is reconstructed on every tick from 4 inputs; a clock or restart bug gives duplicate or missing notices.

### 10. Onboarding (`packages/core/src/web/onboarding.ts`)

`onboardingOf` computes a checklist from counts (mailbox, telegram, mode, rules). `done = mailbox && (telegram || !available) && modeChosen`. It is a pure derived state, with no stored step. Good style; listed for completeness.

### 11. Mailbox `mode` (shadow | assist) + `tool_switches`

Config, not a lifecycle. But `decidePolicy` (core/triage/policy.ts) uses it as a gate that picks the initial state of every action (logged vs ready). Shadow -> assist changes behavior for future mail only.

## C. In-process (memory) machines

### 12. `LlmPause` (triage/pause.ts)

States: running <-> paused(until). `trip(kind)` doubles the pause (5 min base, 60 min max); `reset()` after a good call. Per process, lost on restart. `soft` vs `config` only changes the log text.

### 13. Telegram polling (channels/telegram/polling.ts)

States: running -> backoff(1,2,4..30 min) -> running; 401 -> stopped (terminal); `stopping` flag for shutdown. Variables `stopping`, `failures`. 409 and other errors share the same retry path.

### 14. Scheduler (platform/scheduler.ts)

Per job: idle <-> running; a tick during running is skipped (`protect`). Implicit lock by croner.

### 15. Heartbeat (platform/heartbeat.ts)

Stateless: no machine. (Checked; skip.)

## D. Web UI (apps/web)

- `SetupPage.tsx`: `mode` = form | invalid | missing (explicit union; set from URL and from an INVALID_TOKEN error). Closest to a real FSM in the repo.
- `ConnectDialog`, `PasswordDialog`, `RemoveDialog`, `LoginPage`: 3-5 booleans each (`pending`, `error`, `fieldErrors`, `failed`, `setupDone`). Impossible combinations are possible (e.g. `pending` + `error`). Candidates for one `status` union or `useReducer`.
- `TelegramLink.tsx`: `link` (null | LinkState), `off`, `busy`, `confirmOpen`, plus server `linked`. Effects sync them (link open + poll says linked -> close). Poll interval changes with `link` (5 s vs 30 s).
- `use-resource.ts`: `{data, error, loading}` — loading/error/data can overlap (stale data kept on error). `poll.ts`: visible <-> hidden pauses the timer.

## Ranking (where an explicit definition pays most)

1. `actions.status` (+ draft/send pair + delegation hooks): most edges, money-like risk (sends mail), guards spread out.
2. `emails` location flags: no status column, 5 writers.
3. `mailboxes.status`: unconditional write path, saga in `removeMailbox`.
4. `delegations.status`: back edge cancelled -> sent.
5. Notice episodes: derived each tick.
6. Web dialogs: boolean soup.
   Low priority: `emails.status` (guarded well; check the missing `done` writer), `outbox` (small and clean).

## Possible next step (not done)

One `transitions.ts` per machine: a const map `{from: [to...]}` + a unit test that every `UPDATE ... WHERE status IN` list matches the map. Start with `actions`. Ask before you do it; it is a refactor.

## Corrections (2026-11-11, plan session for `tasks/planned/state-machine-transitions.md`)

Checked against the code by reading (nothing run). The plan file holds the full, corrected edge table of `actions.status`.

- `repo.ts:1050` is `expireReadyOriginals` (`ready → expired`, reasons `policy_changed`, `undo`, `manual`; callers `expire.ts` ← `undo.ts`, `config/service.ts`, `scripts/mailbox-settings.ts`). `expireReadyDraft` is at `repo.ts:1292`.
- `applying → expired (send_closed)` comes from `finishAction` in `drafts.ts:242`, not from `repo.ts:1300`.
- Missing edges above: `approved → failed` (`send.ts`, `finishAction` with `from: ["approved"]`: `bad_payload`, third compose error `smtp_error`), `applying → applying` (`releaseAction`: `drafts.ts:132` error at the APPEND, `send.ts:455` error in the send recovery), and the retry self-loops `ready → ready`, `approved → approved`.
- `markUndone` callers: `apply.ts` (`undo`), `triage/returned.ts:43` (`user_moved_back`, outside `actions`), `drafts.ts:311` (`sent`, `rejected`, `expired` for a draft).
- `delegation/chaser.ts:160` creates reminder rows (draft `ready`, send `awaiting_approval`) without `actionStatusFor`.
- `undo.ts` writes no status directly: it calls `insertReverse` and `expireReady` (→ `expireReadyOriginals`, reason `undo`).
- Latent edges (a guard admits them, no caller uses them): `releaseAction` `ready → approved|applying`, `approved → ready|applying`; `markApplying` for a non-send `approved` row; `finishAction` default `from` lets `ready → expired`; `markUndone` has no type guard.
