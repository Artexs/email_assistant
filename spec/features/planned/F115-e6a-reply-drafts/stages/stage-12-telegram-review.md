# F115 stage 12 — "Replies ready" and the review

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people, privacy, Polish text). Needs 09.

## Step 1 — The notice `replies_ready`

- **Goal:** a detector queues `replies_ready` for each linked owner when a reply send became `awaiting_approval` with its draft `applied` after that owner's last `replies_ready` row, and that row is at least 2 h old. View: `{ count, now, timeZone }` (open reply sends of the org). Button "Review" (`reply_review`); the panel link line when `WEB_BASE_URL` is set and `approvals_page` is on.
- **Decisions:** the count leaves out sends whose mail is answered or flagged by the DB facts (notes §3.7). Quiet hours hold it as every non-digest kind; the 2 h gap counts from the queue time. Dedup key `replies_ready:<userId>:<first new send id>`. Flag `reply_drafts` off → no detector run. The morning digest gets one line "📝 N replies ready" (a digest view field, counted at build time) and no buttons. Set `notified_at` of the counted sends (it marks "told"; stage 05 expiry ignores it).
- **Test (integration, fixed clock):**
  1. Two new drafts → one row per linked owner, `count` 2; a member gets none.
  2. A third draft 1 h later → no row; at 2 h 1 min → `count` 3. An answered mail's draft is not counted.
  3. A draft at 23:00 org time → the row waits until 07:00.
  4. Render pl and en with `count` 1, 3 and 5 (Polish plurals).

## Step 2 — Review cards

- **Goal:** `reply_review` (optional `afterId`) answers with the next open reply send after `afterId` (order `created_at`, id), as outbox kind `approval` (`ap:`, `ar:` work). Dedup key `approval:<sendId>:r<n>` (n = 1 + earlier review cards of that send for that user): a skipped card must show again (review G6). F102's `listCardsOfSend` must find these keys (test). The approval detector skips kind `reply` (D15). After Send, Reject or Skip, the tap handler queues the next card; none left → "No more replies waiting."
- **Card** (`renderApprovalRequest`, kind `reply`): title, `To:`, `Cc:`, `Reply-To:` when it differs from `From`, gaps first ("Fill these: …"), the full body, the quote (shrinks first), the stage 08 line, and when `sentVisible` is false "I cannot see your sent mail; check you did not answer already." Buttons here: 📤 Send (not with gaps), ✖️ Reject, ⏭ Skip. Stage 13 adds ✍️ Redraft, 👥 Reply all (only with other To or Cc) and "Use Reply-To" (only when it differs).
- **Decisions:** owners only for every reply tap. A send that closed meanwhile is skipped.
- **Test:**
  1. Unit: the pl and en card of a reply with one gap → no Send button, the gap line first; without gaps → Send.
  2. Integration: Review → card of the oldest send; Skip → card of the second; Skip on the last → "No more replies waiting."
  3. Integration: Send on a card → `approved`, then the next card is queued.
  4. A member taps Review → the owner-only answer.
  5. The approval detector queues no card for a new reply send.

## Step 3 — Consent bump

- **Goal:** `TELEGRAM_CONSENT_VERSION` = the land date, or `<date>-2` if it already holds that date (plan F10); the consent text (en, pl) adds: "reply drafts that the AI writes for you, and the addresses of the other recipients of a mail (To, Cc, Reply-To) when a reply goes to them". One commit with both texts and the version.
- **Linked chats (D16, review G12):** a user's consent version = their newest `web.telegram_consent` audit row. Older: no review card; `replies_ready` shows only the count, the panel link and "Confirm the new Telegram terms in the panel to review here." This stage adds `POST /api/telegram/consent` (`interfaces.md`); the panel button is stage 15.
- **Test:** the new version ≠ `2026-11-15`; a link request with the old version → 409 `telegram_consent_outdated`; with the new one → linked. A user linked with the old version taps Review → the panel-link answer, no card; after the consent route → cards.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** Redraft, Reply all, Draft reply (13).
