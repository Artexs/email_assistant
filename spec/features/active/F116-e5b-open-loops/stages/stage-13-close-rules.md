# F116 stage 13 — Close rules

Part of [`../plan.md`](../plan.md). `[risky]` (a false close hides a slip). Needs stage 12.

## Step 1 — Pure rules (core)

- **Goal:** `normalizeSubject` and `isAutoReply` (`interfaces.md`) and `replyMatch(loop, mail, { ownAddresses }) → "thread" | "subject" | "auto" | null` in `packages/core/src/loops/`.
- **Decisions (D10):**
  - A mail counts only when `received_at > wait_from_at` and its `from_address` is not an own address.
  - `thread`: `mail.thread_key = loop.thread_key`, or the mail's In-Reply-To / References hold the loop's `message_id` (a broken `thread_key`).
  - `subject`: `normalizeSubject` equal, `from_address` in the loop's To or Cc, `received_at` ≤ `wait_from_at` + 30 days.
  - `auto`: `isAutoReply` true on a mail that would match by thread or subject. It never closes.
  - `normalizeSubject` drops leading `Re:`, `RE:`, `Odp:`, `ODP:`, `Fwd:`, `FW:`, `PD:` (any count, any spacing), collapses spaces, lower case; an empty result never matches.
- **Test (unit):** T1 "RE: Odp: Fwd:  Oferta  Q1" → "oferta q1"; T2 a mail from `anna@example.test` (To of the loop), other thread, subject "Re: Oferta Q1", 3 days after → `subject`; 31 days after → null; T3 the same from `obcy@example.test` (not a recipient) → null; T4 `Auto-Submitted: auto-replied` in the thread → `auto`; `Auto-Submitted: no` → `thread`; T5 from `mailer-daemon@…` → `auto`; T6 from an own mailbox address → null.

## Step 2 — The match job

- **Goal:** `matchReplies(deps, ctx, mailboxId, { now })` and the job `loops.match` (every 2 min) close what the rules find.
- **Decisions:**
  - Input: open `waiting` and `delegated` loops of the mailbox; for each, the incoming mail of the mailbox after `wait_from_at` in the thread (the `emails_thread_received_idx` index) or from its To/Cc within 30 days. The read joins `email_headers` for the auto test (no row = not auto).
  - First match in `received_at` order wins: `thread` → `replied`, `subject` → `replied_subject`, both with `closed_by_email_id`. `auto` only sets `auto_reply_at` (once) and looks further.
  - Each close locks the loop (D15), re-checks that it is open, closes it, and expires its waiting follow-up sends (`loop_closed`, the stage 10 path), in one transaction.
  - An open loop whose `to_addresses` is empty (a DSR erase, stage 07) closes `dropped`.
  - Delegations keep `detectReply` as is; F040 applies to loops only (PD-121).
  - `isOpen` (stage 10) now also runs `replyMatch` for that loop on the DB before it answers, so a reply that arrived since the last run stops the send.
  - Log line `loops_matched` (`mailbox_id`, `count`, `kind` = the reason); no address, no subject.
- **Test (integration):** T7 a waiting loop and a reply in the thread from a Cc recipient → `replied`, the reply's id stored; T8 an out-of-office first, then a real reply → `auto_reply_at` set, then `replied`; T9 only an out-of-office → still open, `auto_reply_at` set; T10 a waiting follow-up send and a reply → the loop closes and the send ends `expired` / `loop_closed` in the same run; T11 a reply arrives after the approval and before the committer runs → no SMTP (`isOpen` false); T12 two `matchReplies` runs at once on the same loop → one close, one audit row.

## Check

`bun test packages/core/src/loops apps/server/test/integration/<the new loops tests>`

## Done when

T1–T12 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s13`).

## Out of scope

Taps and commands (14), promised expiry and stale close (15).
