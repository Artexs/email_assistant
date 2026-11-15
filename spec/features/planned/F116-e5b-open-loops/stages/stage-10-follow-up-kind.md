# F116 stage 10 — Follow-up kind, claim and send

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people, the committer). Needs stage 09.

## Step 1 — Kind, template and message (core)

- **Goal:** draft kind `follow_up` (payload in `interfaces.md`), its pl and en template, and the outgoing message.
- **Decisions:**
  - Template (texts in `packages/core/src/texts/`), `n` 1: en "Hello,\n\nI am coming back to my message of {date} about "{subject}". Could you let me know where this stands?" / pl "Dzień dobry,\n\nwracam do mojej wiadomości z {date} w sprawie „{subject}”. Czy mogę prosić o informację, jak wygląda sprawa?"; `n` 2: en "Hello,\n\nI am writing again about my message of {date} about "{subject}". I would be grateful for a short answer." / pl "Dzień dobry,\n\nponownie piszę w sprawie mojej wiadomości z {date} („{subject}”). Z góry dziękuję za krótką odpowiedź." Then the signature (the rule of the other kinds at `HEAD`), then the quote. `{date}`: pl `10.11.2026`, en `10 Nov 2026`, org time zone. Language `other` → en.
  - Quote: "My message of {date}:" / "Moja wiadomość z {date}:" (no gendered Polish form) and `> ` lines of `quote`, cut to the `QUOTE_MAX_CHARS` of the other kinds; `quote` null → no quote block.
  - Subject: `Re: <subject>` unless it already starts with `Re:`/`RE:`/`Odp:` (then unchanged).
  - Headers: In-Reply-To = the anchor's `messageId`; References = the anchor's `referencesIds` + `messageId`, deduplicated, at most the last 20; `X-EA-Action-Id` as for every kind. No LLM text anywhere in the message (D12).
- **Test (unit):** T1 pl and en render of `n` 1 and 2 with subject "Oferta Q1", date 2026-11-10, Warsaw → the exact texts above with "10.11.2026" / "10 Nov 2026"; T2 subject "Odp: Oferta" stays as is; T3 `quote` null → no quote block; T4 References of 25 ids → the last 20 and the message id last.

## Step 2 — Loop hooks and the claim

- **Goal:** the committer claims and applies loop-anchored drafts and sends.
- **Interfaces (new, in `actions`):** `LoopHooks` with `noLoopHooks` (`interfaces.md`): `anchorOf`, `isOpen`, `onFollowUpSent`. `loopHooks(deps)` in `loops` is the real one; the composition root and `job:run` wire it (a test on the wired deps).
- **Decisions:**
  - The claim reads the mailbox of a loop row from `open_loops.mailbox_id`; loop rows pass the test-mail filter as real mail. The `email_id IS NOT NULL` filters of stage 09 go away in the claim only.
  - Before the APPEND and again before SMTP the committer calls `isOpen` under the loop lock; false → the send ends `expired` with reason `loop_closed` and the draft copy is removed (the existing close path). Stage 13 makes `isOpen` also check for a reply in the DB.
  - After an `applied` send, in the same transaction: `onFollowUpSent` sets `follow_ups_sent + 1`, `last_follow_up_at`, and restarts the wait (D9; due = `defaultDue(at, loop_wait_days)`).
  - The SMTP envelope, the send limits (per recipient) and the `SEND_SCOPE self` claim filter cover `to ∪ cc`. If `HEAD` already does this (F115 stage 04), reuse it; else add it here for every kind, with the F115 test values (To 1, Cc 2 → 3 recipients counted).
- **Test (integration, GreenMail):** T5 a loop with To `anna@example.test`, Cc `jan@example.test` and an approved follow-up → one Drafts copy, one SMTP mail to both, In-Reply-To = the loop's message id; `follow_ups_sent` 1, `due_at` restarted; T6 the loop closed after the approval → no SMTP, send `expired` / `loop_closed`, the Drafts copy removed; T7 a recipient at its daily send limit → the send is `held` (the existing limit answer); T8 a crash after SMTP before the commit (the existing recovery test pattern) → no second SMTP and one `onFollowUpSent`.

## Check

`bun test packages/core/src/outgoing apps/server/test/integration/<the touched committer tests>`

## Done when

T1–T8 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s10`).

## Out of scope

Who plans a follow-up (14, 15), cards and lists (11).
