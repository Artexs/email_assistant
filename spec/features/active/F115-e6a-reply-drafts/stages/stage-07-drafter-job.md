# F115 stage 07 — Drafter job

Part of [`../plan.md`](../plan.md). `[risky]` (exactly-once, LLM spend). Needs 01, 05, 06.

## Step 1 — Scan and claim

- **Goal:** `createReplyJobs(deps)` registers `replies.drafter` (every 15 s) in the composition root. Each run: (a) the scan inserts `auto` requests (`ON CONFLICT DO NOTHING`) for mail of active password mailboxes (D19) in `assist` with the switch and the flag on, status `triaged`, latest category `needs_reply`, `received_at` within 7 days; at most 50 per mailbox per run; (b) claims up to 5 requests per mailbox, oldest first.
- **Decisions:** D3, D12. `TRIAGE_LLM_SCOPE` applies as in triage. A paused or suspended org: nothing. Add `replies.drafter` to `jobNames` and the usage text (`scripts/job-run-args.ts`), test in `job-run-args.test.ts`.

## Step 2 — Draft one request

1. Facts and `replyEligibility` → a block ends the request `cancelled` with the reason (no LLM call).
2. Cap (D5): `auto` at ≥ 80% → release to the next quota day, no count; any trigger at 100% → `failed` / `llm_cap`.
3. `draftReply`; one `llm.call` row per usage (role `drafter`, endpoint), in its own commit.
4. One transaction: settings share lock (M13), advisory thread lock (D7); the request is still `drafting` with the same `locked_at`, else stop. Re-check the flag, the switch, the mode and the DB facts of `answered` and `suspicious` (notes §3.7): a change → `cancelled` with the reason. Close older open replies of the thread as `newer_mail` (`closeSend`, `notify: false`, `claimed: false`; `busy` → leave it, the sweep or the committer ends it). An open reply for a newer mail → `superseded`. Else insert the pair (keys `<request id>:create_draft` / `:send`, `ready` / `awaiting_approval`, payload `reply` with `to` = `From`, `cc` empty, `recipients: "from"`, `request_id`, `folder`), set `send_action_id`, request `done`.
   - A `redraft` request makes a new version of `previous_send_id` through `replaceApproval`; that send not open any more → `cancelled` / `closed` (stage 13 tells the user).
5. `no_draft` → `no_draft` with the reason; a failed draft → `failed` / `checks` or `output`.

- **Errors:** soft LLM error (timeout, network, 429, 5xx) → release in 5 min, no count; config error → the same plus an `error` event; hard error → `attempts + 1`, 5 min, at 3 → `failed` / `llm_error`. A DB error after the call → release with a count. A `tap` or `redraft` request still not done 10 min after `created_at` → `failed` / `timeout` (the user waits for it).
- **Logs (D17):** `reply_drafted` (`reply_request_id`, `action_id`, `count` = attempts), `reply_draft_failed` (`reply_request_id`, `error_code`), `reply_superseded` (`reply_request_id`, `reason`). New uuid field `reply_request_id` (plan F8).

## Test (integration, fake LLM, fixed clock)

1. A clean `needs_reply` pl mail, `assist`, switch and flag on → one request `done`, one `create_draft` `ready`, one `send` `awaiting_approval` of kind `reply`, one `llm.call` row with role `drafter`.
2. Then the committer runs (GreenMail): Drafts holds one copy with `In-Reply-To` = the original Message-ID, the `Re:` subject and `X-EA-Action-Id`.
3. The job runs twice → still one pair.
4. Kill point: the LLM answers, then the write throws once → next run: one pair, two `llm.call` rows.
5. Shadow, switch off or flag off → no request.
6. 240 `llm.call` rows today, `LLM_DAILY_CAP=300` → the `auto` request waits until the next quota day; a `tap` request drafts. 300 rows → a `tap` request ends `failed` / `llm_cap`.
7. Mails A (10:00) and B (10:05) in one thread: A drafted, then B → A `expired` / `newer_mail`, B drafted. B first → A's request `superseded`.
8. Two job instances at once on two mails of one thread → exactly one open reply send.
9. The fake LLM gives a link twice → `failed` / `checks`, no pair.
10. The switch turns off, or `email_flags.answered` turns true, between the LLM call and the write → no pair, `cancelled` with that reason.
11. A redraft whose old send was rejected meanwhile → `cancelled` / `closed`, no pair.
12. A `tap` request with soft errors for 11 min → `failed` / `timeout`.
13. Org isolation of the scan; a log canary (no subject or body in a line).

- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the copy hash (08), the pre-send pass and the sweep (09), notices (12).

## Carry-over from stage 04 and 05

- **Payload folder is never a command target.** The `folder` of a reply payload is the folder of the mail at request time. It is data to compare with `emails.folder` (the `original_moved` rule), never a folder to move to, delete from or APPEND into. Stage 07 proves it with a test: a reply whose payload `folder` is a hostile text (`"INBOX; DELETE"`, a path of another mailbox) makes no IMAP command and no move; the draft goes to `Drafts` only.
- Stage 05 gave `closeSend` (see `interfaces.md`); the thread close of step 4 calls it with the `deps` of `approvals` (`hooks`, `approvalHooks`, `uidplus`).
