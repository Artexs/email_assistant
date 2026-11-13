# 0033 — Reply drafts: free LLM text under code checks; mail-client edits win

- Status: proposed (E6 discovery, 2026-11-13). The E6a ticket sets "accepted" when it lands.
- Date: 2026-11-13
- Amends: `docs/architecture.md` §4.5 (approval flow) and §7 "The template" rule. Replaces the plan of F043.

## Context

Every draft today is a fixed template (`packages/core/src/outgoing/templates.ts`). The LLM fills only one-line fields (`task`, `question`, `due_date`); `markUntrustedText` masks addresses, links and numbers in them and removes line breaks. No LLM sentence reaches a third party.

E6 adds reply drafts for mail that needs the user's answer. A useful reply is free text: it answers questions, in the user's style. Mail text is untrusted, and so is text the LLM writes from it (architecture §7). Known attacks: EchoLeak (CVE-2025-32711) and CVE-2026-55145 made Copilot put other inbox data into a reply draft, once below 50 blank lines.

The user can also open the draft in the mail client, edit it, and send it there. Today the send path does not look at the Drafts copy, and expiry and reject delete it by its `X-EA-Action-Id` header. F043 planned to read the edited draft back and send it.

## Decision

1. **Free text, narrow context.** The drafter (writer role) gets the incoming mail with its quoted history (marked data block), the mailbox's writing style, signature and display name, the user's instruction line, the target language and the date. No other mail, file, calendar, web page or contact. It has no tools.
2. **Facts become gaps.** The model writes a missing fact or decision as `[[label]]`, or answers `no_draft` with a reason code. The server refuses to approve a version that holds `[[`.
3. **Code checks before storage.** No e-mail address, link, phone or account number unless the same string is in the user's instruction, signature or writing style; at most 2,000 characters; no run of more than two blank lines; no header-like line; no control or bidi characters; language = target language. One retry with the failure reason, then `draft_failed`. Plain text only; the signature is added by code.
4. **Recipients never come from text.** Default `From`; "Reply all" and "Use Reply-To" are user taps that read the stored headers and make a new version (ADR 0003 and PD-031 hold).
5. **The approval binds to the exact version** (PD-031). Approval happens in Telegram or the panel; the full body and the gaps are shown.
6. **Mail-client edits win.** The system never sends text it read back from the mail client and never deletes a draft the user changed. Before every system send (all draft kinds), the committer locates the Drafts copy and compares a hash of its body with the approved version: same → send; changed → stop with `draft_changed` ("send it from your mail client"); missing and the original answered → `sent_by_user`; missing otherwise → `draft_missing`. Expiry, reject and supersede remove the copy only when the hash matches.
7. **Already answered** comes from the stored `\Answered` flag (E3a, PD-068) and the "answered by the user" mark of the read-only Sent sync (ADR 0029). E6 adds no Sent read; it asks for one Sent pass right before a system send.

## Consequences

- `docs/architecture.md` §7 "The template" becomes "templates for delegation, clarification and reminder; checked free text for replies". §4.5 loses "Do not send the draft from your mail client" and gains the hash check.
- F043 is closed as replaced. Reading an edited draft back stays out of Stage 2.
- Reply drafts need E3a header capture (`Auto-Submitted`, `List-Id`, `Precedence`), E3a flags and the E5a mark.
- The injection eval grows by a reply set (`docs/product/stage-2/epics/E06-discovery-notes.md` §3.11). A prompt or model change of the drafter passes the E2a holdout and judge first (PD-025).
- One more LLM call per reply draft (about $0.35–0.40 per mailbox per month on `gpt-6-luna`); it counts in M7 and in `LLM_DAILY_CAP` (automatic drafts stop at 80%).
