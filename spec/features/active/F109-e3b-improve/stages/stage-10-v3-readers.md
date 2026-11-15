# F109 stage 10 — Real-mail readers for `classifier-v3`

Part of [`../plan.md`](../plan.md). Decisions P4, D10. Needs stages 02, 03 (reasons before the LLM call), 07, 08, and the stage 09 summary (`Chosen parts:`). No LLM spend. Production keeps `classifier-v2` until stage 11.

## Step 1 — `loadClassifierExtras`

**Goal.** Triage builds the `ClassifierExtras` of stage 08 for a real or test mail.

**Interface.** `loadClassifierExtras(db, ctx, input: { mailbox, email, parts: ClassifierV3Part[], timezone, suspicious: SuspiciousReason[] }): Promise<ClassifierExtras>` in a new triage file (stage 14 calls it too). It reads only what `parts` needs: no `history` part → no history query.

**Decisions.**

- `attachments` and `isList` from the mail's `email_headers` row: non-inline entries, at most 10, `size` as stored; no row or cleared texts → `[]` and `isList` false.
- `senderHistory` (part `history`): mail of the same mailbox with `emails.from_address_lower = lower($sender)` (never `lower(from_address)`: stage 02 index `emails_mailbox_sender_idx`) received in the 90 days before this mail, without this mail. `received` = their count; `corrections` = the count per `true_category` of their newest `triage_feedback` row with verdict `wrong` (no model labels, stage 08 review N2). Zero earlier mail, or `suspicious` not empty → `null` (no query). Counts only; no subject, no text, no id leaves the reader (P4).
- Test mail: the history of a test mail counts only test mail, the history of real mail only real mail (`mailKindFilter`, as the thread context does).
- `urgency` (part `urgency`): `mailbox_settings.urgency_profile`; `today` = the date of the mail's `received_at` in the organization time zone; deadlines filtered to today−1 … today+30 (the stage 08 helper). Null profile → `null`.
- The service passes the part list of the production classifier prompt (`[]` for v2, so v2 triage runs no new query). One read per mail; the settings row comes from the batch read, so a profile change mid-batch follows triage rule 9.

## Step 2 — Wire into `classifyEmail`

**Goal.** The service passes `extras` to `classifyEmail`. With v2 in production nothing changes in the prompt.

**Test (integration, fake LLM capturing the prompt).**

1. A mail with one PDF attachment, production pointer forced to v3 in the test (inject the prompt, do not change the registry) → the captured user prompt holds the attachment name inside the nonce block.
2. Sender with 4 earlier mails and one `wrong` feedback with `true_category` `needs_reply` → `received 4`, `corrections { needs_reply: 1 }`; the same mail with `suspicious: ["lookalike_domain"]` → `null`.
3. The same sender, mail 100 days ago → not counted; the mail itself → not counted.
4. A test-mail sender's history ignores the real mail of the same address, and the other way round.
5. Org B mail from the same address is not counted for org A.
6. Profile with deadline `2027-01-20`, org time zone `Europe/Warsaw`, mail received `2027-01-14T23:30:00Z` (00:30 local on 01-15) → `today` `2027-01-15`, the deadline included.
7. Production v2: the query log of one triage run has no sender-history query (assert by a spy on the reader, or by counting queries).

**Check.** The new tests and the triage job tests, then the Proof.

**Done when.** Tests 1–7 pass; for each guard (`org_id` scope, test-mail split) the worker removes it, sees its test fail, restores it; Proof `PROOF_OK`.

**Out of scope.** Switching the production prompt (stage 11), escalation.
