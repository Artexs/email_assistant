# F115 stage 08 — Copy hash for every kind

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people, data delete). Needs 05. Probe P1 follows (coordinator).

PD-076 for the draft, send and reverse paths of `actions`. Merge `master` first (F116 changes the committer).

## Step 1 — Baseline at APPEND

- **Goal:** after `applyDraft` APPENDs the draft (or finds it by `locateByActionId`), it reads the copy once (`fetchMetaIn` for Subject, To, Cc; `fetchContent` for the text and the attachment capture; without UIDPLUS, locate first for the uid) and stores `provider_result.copy_hash` = `draftCopyHash(copy)` (D9, `interfaces.md`). Text never stored.
- **Decisions:** a read error after a good APPEND keeps the draft `applied` without `copy_hash`, event `draft_copy_unhashed` (`action_id`, `error_code`); the send has "no baseline". Rejected: fail the draft (a retry would APPEND twice). A reply draft without a baseline does not send: `draft_missing`, the copy stays (replies always check).
- **Test (integration, GreenMail):**
  1. A delegation draft → `applied` with a 64-hex `copy_hash`.
  2. A crash after APPEND → the next claim locates, hashes, `applied`; one copy in Drafts.

## Step 2 — Check before SMTP

- **Goal:** for a reply, and for other kinds (`follow_up` too) while the org flag `draft_copy_check` is on (new in `featureFlags`, epic `E6a`, default off), `applySend` locates the copy and compares before `startSendWithinLimits`:
  - same hash → continue;
  - other hash, or text null → `closeSend(draft_changed, notify: true, claimed: true)`, no SMTP, the copy stays; a delegation becomes `cancelled` / `draft_changed` through its hook;
  - copy missing → `closeSend(draft_missing, …)`, no SMTP (stage 09 adds `sent_by_user` for replies);
  - no `copy_hash` → today's path (not for a reply, see step 1).
- **Decisions:** a soft IMAP error in the check → back to `approved`, 5 min, no count; it counts against the 6 h soft cap. Only the first try checks: an `applying` send in recovery searches Sent, as today. One event `reply_send_checked` per check (`action_id`, new code field `result` = `same` / `changed` / `missing` / `no_baseline`).
- **Test (integration, GreenMail; flag on unless named):**
  1. Copy untouched → sent, one SMTP call.
  2. The test replaces the copy with an edited body (same `X-EA-Action-Id`) → `draft_changed`, zero SMTP calls, the copy still in Drafts.
  3. Same body, one attachment added → `draft_changed`. Same body, To changed → `draft_changed`.
  4. The copy deleted → `draft_missing`, zero SMTP calls.
  5. A delegation draft without `copy_hash` → sent as today. A reply without it → `draft_missing`.
  6. Flag off: a delegation with an edited copy → sent as today; a reply with an edited copy → `draft_changed`.
  7. The IMAP read times out once → the send waits, then sends on the next run.
  8. A `follow_up` with an edited copy → `draft_changed`, zero SMTP calls, the loop row unchanged, no outbox CHECK error. A loop send has no mail: no answered check (stage 09) for it.

## Step 3 — Delete only unchanged copies

- **Goal:** `removeDraft` (the reverse row after send, reject, expiry or a new version) hashes the located copy first: match or no baseline → delete as today; other → keep the copy, the reverse row `applied` with `provider_result.kept = "changed"`, event `draft_copy_kept`. This rule ignores the flag (deleting less is always safe).
- **Test:**
  1. Reject an untouched draft (UIDPLUS) → copy deleted.
  2. Reject after the test edited the copy → copy kept, reverse row `applied` / `kept: changed`.
  3. An F102 edit of a changed copy → the old copy kept, the new version APPENDed.

## Step 4 — Texts and the probe CLI

- **Goal:** the approval card line "Do not send the draft from your mail client." becomes "Edit here, or edit and send in your mail client." (en, pl); the result text for `draft_changed`: "You edited this draft in your mail client. Send it from there." CLI `bun run reply:check-copy --action-id <draft id>`: hashes the copy, prints `same`, `changed`, `missing` or `no_baseline`; never writes (probe P1).
- **Test:** unit tests of both texts in pl and en; an integration test of the CLI service function on GreenMail (`same`, then `changed` after an edit).
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the answered check (09).

## Changes after the review (Opus, PASS a84e9b26)

- The card line "Edit here, or edit and send in your mail client." shows only for a `reply` and while the org flag `draft_copy_check` is on (view field `copyCheck`); other cards keep the old line (coordinator decision N1).
- An IMAP error in the copy check ends the send `failed` / `copy_check_error` (not `expired`, not `smtp_error`), with `provider_result.stage = copy_check`: after 6 hours of soft errors, or at the third hard error. The result notice has its own text (en, pl) and offers "Send again". A login error returns the send to `approved` with no count.
- `bun run reply:check-copy` changes no row and writes nothing to the mailbox; opening an OAuth mailbox can store a rotated refresh token.
