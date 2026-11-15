# F102 stage 04 — Edited draft payload

Part of [`../plan.md`](../plan.md). Read D1, D3, F3 and [`../commands.md`](../commands.md) § Data. Needs nothing. Core only (`packages/core`); no server or web change.

## Step 1 — User text cleaning

- **Goal:** one function cleans the text that a user types for an outgoing mail.
- **Files:** a new file in `packages/core/src/outgoing/` and its test; the `@ea/core` index export.
- **Interfaces:** `cleanUserText(text: string, opts: { oneLine: boolean }): string`; constants `EDIT_SUBJECT_MAX = 200`, `EDIT_BODY_MAX = 3000` (characters, counted after cleaning).
- **Decisions:** D3. Rules in this order: CRLF and CR become LF; drop C0 controls except `\n` and `\t`, and drop C1 controls; drop the bidi controls U+200E, U+200F, U+061C, U+202A–U+202E, U+2066–U+2069; trim the end of each line; trim the whole text. With `oneLine`: then every run of whitespace becomes one space. The text is the user's own: no `markUntrustedText`.
- **Test:**
  - T1: `cleanUserText("Hi\r\nthere\u0007\u202E ok  \n", { oneLine: false })` = `"Hi\nthere ok"`.
  - T2: `cleanUserText("Re:\n Budget\t2027 ", { oneLine: true })` = `"Re: Budget 2027"`.
  - T3: `cleanUserText("\u2067\u0000  ", { oneLine: false })` = `""`.
  - T4: `"Zażółć gęślą jaźń"` comes back unchanged (Polish letters stay).
- **Done when:** T1–T4 pass.

## Step 2 — Payload fields and the message

- **Goal:** a draft payload can carry the user's subject and body, and the committer's message uses them.
- **Files:** `packages/core/src/triage/payloads.ts`, `packages/core/src/outgoing/message.ts`, their tests, `packages/core/src/digest/approvals.test.ts` (T10 only).
- **Interfaces:**
  - The `delegation` and `clarification` members of `draftPayloadSchema` gain optional `version` (integer ≥ 1), `subject_text` (1–`EDIT_SUBJECT_MAX`), `body_text` (1–`EDIT_BODY_MAX`). The `reminder` member does not (Q2).
  - `draftVersion(draft: DraftPayload): number` — `version`, else 1.
  - `buildOutgoingMessage`: with `body_text` the body is that text (no template, no signature added: the panel prefills the full template body, signature included); with `subject_text` the subject is that text (no `Fwd:` or `Re:` added). The quote, `In-Reply-To`, `References`, `Message-ID` and `X-EA-Action-Id` rules do not change.
- **Decisions:** D1, D3, F3. Old payloads (no new fields) parse and build exactly as before. The schema checks the length of the stored text; the server cleans before it stores (stage 08).
- **Test:**
  - T5: a `delegation` payload without the new fields builds the same message as on `master` (compare `subject`, `text`, `parts`).
  - T6: the same payload with `body_text` = `"Hello Anna,\nplease send the report.\n\nAdam"` builds `parts.body` equal to that text and `parts.quote` equal to the T5 quote; `text` = body + `"\n\n"` + quote.
  - T7: `subject_text` = `"Budget 2027"` builds the subject `"Budget 2027"`.
  - T8: `body_text` of 3001 characters, or `""`, or `subject_text` of 201 characters fails `draftPayloadSchema`.
  - T9: `draftVersion` gives 1 for T5 and 3 for `version: 3`; a `reminder` payload with `body_text` parses without the key.
  - T10: `renderApprovalRequest` for a view with a 3000-character body and a 8000-character quote returns a text of at most 4096 characters (the quote shrinks first). If the renderer cannot fit it, stop and ask.
- **Done when:** T5–T10 pass; `packages/core/src/triage/draft-kinds.test.ts` passes unchanged.
- **Out of scope:** card texts and view fields (stage 05); the server (stage 08).

## Done when (stage)

- Steps 1 and 2 hold. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s04`).
