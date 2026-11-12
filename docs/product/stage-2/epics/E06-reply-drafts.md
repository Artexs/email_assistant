# E6 · Reply drafts and style

> Tier: Must. Status: needs a short discovery session. Size: about 14 stages, 2.5k lines (like S2). Reuses the draft, approval and send path of delegations.

## Outcome

Mail that needs a reply gets a draft in the thread, in the user's style, waiting for one tap. The user sends the draft as they edited it.

## Users

Executive.

## In scope

- `needs_reply` planner: a reply draft (quote the original, answer in the user's language, `style_text` as a writing style, one optional instruction line from the user such as "say yes for Tuesday").
- The draft goes to the Drafts folder and to the approvals page (E4) and the Telegram card; approval on the exact rendered mail; expiry after 48 h (Fyxer: 14 days; owner decides).
- Send the edited draft (F043): the sent text is what the user edited in the mail client or the panel.
- Reply from the receiving mailbox (product brief rule).
- Injection evals grow: mail text now shapes drafts to third parties.
- Later stage, gated by E2: style cold start from about 300 sent mails (Fyxer, Superkind) and draft-diff learning (PRD US-018). Only if the eval shows better drafts.

## Out of scope

Auto-send (never). Meeting replies with free slots (Stage 3). Two-way chat corrections ("change X to Y") beyond one instruction line (Stage 3).

## Dependencies

E2a (reply cases in the `needs_reply` holdout and the draft judge, PD-026), E4 (approvals page, style editor). Blocks E11. Second-pass trigger: the E2a draft judge exists and an E6 prototype ran on the `needs_reply` holdout.

## Open product questions

1. Draft for every `needs_reply` mail, or only when the user taps "draft" in the brief (cost and noise).
2. Draft expiry: 48 h like delegations, or longer.
3. Style source now: the style text only, or also the last 50 sent mails as examples in the prompt (cheap cold start).

## Risks

- Off-tone drafts cost trust (M3); start with "draft on tap" if E2 shows weak drafts.
- Drafts in the Drafts folder look like the user's own; the `X-EA-Action-Id` header and a prefix mark them.

## Exit

- On the simulated week: every planted `needs_reply` thread gets a draft; a scorer rubric rates tone and facts; the injection set passes.
- On the pilot mailbox: three real replies sent from drafts after edits.
