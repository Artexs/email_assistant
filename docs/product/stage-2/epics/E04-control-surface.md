# E4 · Control surface and trust UX

> Tier: Must. Status: needs a discovery session. Size: about 38 stages, 9k lines (like S5); the biggest product epic. Can run next to E2 and E3.

## Outcome

The panel covers every user action, and every decision shows why it was made, how sure the system was, and how to undo it. A new user walks a trust ladder from shadow to earned autonomy per category. Every action is a channel-neutral API command.

## Users

Executive; later the EA (Stage 3) and the mobile client (E12) on the same commands.

## In scope

- **Delegates page**: CRUD, competence field, block own address, CSV import (old UI spec, MVP item).
- **Delegation dashboard**: overdue, in progress, answered; filters; "send reminder" and "send all".
- **Approvals page**: every waiting draft with recipients spelled out, full body, the thread it answers, inline edit (F039, F043), approve, reject; an edit invalidates the earlier approval (R14).
- **"Why" and confidence** on every digest row and activity row: rule hit or model reason code, confidence mark (R15).
- **Autonomy per category**: the existing switches shown with the measured accuracy from E3 ("notification: 96% on your mail; auto ON"); the go/no-go bar as the visible criterion.
- **Onboarding trust ladder** (R9): connect → shadow 3–7 days → "what I would have done" report → turn on `auto` per category. The report is also the demo for E10.
- **Spam review**: a short list of what went to spam, to catch false positives (ES 6).
- **Bulk unsubscribe**: List-Unsubscribe header, one tap, with approval; small.
- **Focus or vacation mode**: notices off for a period; `/pause` stops processing, this does not.
- **Mail digest channel**: the digest by mail as an alternative to Telegram (users without Telegram).
- **Style text**: edited as a writing style, separate from the signature (`SignatureCard.tsx` today).
- **"What is urgent for me" editor** (PD-017): VIP people, key topics, open deadlines; the data shape comes from E2a; E3 feeds it to the classifier prompt.
- Every new action is an API command with typed input and output (`03` §4); OpenAPI description of the commands.

## Out of scope

Waiting-for-reply, commitments, manual delegation (E5). Reply drafts (E6). Operator console (E7). PWA and push (E9). Live updates (F055) unless cheap.

## Dependencies

E1. Blocks E5, E6, E9, E12. Identity tier 1 (E7) builds after this epic's API commands exist.

## Open product questions

1. Panel first or Telegram first for approvals with full context: the panel is the proposal; Telegram keeps the short card and a link (F075 later).
2. The "what I would have done" report: a page, a mail, or both.
3. Accessibility bar: WCAG AA pass on the new pages, or later.

## Risks

- Six new pages is a large web build; split into two tickets (delegation and approvals first; trust ladder and the rest second).
- The owner is the only user: do a hand test of each page on the phone (the skipped S5e checks come back here).

## Exit

- Each in-scope item has a page or a flow, a Playwright test, and an API command with a typed schema.
- A new test organization walks the trust ladder end to end on the simulator and gets the report.
- The digest and the activity page show a "why" line on every row.
