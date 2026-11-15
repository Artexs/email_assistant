# F116 stage 14 — Loop commands

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people, roles). Needs stages 11 and 13. Checkpoint C2 follows (a review of 07–14; not a stop).

The service functions of `interfaces.md` § Commands, in module `loops`. Telegram (19) and `/api` (20) call them with their `via`.

## Step 1 — Draft follow-up

- **Goal:** `draftFollowUp(deps, ctx, { loopId, userId, via })` plans one follow-up pair or says why not.
- **Decisions, checked in this order under the loop lock (D15) and the settings share lock (the chaser's M13 rule):**
  1. Flag `open_loops` off → `feature_off`; no loop of the org → `not_found`; the user is not an owner → `not_allowed`.
  2. Loop closed → `closed`; kind `promised` → `not_allowed`.
  3. A follow-up send of the loop in `awaiting_approval`, `approved` or `applying` → `waiting` with its `sendId`.
  4. `follow_ups_sent = 2` → `limit_reached`; the second one before `last_follow_up_at` + 3 working days → `too_soon`.
  5. `thread_key` in `suspiciousThreadKeysOf` → `suspicious` (PD-128; any reason, whatever the `suspicious_mail` flag).
  6. Mode `shadow` → `would_draft` (one `loop.would_draft` audit row, no action); `assist` with `create_draft` off → `drafts_off`.
  7. Plan the pair with `createPlanned`: `create_draft` `ready`, `send` `awaiting_approval`, both with `loop_id`; keys `<loop id>:follow_up:<n>:<k>`, `k` = 1 + the count of this loop's closed (`rejected`, `expired`, `failed`) follow-up sends with the same `n` (review G2). A repeated tap after a crash finds the open pair (step 3: `waiting`); a tap after a reject gets a new `k`.
- **Payload:** `n` = `follow_ups_sent + 1`; `waiting` → To and Cc of the loop; `delegated` → To = the loop's `counterpart` only, no Cc (the address the mail went to, review N9); `quote` = `body_text` of `sent_email_id` (the mail that opened the loop, review G4) while stored, else null; `subject`, `sent_at` (of that mail) and `language` from the loop.
- **Test (integration):** T1 a waiting loop in `assist` → a pair with `loop_id`, payload To/Cc equal to the loop; T2 the same tap again → `waiting`, no second pair; T3 shadow → `would_draft`, no action row; T4 a suspicious thread → `suspicious`; T5 `follow_ups_sent` 1 and the last one 2 working days ago → `too_soon`, 3 days → planned with `n` 2; T6 a member → `not_allowed`; T7 a delegated loop → To is the counterpart only; T8 sent text cleared by retention → `quote` null; T8b a rejected follow-up, then a new tap → a new pair (`k` 2), the loop unchanged; T8c a restart by a later own mail → the quote is still the opening mail.

## Step 2 — Later, Done, Drop, Reopen, Untrack

- **Goal:** the other commands of `interfaces.md`, each under the loop lock, each with one audit row (`via`, ids).
- **Decisions (D11):**
  - `laterLoop`: open `waiting` or `delegated`; `later_count < 3` → `due_at = addWorkingDays(max(due_at, now), 3)` at 17:00 local, `later_count + 1`, answer `{ kind: "ok", dueAt }` (review G15); at 3 → `limit_reached`; `promised` → `not_allowed`. Any linked member.
  - `doneLoop`: any open loop → `closed` / `done` with `closed_by_user_id`; closed → `already`. Any member.
  - `dropLoop`: owner; open → `dropped`. `untrackLoop`: owner; only `delegated` → `untracked`.
  - `reopenLoop`: owner; a closed loop with texts (not `sent_off`, not cleared) → open, the old due (stage 08).
  - Done, Drop, Untrack expire a waiting follow-up of the loop (`loop_closed`).
- **Test (integration):** T9 now Fri 2026-11-20 09:00 Warsaw, Later three times from due Mon 2026-11-23 → due Thu 2026-11-26, Tue 12-01, Fri 12-04 (17:00), the fourth → `limit_reached`; T10 Done by a member → `done`, a second Done → `already`; T11 Drop by a member → `not_allowed`; T12 Reopen of a `replied` loop → open with its due; of a `sent_off` loop → `not_allowed`; T13 Untrack of a waiting loop → `not_allowed`; T14 Done with a waiting follow-up → the send `expired` / `loop_closed`.

## Check

`bun test apps/server/test/integration/<the new loops tests>`

## Done when

T1–T14 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s14`).

## Out of scope

The chaser (15), Telegram and routes (19, 20).

## Carry-over from stage 08 review

- The commands `laterLoop` and `reopenLoop` share names with the repo functions exported from `loops/index.ts`: alias the repo functions or rename the commands. Repo `laterLoop` takes a computed `dueAt` and refuses no kind: the command refuses `promised` with `not_allowed` (review-8.md N1, N2).

## Carry-over from stage 10 review

- N2: strip CR/LF from the subject in the writer. N4: D12 says a `delegated` loop sends to the counterpart only; stage 10 allows the full loop To and Cc: enforce D12 in the writer (review-10.md).

## Carry-over from stage 11 (worker, 2026-11-15)

- A follow-up that is `failed` has no "Send again" and no "It went out"; the failure notice is fixed text (`action_failed` with the panel link). A new follow-up is drafted from the loop: decide in `draftFollowUp` whether a `failed` follow-up counts as "waiting" (it does not: only `awaiting_approval` and `approved` sends do).
- The writer sets draft and send payloads with `to` and `cc` from the loop only, no `set_id` (`sendPayloadSchema` refuses it), and a subject without CR/LF. A panel edit keeps `to`, `cc`, `quote` and `n`.
- Full list: `notes/2026-11-15-f116-stage-11-follow-up-cards.md`.

## Built in stage 14 (worker, 2026-11-15)

Full note, with the obligation list and the evidence: `notes/2026-11-15-f116-stage-14-loop-commands.md`.

- `apps/server/src/modules/loops/follow-up-draft.ts` (`draftFollowUp`) and `loop-commands.ts` (`laterLoop`, `doneLoop`, `dropLoop`, `reopenLoop`, `untrackLoop`). The repo functions are now `setLoopLater` and `reopenLoopRow` (stage 08 carry-over: the commands own the plain names).
- The writer rules of the stage 10 carry-over are met in `draftFollowUp`: the subject has one line (`oneLineSubject`), a `delegated` loop writes to the counterpart only, no `set_id`.
- `createPlannedForLoop` (module `actions`) plans the pair with `loop_id` and no `email_id`.
- New audit event `loop.would_draft`; the audit rows of the commands carry `via`. New log fields `loop_id` (UUID) and `via` (code).
- Stage 13 review N2 (an alias of the user closes a loop): done. `ownAddressesOf(db, ctx, mailboxId)` adds every From address of the Sent rows of the mailbox (newest 100, lower case, trimmed) to the mailbox addresses; `matchReplies` and `isOpen` use it. A wrong alias can only hide a reply (the safe direction).

### Decisions taken (defaults, no owner input)

- `reopenLoop` sets `wait_from_at` to now. Without it, a reply that closed the loop (`replied`) closes it again at the next `loops.match` run, so Reopen would do nothing. The due date, `later_count` and `follow_ups_sent` stay (as stage 08 says).
- `reopenLoop` answers `not_allowed` while "Track my sent mail" is off: nothing would close or restart an open loop. It also refuses `close_reason = sent_off` on its own, not only through `texts_cleared_at`.
- With the flag `open_loops` off, `doneLoop`, `dropLoop`, `untrackLoop` and `reopenLoop` answer `not_found` (the type of `interfaces.md` has no `feature_off` for them); `draftFollowUp` and `laterLoop` answer `feature_off`.
- A loop whose recipients the draft schema refuses (none left after a DSR erase, a hidden character, a display name) gives `not_allowed` from `draftFollowUp`, with no row. The match job closes an empty-recipient loop `dropped` within 2 minutes.
- A `failed` follow-up does not count as waiting (carry-over of stage 11), also when its outcome is unknown; the user sees a new card and decides.
- `k` of the keys counts every follow-up send of the loop with the same `n`, not only the `rejected`, `expired` and `failed` ones (a superset; at that point none waits).

### Carry-over for later stages

- Stage 15 (chaser): `draftFollowUp` needs an owner user and writes `action.planned` rows with that user as actor. The chaser has no user: it needs its own caller of the same planning code (`judge`, `draftOf`, `createPlannedForLoop` in `follow-up-draft.ts`; actor `system`), or a `system` variant of the command. Decide there; the keys and the rules of this stage stay the same.
- Stage 19 and 20: the commands answer with the kinds of `interfaces.md`; `laterLoop` has `closed` and `feature_off` too. `reopenLoop` can answer `not_allowed` for a loop that the list still shows as closed (`sent_off`, tracking off): the card or route needs one text for it.
- Stage 21: the Reopen button should be hidden for `sent_off` loops and while Sent tracking is off.
- Docs (stage 24): `docs/capabilities/sent-mail.md` rule 21 describes the commands; rule 20 now names the alias rule.
