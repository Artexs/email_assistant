# F115 stage 16 — Sample drafts and outcome counts

Part of [`../plan.md`](../plan.md). Needs 11 (and 15 for the e2e helpers).

Shadow mode makes no drafts; the owner can still see three samples on recent real mail (PD-071). The weekly report gets the draft outcome line (E3a cross-epic edit).

## Step 1 — Sample drafts

- **Goal:** `sampleReplies(deps, ctx, { mailboxId, userId, count: 3 })` and `POST /api/mailboxes/:id/reply-samples` (owner; flag `reply_drafts` on; any mode) → 202 with three request ids, then the panel polls them; each `done` request shows `sample_body`. Requests have trigger `sample`; the job stores the body in `reply_requests.sample_body`, writes no actions, no Drafts copy and no notice.
- **Decisions:** the three mails = the newest mails of the last 7 days that pass `replyEligibility` with trigger `sample` and category `needs_reply` (fewer → fewer samples, and the answer says how many). At most one sample run per mailbox per day (409 `sample_limit`). A mailbox with `oauth_provider` set → 409 `blocked` + `reason: "oauth_mailbox"` (D19). Samples count in the cap like a tap. In the job (stage 07), a `sample` request skips the mode and switch re-check and the thread rule, and its write step stores only `sample_body` and `done`. The style card (stage 11) gets "Show 3 sample drafts" with "Samples are not saved in Drafts and cannot be sent." F110 (E4-B) links this function from its report later.
- **Test (integration):**
  1. Shadow mailbox with 4 eligible mails → 3 `sample` requests; after the job: 3 `sample_body` values, zero `actions` rows, zero APPENDs.
  2. A second run the same day → 409 `sample_limit`.
  3. 1 eligible mail → one sample, answer `count: 1`. An OAuth mailbox → 409 `blocked`, no request.
  4. Retention clears `sample_body` with the payloads (stage 03 rule).
  5. e2e: the button shows three sample texts.

## Step 2 — Outcome counts

- **Goal:** the metric pattern of `docs/code-patterns.md` § Metrics (review G13): a pure function in `packages/core/src/metrics/` over plain rows, a `weekStatsSchema` field `replyDrafts`, and the reader `replyOutcomeRows` in module `replies`, joined in `reports/metrics.ts`. The counts (`ReplyOutcome` of `interfaces.md`) come from the reply sends, their reasons and the requests: `made` (pairs created), `sent_by_tap` (applied), `sent_by_user`, `rejected`, `expired` (`timeout`), `newer_mail`, `answered`, `original_moved`, `draft_changed`, `no_draft`, `failed`. A superseded version (edit or redraft) counts once, as its newest version.
- **Also:** the E3a weekly report (module `reports`) gets one line "Reply drafts: N made · N sent by tap · N sent by you · N rejected · N expired · N closed" (closed = newer mail + answered + moved + changed), shown only when `made > 0`. Reject reasons of reply sends feed M3 already (PD-057); drafter calls count in M7 through the `llm.call` rows.
- **Test:**
  1. Fixture: 5 pairs (1 applied, 1 rejected, 1 `newer_mail`, 1 redrafted to version 2 then applied, 1 `timeout`) → `made` 5, `sent_by_tap` 2, `rejected` 1, `newer_mail` 1, `expired` 1.
  2. Unit: the weekly line in pl and en with fixed counts; hidden when `made` is 0.
  3. Org isolation of the counts.
- **Check:** the touched tests, then the Proof (the web Proof of stage 15, folder `/tmp/f115-s16`).
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the E4-B report page (F110).
