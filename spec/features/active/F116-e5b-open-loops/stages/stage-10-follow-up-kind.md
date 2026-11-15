# F116 stage 10 — Follow-up kind, claim and send

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people, the committer). Needs stage 09.

## Step 1 — Kind, template and message (core)

- **Goal:** draft kind `follow_up` (`interfaces.md`), its template and the outgoing message.
- **Decisions:**
  - Template (texts in `packages/core/src/texts/`), `n` 1: en "Hello,\n\nI am coming back to my message of {date} about "{subject}". Could you let me know where this stands?" / pl "Dzień dobry,\n\nwracam do mojej wiadomości z {date} w sprawie „{subject}”. Czy mogę prosić o informację, jak wygląda sprawa?"; `n` 2: en "Hello,\n\nI am writing again about my message of {date} about "{subject}". I would be grateful for a short answer." / pl "Dzień dobry,\n\nponownie piszę w sprawie mojej wiadomości z {date} („{subject}”). Z góry dziękuję za krótką odpowiedź." Then the signature (the rule of the other kinds), then the quote. `{date}`: pl `10.11.2026`, en `10 Nov 2026`, org time zone; language `other` → en.
  - Quote: "My message of {date}:" / "Moja wiadomość z {date}:" (no gendered Polish form) and `> ` lines of `quote`, cut to the `QUOTE_MAX_CHARS` of the other kinds; `quote` null → no quote block.
  - Subject: `Re: <subject>` unless it already starts with `Re:`/`RE:`/`Odp:` (then unchanged).
  - Headers: In-Reply-To = the anchor's `messageId`; References = the anchor's `referencesIds` + `messageId`, deduplicated, at most the last 20; `X-EA-Action-Id` as for every kind. No LLM text anywhere in the message (D12).
- **Test (unit):** T1 pl and en render of `n` 1 and 2 with subject "Oferta Q1", date 2026-11-10, Warsaw → the exact texts above with "10.11.2026" / "10 Nov 2026"; T2 subject "Odp: Oferta" stays as is; T3 `quote` null → no quote block; T4 References of 25 ids → the last 20 and the message id last.

## Step 2 — Loop hooks and the claim

- **Goal:** the committer claims and applies loop-anchored drafts and sends.
- **Interfaces (new, in `actions`):** `LoopHooks` with `noLoopHooks` (`interfaces.md`): `anchorOf`, `isOpen`, `onFollowUpSent`. `loopHooks(deps)` in `loops` is the real one; the composition root and `job:run` wire it (a test on the wired deps).
- **Decisions:**
  - The claim reads a loop row's mailbox from `open_loops.mailbox_id`; loop rows count as real mail for the test-mail filter. The stage 09 filter goes away in the claim only.
  - Before the APPEND and before SMTP the committer calls `isOpen` under the loop lock; false → the send ends `expired` / `loop_closed`, the draft copy is removed (the existing close path). Stage 13 adds the DB reply check to `isOpen`.
  - After an `applied` send, in the same transaction: `onFollowUpSent` sets `follow_ups_sent + 1`, `last_follow_up_at`, and restarts the wait (D9; due = `defaultDue(at, max(loop_wait_days, 3))`, so the next Draft is never `too_soon` at its due, review N8).
  - Own copies in Sent (review G1): `sentOriginOf` and `isOwnActionId` (`actions/repo/planned.ts`) also resolve a loop-anchored action through `open_loops.mailbox_id`, so the Sent copy of a follow-up is `origin = system`, `headers_only`, and never analysed.
  - `onSentOff` (stage 08) now also expires each waiting follow-up send of the mailbox (`loop_closed`, the path above).
  - The SMTP envelope, the per-recipient send limits and the `SEND_SCOPE self` filter cover `to ∪ cc`: reuse F115 stage 04 when on `master`, else add it here for every kind (To 1, Cc 2 → 3 recipients counted).
- **Test (integration, GreenMail):** T5 To `anna@example.test`, Cc `jan@example.test`, approved → one Drafts copy, one SMTP mail to both, In-Reply-To = the loop's message id, `follow_ups_sent` 1, `due_at` restarted; T6 the loop closed after the approval → no SMTP, `expired` / `loop_closed`, the copy removed; T7 a recipient at its daily limit → `held`; T8 a crash after SMTP before the commit (the existing recovery test pattern) → no second SMTP and one `onFollowUpSent`; T9 the Sent pass reads the APPENDed copy of that follow-up → a `system` row with the action id, no analysis row; T10 the switch off with a waiting follow-up → the send `expired` / `loop_closed`, its card edited (the existing expiry edit).

## Check

`bun test packages/core/src/outgoing apps/server/test/integration/<the touched committer tests>`

## Done when

T1–T10 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s10`).

## Out of scope

Planning (14, 15), cards (11).

## Carry-over from stage 09 review

- `findChains` in the privacy code uses `not (email_id = any(goes))`: NULL for a loop row, check it. Mailbox removal and delete paths that look for sends in flight through `emails`. `audit_log_action_id_org_id_fkey` is ON DELETE CASCADE: deleting a loop deletes its actions and their audit rows (no code deletes loops today). The outbox sender sends any loop row of a card kind that has text: no database rule limits the kinds, stage 11 enforces it in code. Closed loop-anchored payloads: erase sets `actions.payload` and `outbox.text` to `[removed]`: keep a regression test. Roll back every loop-row test (a committed loop row breaks the stage 07 Down guard). See review-9.md.
