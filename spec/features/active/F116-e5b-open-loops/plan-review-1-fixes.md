# F116 · Fixes for plan review 1

Part of [plan.md](plan.md). Review: [plan-review-1.md](plan-review-1.md) (PASS, 0 blocking, 17 gaps, 14 notes). One line per finding.

## Gaps

- G1 fixed: stage 10 makes `sentOriginOf` and `isOwnActionId` resolve loop-anchored actions (Sent copy = `system`, no analysis); test T9; D6.
- G2 fixed: follow-up keys `<loop>:follow_up:<n>:<k>` (stage 14), Delegate keys with `k` (stage 16); tests T8b, T9; D12.
- G3 fixed: candidates need `content = stored`; `pending` waits; `headers_only`/`gone` skip (stages 05, 12; T4c); D6.
- G4 fixed: restart only when To ∪ Cc overlaps; the quote is always the opening mail (stages 12, 14; T3, T8c); D9.
- G5 fixed: an open Waiting or Delegated loop closes `stale` 30 days after due, every mode (stage 15 T8); questions.md 17; D13.
- G6 fixed: follow-ups never join an approval set; one card each (stages 11, 15); D12.
- G7 fixed: the digest job in `channels` passes `loopConsent` into `reports` (stage 18).
- G8 fixed: the follow-up expiry of `onSentOff` moved to stage 10 (T10); stage 08 only closes and clears.
- G9 fixed: stage 20 needs 15; stage 23 needs 10 and 13; lanes in plan.md.
- G10 fixed: a sent mail in an open delegation's thread → `delegation_thread`, no loop (stage 12 T4b; interfaces).
- G11 fixed: a promise closes on any later own mail to the counterpart, any thread, as PD-122 says (stage 12 T4; questions.md 19).
- G12 fixed: the ⌛ line follows the consent rule (stage 18 T4).
- G13 fixed: `action_failed` and `send_held` of a follow-up with a fixed text and the panel link (stage 11 T3b).
- G14 fixed: the chaser visits every mailbox; closes run in every mode; the drafting parts keep the gate (stage 15 T8).
- G15 fixed: `laterLoop` returns `dueAt` (stage 14, interfaces).
- G16 not in this folder: the coordinator edits F115 stage 03 (final message); stage 07 and interfaces say what to do when F115 landed first.
- G17 fixed: the README "Sent bank" section holds the time-word rules and the time zone (stage 02 Done when; stage 04 step 1).

## Notes

- N1 fixed: stage numbers in stages 01, 05, 06 and interfaces; the gate guard is the CI test (stage 06).
- N2 fixed: C1 says 07–11 in plan.md and stage 06.
- N3 fixed: the ticket names the Wilson bound; questions.md 18.
- N4 fixed: word counts in plan.md § Planning progress.
- N5 fixed: stage 17 T7 uses `>=`; the same-day rule.
- N6 fixed: a member gets 403 on the route and `ownerOnly` in Telegram (stage 16).
- N7 fixed: the cap counts the triage cap's `QUOTA_TIMEZONE` day (stage 12).
- N8 fixed: after a follow-up or a restart the due is at least 3 working days on (stages 10, 12).
- N9 fixed: a delegated follow-up goes to the loop's `counterpart` (stage 14 T7).
- N10 fixed: an org flag off stops the jobs and hides loops; rows stay (stage 08, D18).
- N11 fixed: facts.md N3 (Not verified), checked at stage 25.
- N12 fixed: `LoopItem.delegate` shape; route bodies use `status` (stage 20).
- N13 fixed: the limit goes in the capability page (stage 24).
- N14 accepted: the PD-120 code change at G1 stays one small job; G6 no longer applies (no sets).
