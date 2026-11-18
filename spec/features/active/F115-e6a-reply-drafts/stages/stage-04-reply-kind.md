# F115 stage 04 — Reply kind and message

Part of [`../plan.md`](../plan.md). Needs 03b.

Adds the draft kind `reply` along the checklist "Add a draft kind" (`docs/code-patterns.md`), the reply quote, and the per-mailbox name and signature for every kind. Nothing creates a reply yet; tests build payloads by hand.

## Step 1 — Payload and checklist

- **Goal:** `reply` in `draftKinds` with the payload of `interfaces.md`; every place of the checklist rows 1–4. `DRAFT_TEMPLATES` gets no reply text: the body comes from the payload (`body_text ?? body`), so its template row is a `NO_TEMPLATE` entry with a reason (or the record type allows it; ask if neither fits).
- **Decisions:** D14. `to` has exactly one address; `cc` 0–10, no duplicate, none equal to `to`, none equal to an own mailbox (checked by the writer, the schema checks count and shape). Card title: `✍️ Reply to <address>` (en) and the pl text. `draftPhrase` and the digest phrase: "reply drafted". `editApproval` for kind `reply`: editable; its drafts gate is the switch `reply_drafts` (D12), not `create_draft`. Recipients `to ∪ cc` (D14, review B1): the SMTP envelope, the recipient-day send limit and the `SEND_SCOPE self` filter already read `sendRecipients` for every kind (F116 stage 10, plan F3); reuse them, add no second path. The send schema allows Cc only for `follow_up`: open it for `reply` (`to` 1, `cc` 0–10); `follow_up` rules stay. The F106 address map reads the whole payload by the json rule, so `cc` needs no new entry (test 6 proves it). The payload carries `folder` (`interfaces.md`). The committer's drafted-recipient match (today `follow_up` only) applies to `reply` too.
- **Test:**
  1. `draft-kinds.test.ts` and `completeness.test.ts` pass with the new kind.
  2. A payload with 11 cc → schema error; with `cc` equal to `to` → writer error. A reply send payload with 2 `to` → schema error; a `follow_up` send with 10 `to` still parses.
  3. `editApproval` on a reply with `create_draft` off and `reply_drafts` on → `edited`; with `reply_drafts` off → `drafts_off`.
  4. A reply with `cc: ["c@z"]` and 5 sends to `c@z` today → held `send_limit:recipient_day`.
  5. `SEND_SCOPE=self`, `to` a test address, `cc` not → never claimed (stays `approved`, held); both test addresses → sent.
  7. A sent reply with one `cc` → the SMTP fake sees two RCPT commands.
  6. A data-request find for `c@z` finds the reply draft by its `cc`.
  8. A reply send whose `cc` differs from its draft's `cc` → `bad_payload`, zero SMTP calls.

## Step 2 — The message

- **Goal:** `buildOutgoingMessage` for `reply`: subject `Re: <subject>` (no double prefix, as clarification), `In-Reply-To` = original Message-ID, `References` = the chain, recipients `to` and `cc`, the body, then the signature, then the reply quote `quoteReply` (`interfaces.md`), plain text only. No visible system prefix (PD-074).
- **Decisions:** the quote uses the mailbox timezone of the org (as `quoteOriginal`) and the `From` display name of the original (`email_headers.from_name`, else the address). The Polish line is `"<date> <name> napisał(a):"`; the English line `"On <date>, <name> wrote:"`.
- **Test (unit `message.test.ts`, `quote.test.ts`):**
  1. A reply payload for an original with Message-ID `<a@x>` and References `<r@x>` → `In-Reply-To: <a@x>`, `References: <r@x> <a@x>`, subject `Re: Offer`.
  2. Original subject `RE: Offer` → subject stays `RE: Offer`.
  3. The pl quote of a two-line body: header line, then `> ` on each line.
  4. `cc: ["b@y.pl"]` → a `Cc` header; the raw message has no `[[` added by code and no `X-` header other than `X-EA-Action-Id`.

## Step 3 — Name and signature per mailbox (every kind)

- **Goal:** the committer, `editApproval` and the approval view read `mailboxProfileOf` and pass the display name and signature to `buildOutgoingMessage` with the D13 fallbacks.
- **Decision (review 3 N5, set in stage 03b):** `mailbox_profiles.signature` is a snapshot of `organizations.style_text` from the migration. The fallback order stays D13 and is read at send time: the profile `signature` when it is not null → the current `organizations.style_text` (when there is no profile row, or the signature is null, e.g. a mailbox made after the migration or a signature the owner cleared) → the owner name. The profile never copies the org text again. After stage 11 the org card is read-only, so `style_text` stops changing and the two sources cannot drift. `mailboxProfileOf` returns `null` for a mailbox without a row: handle it as "signature null".
- **Test (integration):**
  1. Profile display name `"Anna Nowak"` → `From: "Anna Nowak" <box@x>` for a delegation draft.
  2. No profile row and org `style_text` `"Pozdrawiam, Jan"` → that signature (today's text, no change).
  3. Profile signature set → it wins over `style_text`.
- **Check:** the touched unit and integration tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** TTL, approval rules (stage 05), any producer of reply drafts (stage 07), Telegram review cards (stage 12).
