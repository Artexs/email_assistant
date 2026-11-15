# F115 stage 07 — Drafter job

Part of [`../plan.md`](../plan.md). `[risky]` (exactly-once, LLM spend). Needs 01, 05, 06.

The job `replies.drafter` turns each request into one `reply` draft pair, under the cap and the thread rule. The committer APPENDs it as any draft.

## Step 1 — Scan and claim

- **Goal:** `createReplyJobs(deps)` registers `replies.drafter` (every 15 s) in the composition root. Each run: (a) the scan inserts `auto` requests (`ON CONFLICT DO NOTHING`) for mail of active mailboxes in `assist` with the switch and the flag on, status `triaged`, latest triage category `needs_reply`, `received_at` within 7 days, no `auto` request; at most 50 per mailbox per run; (b) claims up to 5 requests per mailbox, oldest first.
- **Decisions:** D3, D12. `TRIAGE_LLM_SCOPE` applies the same way (off → the job does nothing; `synthetic` → test mail only). A paused or suspended org: nothing.

## Step 2 — Draft one request

- **Goal:** per claimed request, in this order:
  1. Facts and `replyEligibility` → a block ends the request `cancelled` with the reason (no LLM call).
  2. Cap (D5): `auto` at ≥ 80% → release to the next quota day, no count; any trigger at 100% → `failed` / `llm_cap`.
  3. `draftReply` with the mailbox profile, the instruction and the language. Write one `llm.call` row per usage (role `drafter`, mailbox, endpoint, outcome) in its own commit before step 4.
  4. One transaction: the settings share lock (M13), then the advisory thread lock (D7); re-read the request (still `drafting`, same `locked_at`, else stop); re-check the switch and mode; close older open replies of the thread as `newer_mail` (`closeReplySend`, `notify: false`); if an open reply exists for a mail newer than this one → request `superseded`; else insert the pair (keys `<request id>:create_draft`, `<request id>:send`; `ready` / `awaiting_approval`; payload `reply` with `to` = `From`, `cc` empty, `recipients: "from"`, `request_id`), set `send_action_id`, request `done`. For a `redraft` request the pair is a new version of `previous_send_id` through `replaceApproval` (stage 13 calls this path; build it here).
  5. `no_draft` → request `no_draft` with the reason. `failed` → `failed` / `checks` or `output`.
- **Errors:** soft LLM error (timeout, network, 429, 5xx) → release in 5 min, no count; config error → the same plus one `error` event line; hard error → `attempts + 1`, 5 min, at 3 → `failed` / `llm_error`. A DB error after the call → release with a count.
- **Logs (D17):** `reply_drafted` (`request_id`, `email_id`, `mailbox_id`, `action_id`, `count` = attempts), `reply_draft_failed` (`request_id`, `error_code`), `reply_superseded` (`request_id`, `action_id`, `reason`). Add the field names to the allow list where needed.

## Test (integration, fake LLM, fixed clock)

1. A clean `needs_reply` pl mail, `assist`, switch and flag on → one request `done`, one `create_draft` `ready` and one `send` `awaiting_approval` of kind `reply`, one `llm.call` row with role `drafter`.
2. The same mail, the job runs twice → still one pair.
3. Kill point: the LLM answers, then the write transaction throws once → next run: one pair, two `llm.call` rows.
4. Shadow mode, or the switch off, or the flag off → no request.
5. 240 `llm.call` rows today with `LLM_DAILY_CAP=300` → the `auto` request waits until the next quota day; a `tap` request drafts.
6. 300 rows → a `tap` request ends `failed` / `llm_cap`.
7. Two mails A (10:00) and B (10:05) in one thread: A drafted first; B's request → A's send `expired` / `newer_mail`, B drafted. If B is drafted first, A's request → `superseded`.
8. Two job instances run at once on two mails of one thread → exactly one open reply send at the end.
9. Fake LLM gives a link twice → request `failed` / `checks`, no pair.
10. The switch turns off between the LLM call and the write → no pair, request `cancelled` / `policy_changed`.
11. Org B's mail is never in org A's scan (two orgs, one needs_reply mail each).
12. Log canary: a mail with a canary subject and body → no log line holds them.

- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the copy hash (08), the pre-send pass and the sweep (09), notices (12).
