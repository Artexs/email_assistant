# F115 stage 12 — "Replies ready" and the review

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people, privacy, Polish text). Needs 09.

## Step 1 — The notice `replies_ready`

- **Goal:** a detector queues `replies_ready` for each linked owner when a reply send became `awaiting_approval` with its draft `applied` after that owner's last `replies_ready` row, and that row is at least 2 h old. View: `{ count, now, timeZone }` (open reply sends of the org). Button "Review" (`reply_review`); the panel link line when `WEB_BASE_URL` and `approvals_page` are set.
- **Decisions:** the count leaves out sends whose mail is answered or flagged by the DB facts (notes §3.7). Quiet hours hold it; the 2 h gap counts from the queue time. Dedup key `replies_ready:<userId>:<first new send id>`. Flag `reply_drafts` off → no detector run. The morning digest gets one line "📝 N replies ready" (a digest view field), no buttons. Set `notified_at` of the counted sends (stage 05 expiry ignores it).
- **Test (integration, fixed clock):**
  1. Two new drafts → one row per linked owner, `count` 2; a member gets none.
  2. A third draft 1 h later → no row; at 2 h 1 min → `count` 3. An answered mail's draft is not counted.
  3. A draft at 23:00 org time → the row waits until 07:00.
  4. Render pl and en with `count` 1, 3 and 5 (Polish plurals).

## Step 2 — Review cards

- **Goal:** `reply_review` (optional `afterId`) answers with the next open reply send after `afterId` (order `created_at`, id), as outbox kind `approval`. Dedup key `approval:<sendId>:r<n>` (n = 1 + earlier review cards of that send for that user): a skipped card must show again (review G6). F102's `listCardsOfSend` must find these keys (test). The approval detector skips kind `reply` (D15). After Send, Reject or Skip the next card is queued; none left → "No more replies waiting."
- **Card** (`renderApprovalRequest`, kind `reply`): title, `To:`, `Cc:`, `Reply-To:` when it differs from `From`, gaps first ("Fill these: …"), the full body, the quote (shrinks first), the stage 08 line, and when `sentVisible` is false "I cannot see your sent mail; check you did not answer already." Buttons here: 📤 Send (not with gaps), ✖️ Reject, ⏭ Skip. Stage 13 adds ✍️ Redraft, 👥 Reply all (only with other To or Cc) and "Use Reply-To" (only when it differs).
- **Decisions:** owners only for every reply tap; a closed send is skipped.
- **Test:**
  1. Unit: the pl and en card of a reply with one gap → no Send button, the gap line first; without gaps → Send.
  2. Integration: Review → card of the oldest send; Skip → card of the second; Skip on the last → "No more replies waiting."
  3. Integration: Send on a card → `approved`, then the next card is queued.
  4. A member taps Review → the owner-only answer.
  5. The approval detector queues no card for a new reply send.

## Step 3 — Consent bump

- **Goal:** `TELEGRAM_CONSENT_VERSION` > the current value (F116 stage 17 rule): the land date, else `<date>.2` (`.3`, …) when the current value already has that date; `REPLY_CONSENT_SINCE` (`packages/core/src/web/telegram.ts`) = the new value. The consent text (en, pl) adds: "reply drafts that the AI writes for you, and the addresses of the other recipients of a mail (To, Cc, Reply-To) when a reply goes to them". One commit with both texts and the version.
- **Linked chats (D16):** covered = `consentCovers(consentVersionsOf(user), REPLY_CONSENT_SINCE)` (`version >= since`; null never). Reuse them and `POST /api/telegram/consent` from F116 stage 17 when on `master`, else build them in its shapes. Not covered: no review card; `replies_ready` shows only the count, the panel link and "Confirm the new Telegram terms in the panel to review here." The panel button is stage 15.
- **Test:** unit: new version > previous, = `REPLY_CONSENT_SINCE`, ≥ `OPEN_LOOPS_CONSENT_SINCE` when present. Integration: a link with the old version → 409 `telegram_consent_outdated`, the new one → linked; a user linked with the old version taps Review → panel-link answer, no card; after the consent route → cards.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** Redraft, Reply all, Draft reply (13).

## Carry-over from stage 04 and 05

- **The approval detector skips `reply`.** Test 5 above is the proof: the detector (`channels/notices/approval.ts`) lists only sends whose payload kind is not `reply`. Stage 05 also made the `not_seen` rule skip replies (a reply has no `approval:<id>` card), so a reply is never closed because "no owner saw its card".
- A tap on a reply answers `has_gaps` and `feature_off` with the texts of stage 05 (`taps.hasGaps`, `taps.featureOff`); the review card of this stage shows no Send button for a gap (D15), so those answers cover a stale card only.

## Carry-over from stage 05

- The Telegram `expired` tap text says "(48 h)" for a reply that lives 7 days: fix it.
- A reply that fails with `has_gaps` is reported as the `bad_payload` cause until stage 09 adds its own text; stage 09 adds texts for the new reasons and the result detector must stop skipping `closeSend` with `notify: true`.
- The new Polish and English tap and notice texts are agent drafts: judge wording.

## Carry-over from the stage 07 review

- Stage 07 added a SKIP of `reply` sends in `listSendsToNotify` (review-7.md N1): replace it by the proper reply notice and the consent check (D16, D15), and add the test that the generic detector never queues a reply (TG2).

## Carry-over from stage 09

- The approval view of a reply has `sentVisible: false` while the Sent mail is not read (org flag `sent_sync` or the switch of the mailbox off; set by `approvalViewFor`). The card must say "I cannot see your sent mail" then: only `\Answered` on the original shows an answer.
- The result texts of `answered`, `sent_by_user`, `newer_mail`, `original_moved`, `suspicious`, `draft_changed`, `draft_missing` and the `has_gaps` cause exist (en, pl). The Telegram tap text `expired` still says 48 h for a reply that lives 7 days: that is yours.
- Notes: `notes/2026-11-18-f115-s09-answered-sweep.md`.

## Carry-over from the stage 09 re-review (2026-11-18)
First commit of this stage: the gaps G1, G2 and the fix N-a, and the doc limits N-b, N-c, N-d from `review-9.md` section "Re-review of the repair". Each gets a test and a saved mutation log.

## Carry-over from the stage 12 review (2026-11-18)

- N14: Step 3 (the consent text, the version bump, `REPLY_CONSENT_SINCE` = the new version, and the test "an old link version gives 409 `telegram_consent_outdated`, the new one links") moved to stage 17. Stage 12 built the gate (`replyConsentOf`) with `REPLY_CONSENT_SINCE` as a placeholder above the current version, so nobody is covered until stage 17. Notes: `notes/2026-11-18-f115-s12-telegram-review.md`.
