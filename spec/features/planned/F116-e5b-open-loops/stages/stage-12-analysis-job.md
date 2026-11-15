# F116 stage 12 — Sent analysis job

Part of [`../plan.md`](../plan.md). `[risky]` (LLM spend, untrusted text, exactly-once). Needs stages 06 (a passing gate file for `extractor-v1`) and 08.

## Step 1 — Candidates and the thread rule

- **Goal:** `analyzeSent(deps, ctx, mailboxId, { now, limit })` picks the work of one mailbox and applies the rules that need no LLM.
- **Decisions:**
  - Runs only when the org flags `open_loops` and `sent_sync` are on and the mailbox switch is on (D6). Candidates: `sent_emails` rows of the mailbox with `origin = user`, no analysis row or a `pending` row with `next_attempt_at <= now`, oldest `internal_date` first, at most `limit` (20) per run.
  - Thread rule first (D9): the row's `thread_key` matches an open loop of the mailbox (`openLoopsByThread`) and the row is newer than the loop's `wait_from_at`: an open `waiting` or `delegated` loop restarts from this row (`restartLoop`, new default due, `loop.restarted`); an open `promised` loop whose counterpart is in the row's To or Cc closes `later_reply`. Then the analysis row is `skipped` / `thread_restart` and no call runs.
  - Then `sentSkipReason` (stage 05): a reason → `skipped` with that reason.
  - Own addresses = the addresses of the org's mailboxes, lower case.
- **Test (integration):** T1 flag `open_loops` off → no row written; T2 a row with `list_id` → `skipped` / `list`, no LLM call (fake counts 0); T3 a user row in the thread of an open waiting loop sent 2026-11-18 10:00 → the loop restarts, `due_at` = Mon 2026-11-23 17:00 Warsaw (3 working days), no call; T4 a row to the counterpart in the thread of an open promised loop → `later_reply`.

## Step 2 — The call and the write

- **Goal:** one `extractSent` call per remaining candidate, then one transaction that writes the result.
- **Decisions:**
  - Cap (D14): when the mailbox's `llm.call` rows of the local day reach 80% of `LLM_DAILY_CAP`, the candidate stays `pending` with `skip_reason = llm_cap` and `next_attempt_at` = the next local day 00:05; no call.
  - The call runs outside a transaction. The write transaction inserts or updates the analysis row to `done` (with `expects_reply`, `has_promise`, `prompt_version`) and inserts the loops of D8 with `insertLoop` (an `exists` answer is fine). The `text` of a loop is `ask` or `promise`; `ask` null → `text` null (the brief shows the subject). To, Cc, subject, `message_id`, `references_ids`, `thread_key` come from the sent row, never from the LLM (D5).
  - Delegated (D8): the first To address that equals an active delegate's address (lower case) → `kind = delegated`, `delegate_id`, `counterpart` = that address.
  - Due: `resolveDue` of `due` (else `defaultDue(sent_at, loop_wait_days)`), `due_source` `stated` or `default`; `promised` needs a resolved `promise_due`.
  - Failure: `attempts + 1`, `next_attempt_at = now + 5 min × attempts`; at 3 → `failed`. A schema failure counts as a failure.
  - Log lines (F103): `sent_analysis_done` (`mailbox_id`, `count`, `opened`), `sent_analysis_failed` (`mailbox_id`, `error_code`). No text, no address.
- **Test (integration, fake LLM):** T5 answer `expects_reply` true, `due` null, sent Fri 2026-11-20 10:00 → one waiting loop, `due_at` Wed 2026-11-25 17:00, `due_source` `default`; T6 answer with `promise` "send the offer" and `promise_due` `friday`, sent Wed 2026-11-18 → a promised loop due Fri 2026-11-20 17:00 next to the waiting loop; T7 To = an active delegate → one `delegated` loop and no `waiting` loop; T8 the same row analysed twice (crash after the call, before the commit: run the write twice) → one analysis row, one loop; T9 at 80 of a cap of 100 → `llm_cap`, no call; T10 three provider errors → `failed`, `attempts` 3.

## Step 3 — The job

- **Goal:** `loops.analyze` in `createLoopJobs` (every 60 s), registered in `main.ts` and `job:run`; one mailbox after another, errors of one mailbox do not stop the next.
- **Test:** T11 `job:run --name loops.analyze` runs once on a fixture org and prints counts only.

## Check

`bun test apps/server/test/integration/<the new loops tests>`

## Done when

T1–T11 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s12`).

## Out of scope

Closing by replies (13), the chaser (15).
