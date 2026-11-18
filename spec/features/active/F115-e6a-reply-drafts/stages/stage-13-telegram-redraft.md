# F115 stage 13 — Redraft, Reply all, Draft reply

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people, user text into the LLM). Needs 12.

## Step 1 — Service functions (module `replies`)

- **Goal:** `requestReply`, `redraftReply`, `setReplyRecipients` as `interfaces.md` names them.
- **Decisions:**
  - Owners only; flag off → `feature_off`; switch off or shadow → `blocked` / `policy_changed`.
  - `requestReply` runs `replyEligibility` with trigger `tap` before it inserts a request (a block answers at once), and again in the job. An open reply send for the same mail → `{ kind: "open", sendId }`, no new request; the caller shows that card.
  - `redraftReply`: the send must be open (`awaiting_approval`); instruction through `cleanUserText` one line, 1–300 characters; at most 5 `redraft` requests per mail (PD-081) → `redraft_limit`. The request has `previous_send_id`; the job makes the new version (stage 07 path). The old send stays open until the new version exists.
  - `setReplyRecipients`: no LLM call. `all` = stored To and Cc minus own mailboxes and minus `to` (D14), at most 10 → else `too_many_recipients`; `reply_to` = the stored Reply-To (none or equal to `From` → `no_reply_to`); `from` = back to the default. A new version through `replaceApproval`; the same recipients as now → `unchanged`.
- **Test (integration):**
  1. `requestReply` on a flagged mail → `blocked` / `suspicious`, no request; on an untriaged mail → `blocked` / `not_checked`.
  2. On a clean `info` mail → `queued`; the job drafts it.
  3. Sixth redraft of one mail → `redraft_limit`.
  4. Redraft with `"say yes for Tuesday"` → the fake LLM's prompt holds the instruction in the user block; version 2 exists; version 1 `superseded`.
  5. `setReplyRecipients(all)` for a mail To `me@box, b@y`, Cc `c@z` → version 2 with `cc: ["b@y","c@z"]` (`me@box` is own).
  6. 11 other recipients → `too_many_recipients`.

## Step 2 — Buttons and the reply text

- **Goal:** review cards gain ✍️ Redraft, 👥 Reply all, "Use Reply-To" (stage 12 rules on when they show). Redraft → the bot sends a `reply_prompt` message with ForceReply ("Write one line: what should the reply say?"), `reply_markup.force_reply` in the Telegram adapter. A text message in a linked chat that replies (`reply_to_message`) to a sent `reply_prompt` row or to a sent reply review card of that chat → `redraftReply` with the text. Any other free text keeps today's help answer.
- **Decisions:** the match uses the stored Telegram message id of the outbox row and the chat id; a reply to another chat's card is ignored. The instruction text never reaches a log line or an audit row. When a `tap` or `redraft` request ends, the drafter queues a `reply_result` row for the requesting user: the new card (kind `approval`) for `done`; the open card of the thread for `superseded`; a reason text for `no_draft`, `failed`, `cancelled` (one text per reason, also `closed`: "This draft was closed; nothing changed.").
- **Test (integration, fake Telegram):**
  1. Tap Redraft → one `reply_prompt` with ForceReply; a reply text → one `redraft` request; the job runs → the user gets the version 2 card.
  2. A reply text to an unrelated bot message → the help answer, no request.
  3. A member's reply text → the owner-only answer.
  4. Reply all tap → version 2 card with the `Cc:` line.

## Step 3 — Draft reply on tap

- **Goal:** "✍️ Draft reply" (`reply_draft` with the email id) on urgent notices and on digest rows of `needs_reply` and `urgent` mail that has no open reply send. Tap → `requestReply`; the answer is "Drafting…" and the card follows (`reply_result`). A block answers with its reason text (pl, en; one text per `ReplyBlockReason`).
- **Test:**
  1. Unit: the urgent notice view with `draftButton: true` renders the button; pl and en reason texts with fixed values.
  2. Integration: tap on an urgent mail → request `tap`; the job drafts; the user gets the card.
  3. Tap on a mail whose draft is open → that card, no new request.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** routes and panel (14, 15).

## Carry-over from stage 07

- A `redraft` request ends `done` (new version; `send_action_id` is the new send), `cancelled` / `closed` (the send does not wait any more, or the request has no `previous_send_id`), `cancelled` / `changed` (another version replaced the send while the model worked), or `failed` (`timeout`, `llm_cap`, `llm_error`, `checks`, `output`, `internal`). The full list of reason codes is in `notes/2026-11-18-f115-s07-drafter-job.md`.
- The job calls `replaceApproval` with `via: "web"` and the requester as `userId`: every card is edited, including the card of the Telegram user who asked. The request has no channel column. When the result notice needs the channel, keep it in the callback or the notice view, not in the request (the ticket allows one migration, and it is applied).
- A redraft whose send is not `awaiting_approval` ends before the model call; the user is told by `reply_result`, not by a second draft.
