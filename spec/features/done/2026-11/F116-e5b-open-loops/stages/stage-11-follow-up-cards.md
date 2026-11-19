# F116 stage 11 — Follow-up cards, lists and expiry

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people, privacy, Polish text). Needs stages 10 and 17 (the consent gate).

After this stage a loop-anchored follow-up behaves like every other draft: a card in Telegram, a row in `/approvals`, the 48 h expiry and the send-result notice. The stage 09 filters `email_id IS NOT NULL` go away in these places.

## Step 1 — Card and notices

- **Goal:** `renderApprovalRequest` (`core/digest/approvals.ts`) handles kind `follow_up`; the approval detector queues it. A follow-up never joins an approval set (review G6): one card per follow-up, so the owner sees the rendered mail (PD-120) and a set tap can never approve one.
- **Decisions:**
  - Card: title "📝 Follow-up" / "📝 Przypomnienie o odpowiedzi"; `To:` and `Cc:` spelled out (addresses; the recipients are the M3 risk, epic risk table); the subject; the exact body of the message of stage 10 (template, signature, quote); "Follow-up {n} of 2"; buttons 📤 Send and ✖️ Reject (the existing `ap:`/`ar:`). The quote shrinks first under the 4096 cut, then the body is cut with "…", never the recipients.
  - `action_failed` and `send_held` of a follow-up (review G13): "A follow-up could not be sent" / "A follow-up waits: send limit" with the panel link; no address, no text, so no consent check; to the linked owners, as for other kinds.
  - Consent (D17): a card of kind `follow_up` goes only to a user whose consent covers loop data (`consentCovers`, stage 17). Others get one `loop_consent` line per day: "A follow-up waits for your approval in the panel." with the panel link, no recipient, no text.
  - Roles: owners only (the existing approval rule).
- **Test (unit):** T1 pl and en card of a follow-up with To 1 and Cc 2 → both lines present, Send and Reject; T2 a body of 5,000 characters → the card fits 4096, recipients intact; T3 the set renderer refuses a `follow_up` item (a test); T3b a follow-up that fails at SMTP → one `action_failed` row with `loop_id` and the fixed text.
- **Test (integration):** T4 a follow-up send `awaiting_approval` with an applied draft → one card per linked owner with a current consent, the `loop_consent` line for an owner with an old consent, none for a member.

## Step 2 — Lists, read model and expiry

