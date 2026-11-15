# F116 stage 12 — Sent analysis job

Part of [`../plan.md`](../plan.md). `[risky]` (LLM spend, untrusted text, exactly-once). Needs stages 06 (a passing gate file for `extractor-v1`) and 08.

## Step 1 — Candidates and the thread rule

- **Goal:** `analyzeSent(deps, ctx, mailboxId, { now, limit })` picks the work and applies the rules without LLM.
- **Decisions:**
  - Only with both org flags and the switch on (D6). Candidates: `origin = user` rows with `content = stored` and no analysis row, or a `pending` analysis row due now; oldest first; at most 20 per run. A `pending` sent row waits (its text and markers come later, G3); `headers_only`/`gone` → `skipped` / `no_text`.
  - Promise rule first (PD-122, G11): each open `promised` loop older than the row whose counterpart is in the row's To or Cc closes `later_reply`, in any thread; the row goes on.
  - Thread rule (D9): the row is in the thread of an open `waiting`/`delegated` loop, newer than its `wait_from_at`, and its To ∪ Cc overlaps the loop's → `restartLoop` (due = `defaultDue(sent_at, max(loop_wait_days, 3))`), `skipped` / `thread_restart`, no call. No overlap: a side note, analysed as new mail (G4).
  - Delegation rule (G10): in the thread of an open delegation (`sent`/`overdue`) → `skipped` / `delegation_thread`; the delegation chaser keeps that chase.
  - Then `sentSkipReason` (stage 05). Own addresses = the org's mailbox addresses, lower case.
- **Test (integration):** T1 flag `open_loops` off → no row written; T2 a row with `list_id` → `skipped` / `list`, no LLM call (fake counts 0); T3 a user row to the loop's To in the thread of an open waiting loop, sent 2026-11-18 10:00 → restart, `due_at` = Mon 2026-11-23 17:00 Warsaw, no call; the same row to `bob@example.test` only (no overlap) → no restart, one call; T4 a row to the counterpart of an open promised loop in another thread → `later_reply`; T4b a row in the thread of an open delegation → `delegation_thread`; T4c a `pending` row → no analysis row; after its text is stored → analysed.

## Step 2 — The call and the write

- **Goal:** one `extractSent` call per remaining candidate, then one transaction that writes the result.
- **Decisions:**
  - Cap (D14): at 80% of `LLM_DAILY_CAP` (the mailbox's `llm.call` rows of the triage cap's `QUOTA_TIMEZONE` day, review N7) the row stays `pending` / `llm_cap` until 5 min after the next such day starts; no call.
  - The call runs outside a transaction; one write transaction sets the analysis row `done` (`expects_reply`, `has_promise`, `prompt_version`) and inserts the D8 loops with `insertLoop` (`exists` is fine). Loop `text` = `ask` or `promise` (null → the brief shows the subject). To, Cc, subject and message ids come from the sent row, never from the LLM (D5).
  - Delegated (D8): the first To equal to an active delegate's address (lower case) → `delegated`, `delegate_id`, `counterpart` = that address.
  - Due: resolved `due`, else `defaultDue(sent_at, loop_wait_days)` (`due_source` `stated` / `default`); `promised` needs a resolved `promise_due`.
  - Failure (also a schema failure): `attempts + 1`, retry after 5 min × attempts; at 3 → `failed`.
  - Log lines (F103): `sent_analysis_done` (`mailbox_id`, `count`, `opened`), `sent_analysis_failed` (`mailbox_id`, `error_code`). No text, no address.
- **Test (integration, fake LLM):** T5 answer `expects_reply` true, `due` null, sent Fri 2026-11-20 10:00 → one waiting loop, `due_at` Wed 2026-11-25 17:00, `due_source` `default`; T6 `promise` "send the offer", `promise_due` `friday`, sent Wed 2026-11-18 → a promised loop due Fri 2026-11-20 17:00 next to the waiting loop; T7 To = an active delegate → one `delegated` loop, no `waiting`; T8 the write run twice (a crash before the commit) → one analysis row, one loop; T9 at 80 of a cap of 100 → `llm_cap`, no call; T10 three provider errors → `failed`, `attempts` 3.

## Step 3 — The job

- **Goal:** `loops.analyze` (every 60 s) in `createLoopJobs`, `main.ts` and `job:run`; an error of one mailbox does not stop the next.
- **Test:** T11 `job:run --name loops.analyze` runs once on a fixture org and prints counts only.

## Check

`bun test apps/server/test/integration/<the new loops tests>`

## Done when

T1–T11 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s12`).

## Out of scope

Closing by replies (13), the chaser (15).
