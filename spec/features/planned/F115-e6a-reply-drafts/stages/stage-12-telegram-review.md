# F115 stage 12 — "Replies ready" and the review

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people, privacy, Polish text). Needs 09.

No card per draft (PD-074): a batched notice, then one review card at a time. The consent version goes up here (D16).

## Step 1 — The notice `replies_ready`

- **Goal:** a detector (`channels/notices/replies-ready.ts`) queues `replies_ready` for each linked owner when at least one reply send became `awaiting_approval` with its draft `applied` after that owner's last `replies_ready` row, and the last row is at least 2 h old. View: `{ count, now, timeZone }` (the open reply sends of the org for that user, oldest first). Buttons: "Review" (`reply_review`) and the panel link line when `WEB_BASE_URL` is set and `approvals_page` is on.
- **Decisions:** quiet hours hold it as every non-digest kind (the sender's rule); the 2 h gap counts from the queue time. Dedup key `replies_ready:<userId>:<first new send id>`. Flag `reply_drafts` off → no detector run. The morning digest gets one line "📝 N replies ready" (a digest view field, counted at build time) and no buttons. Set `notified_at` of the sends that a queued notice counts (the expiry rules of stage 05 ignore it; it marks "told").
- **Test (integration, fixed clock):**
  1. Two new reply drafts → one notice row per linked owner, `count` 2; a member gets none.
  2. A third draft 1 h later → no row; at 2 h 1 min → one row, `count` 3.
  3. A draft at 23:00 org time → the row waits until 07:00.
  4. A render test of the pl and en text with `count` 1, 3 and 5 (Polish plural forms).

## Step 2 — Review cards

- **Goal:** `reply_review` (with optional `afterId`) answers the tap with the next open reply send of the org after `afterId` (order `created_at`, id), queued as outbox kind `approval` with the dedup key of today's approval cards, so F102 card sync, `ap:` and `ar:` work. The approval detector skips kind `reply` (D15). After Send, Reject or Skip on a card, the next card follows at once (the tap handler queues it); no next send → the text "No more replies waiting."
- **Card content** (`renderApprovalRequest` for kind `reply`): title, `To:` and `Cc:` addresses, `Reply-To:` when the stored one differs from `From`, gaps first ("Fill these: …"), the full body, the quote (shrinks first, as today), the line "Edit here, or edit and send in your mail client.", and when `sentVisible` is false "I cannot see your sent mail; check you did not answer already." Buttons: 📤 Send (not when gaps), ✖️ Reject, ✍️ Redraft, ⏭ Skip, 👥 Reply all (only when the mail had other To or Cc), "Use Reply-To" (only when it differs). This stage renders Send, Reject and Skip only; stage 13 adds the other three buttons with their handlers.
- **Decisions:** owners only for every reply tap (`reply_review` too). A card for a send that closed meanwhile → skipped to the next.
- **Test:**
  1. Unit: the pl and en card of a reply with one gap → no Send button, the gap line first; without gaps → Send.
  2. Integration: Review → card of the oldest send; Skip → card of the second; Skip on the last → "No more replies waiting."
  3. Integration: Send on a card → `approved`, then the next card is queued.
  4. A member taps Review → the owner-only answer.
  5. The approval detector queues no card for a new reply send.

## Step 3 — Consent bump

- **Goal:** `TELEGRAM_CONSENT_VERSION` = the land date of this stage, and the consent text (en, pl) adds: "reply drafts that the AI writes for you, and the addresses of the other recipients of a mail (To, Cc, Reply-To) when a reply goes to them". One commit with both texts and the version.
- **Test:** `web-telegram.test.ts`: a link request with the old version → 409 `telegram_consent_outdated`; with the new one → linked.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** Redraft, Reply all, Draft reply (13).