- **Goal:** `GET /approvals`, `GET /approvals/:id` (the F102 read model in `channels`), the expiry jobs and the `send_result` notice include loop-anchored sends.
- **Decisions:**
  - `ApprovalItem` for `follow_up`: `mailboxAddress` from the loop's mailbox, `view` from `anchorOf`, `quote` = the anchor quote, `delegationId` null, new optional `loopId`.
  - Edit (F102 `POST /approvals/:id/edit`): allowed for `follow_up` (subject and body; recipients never change; a `delegateId` → 400 `validation`). The supersede path keeps `loop_id` on the new pair.
  - Expiry: the existing TTLs. An expired or rejected follow-up does not change the loop (it stays open; the brief shows it again).
  - `send_result`: "Follow-up sent to anna@example.test" / "Przypomnienie wysłane do anna@example.test" (the loop's first To), consent-gated like the card.
  - The activity page lists actions of incoming mail only; follow-ups show on the loop page (stage 21).
- **Test (integration):** T5 `GET /approvals` lists a follow-up with `loopId` and `view.to`; T6 edit of its body → a new version with the same `loop_id`; edit with `delegateId` → 400; T7 a follow-up not tapped for 48 h → `expired`, the loop still `open`; T8 an applied follow-up → one `send_result` row with `loop_id` and no `email_id`.

## Check

`bun test packages/core/src/digest apps/server/test/integration/<the touched approval tests>`

## Done when

T1–T8 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s11`).

## Out of scope

Planning a follow-up (14, 15), the loop lines in the digest (18).

## Carry-over from stage 09 (worker, 2026-11-15)

The `outbox` mail-kind checks accept `email_id` or `loop_id` (stage 09 migration) for `urgent`, `action_failed`, `approval`, `approval_set`, `send_result`, `delegation_answered` and `approval_edit`. No check limits `outbox.loop_id` to the follow-up kinds; the card code does. The card detectors and the approval list leave loop rows out until stage 10/11 (`stage-10-follow-up-kind.md` § Carry-over from stage 09 lists each reader). A card edit (F102 `approval_edit`) of a loop card reads `outbox.loop_id`; `edit_of_outbox_id` stays the link to the sent card.

## Carry-over from stage 10 (worker, 2026-11-15)

Stage 10 opened the committer side for a loop action: the claim and its counts, `getDraft` / `lockDraft`, `listRecentSends` (the send limits, now `to` ∪ `cc` and loop sends), `sentOriginOf` / `isOwnActionId`, and `expireSend` (through `lockAnySend`). It did not open the readers that this stage owns. Each one still has its explicit `email_id IS NOT NULL` and a test in `actions-loop-anchor.test.ts` that proves it; turn each into the positive test when you open it:

- `getSend`, `lockSend`, `listSetSends`, `getSetSend` and `sendBase` (`actions/repo/sends.ts`): mail-only on purpose. `approve`, `reject`, `editApproval`, `sendAgain`, the approval read model (`channels/approvals-read.ts`) and `heldReason` use them, so a tap or a route on a loop send answers "not found" until this stage. `getAnySend` / `lockAnySend` return `AnySendRow` (`email_id` or `loop_id`, plus `mailbox_id`); `SendRow.email` is still the mail shape. Decide for the card code: widen `SendRow` or add a loop row type next to it.
- `listApprovalSends`, `countWaitingApprovals`, `listExpiredApprovals`, `listUnseenApprovalSends`, `listAwaitingSendIds`, `countApprovals`, `listSendsToNotify`, `listSetsToNotify`, `listSendResultsToNotify`, `listFailedUnnotified`, `listSendLimitHolds`: the 48 h expiry, the card, the result notice and the failure notice for a follow-up.
- `renderApprovalRequest` throws `RangeError` for kind `follow_up` (no wrong "Delegation to" title goes out). `renderSendResult` has no closing line for it. The panel title key `appr_title_follow_up` exists; the card texts of this stage's Step 1 do not.
- A follow-up send ends `expired` / `loop_closed` (a closed loop, the switch off). The card edit for that end belongs here: the existing `ApprovalHooks.onDecided` has no caller for it, because `expireSend` and the sent-off hook call no approval hook. The committer path also ends a claimed send this way without any hook. Queue the card edit from the reader that finds `expired` sends of loops, or pass the hook through `onSentOff`.
- The follow-up `ApprovalView.sender` is null (like a reminder); `ApprovalView.recipient` is the first To only and has no Cc field. The card needs To and Cc.
- `loopHooks()` takes no argument (the stage text says `loopHooks(deps)`): nothing needed a dependency.
- Not claimed by the committer, by design: a follow-up send is claimed only when `approved` with `approved_at`, its draft `applied`, and every address of To and Cc passes `SEND_SCOPE self`.

## Carry-over from stage 10 review

- N1: `onSentOff` clears the loop To and Cc, so an approved follow-up claimed before the switch-off ends `failed / bad_payload`, and after SMTP + crash + switch-off `failed / outcome_unknown` (`follow_ups_sent` 0, no second mail): the failure notices handle both. N6: `heldReason` of a loop send says scope (`getSend` is mail-only). N7: `detectForOrg` has no catch per detector: add one with the follow-up cards, so a `NoticeViewError` cannot stop the later detectors of the org (review-10.md).

## Carry-over from stage 17 review

- N4 (count only consent rows newer than the user's last chat.unlinked row), N5 (one choke point loopConsentOf(db, ctx, userIds) with a border test; this stage calls it for the follow-up approval card and the send_result notice: a not-covered owner gets the loop_consent line), N6 (keep open_loops off until stage 22 lands) (review-17.md).
