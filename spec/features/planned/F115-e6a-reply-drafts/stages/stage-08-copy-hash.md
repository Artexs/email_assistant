# F115 stage 08 — Copy hash for every kind

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people, data delete). Needs 04.

PD-076 for every draft kind: the system never sends text it read back and never deletes a draft the user changed. Changes `actions/drafts.ts`, `actions/send.ts` and the reverse path. Merge `master` first: F103 stage 09 may have converted the log lines of these files.

## Step 1 — Baseline at APPEND

- **Goal:** after `applyDraft` APPENDs the draft (or finds it by `locateByActionId`), it fetches the copy once (`fetchContent(folder, uid)`; without UIDPLUS, locate first for the uid) and stores `provider_result.copy_hash` = `draftTextHash(text)` (D9, `interfaces.md`). The text is never stored or logged.
- **Decisions:** a fetch error after a good APPEND keeps the draft `applied` without `copy_hash` and logs one event `draft_copy_unhashed` (`action_id`, `error_code`); the send then treats the draft as "no baseline" (step 2). Rejected: fail the draft (the copy exists; a retry would APPEND twice).
- **Test (integration, GreenMail):**
  1. A delegation draft → `applied` with a 64-hex `copy_hash`.
  2. A crash after APPEND (the row stays `applying`) → the next claim locates, hashes, `applied`; one copy in Drafts.

## Step 2 — Check before SMTP

- **Goal:** `applySend` locates the copy and compares, before `startSendWithinLimits`:
  - same hash → continue (today's path);
  - other hash → send `expired` / `draft_changed` (via `closeReplySend` for a reply, the same transition for other kinds), `notify: true`, no SMTP, the copy stays, the delegation (if any) `cancelled` / `draft_changed` through its hook;
  - copy missing → `expired` / `draft_missing`, `notify: true`, no SMTP (stage 09 adds `sent_by_user` for replies);
  - draft has no `copy_hash` → today's path (a draft from before this stage, or step 1's unhashed case).
- **Decisions:** a soft IMAP error during the check → back to `approved`, 5 min, no count (as a draft not ready); it counts against the 6 h soft cap. The check runs only for the first try: an `applying` send in recovery never checks (it searches Sent, as today). One event line `reply_send_checked` per check (`action_id`, `result` = `same` / `changed` / `missing` / `no_baseline`).
- **Test (integration, GreenMail):**
  1. Approved delegation, copy untouched → sent, one SMTP call.
  2. The test replaces the copy with an edited body (same `X-EA-Action-Id`) → `draft_changed`, zero SMTP calls, the copy is still in Drafts.
  3. The test deletes the copy → `draft_missing`, zero SMTP calls.
  4. A draft row without `copy_hash` → sent as today.
  5. The IMAP fetch times out once → the send waits, then sends on the next run.

## Step 3 — Remove only unchanged copies

- **Goal:** `removeDraft` (the reverse row after send, reject, expiry or supersede) hashes the located copy first: match or no baseline → delete as today; other hash → keep the copy, the reverse row `applied` with `provider_result.kept = "changed"`, event `draft_copy_kept`.
- **Test:**
  1. Reject an untouched draft (UIDPLUS) → copy deleted.
  2. Reject after the test edited the copy → copy kept, reverse row `applied` / `kept: changed`.
  3. An F102 edit (supersede) of a changed copy → the old copy kept, the new version APPENDed.

## Step 4 — Texts

- **Goal:** the approval card line "Do not send the draft from your mail client." becomes "Edit here, or edit and send in your mail client." (en, pl); result notice texts for `draft_changed` ("You edited this draft in your mail client. Send it from there.") and the existing `draft_missing`. The approval card text holds no mail-derived data that is new, so no consent bump here.
- **Test:** unit tests of both texts in pl and en with fixed values.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the answered check (09).
