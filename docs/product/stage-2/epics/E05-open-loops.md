# E5 · Open loops

> Tier: Must. Status: needs a discovery session and an ADR (reading Sent). Size: about 25 stages, 5k lines (like S4). The highest-value new feature in the plan (04 §3).

## Outcome

Nothing the executive is waiting for slips: the system tracks replies they wait for, promises made in threads, and work delegated by hand, and it chases with a draft. The morning digest becomes a "needs you today" brief.

## Users

Executive. The EA later (Stage 3).

## In scope

- **Waiting-for-reply**: the user's own sent mail that asks a question or requests something, with no answer after N days → a line in the brief and a follow-up draft (same engine as delegation tracking and the chaser). Needs the Sent folder: today the system never reads Sent (architecture §4.1 rule 1); this epic adds a read-only Sent sync with its own ADR and the rule "never change Sent".
- **Commitments**: promises the executive made in threads ("offer by Friday") extracted by the LLM into checked, dated items; the user confirms or drops each one; due items in the brief.
- **Manual delegation**: from the panel and a Telegram command, tracked like automatic delegation (PRD US-012); the Sent-folder check for forwards the user made by hand.
- **"Needs you today" brief**: the digest reordered as open loops first: urgent, waiting on you, waiting on others (overdue first), promises due, then the handled summary. Also the input for M2.
- M2 (open loops on time) counts waiting-for-reply and commitments from here on.

## Out of scope

Calendar and meeting items (Stage 3). Snooze (later, small). Reply drafts for incoming mail (E6). Reading Drafts or Trash.

## Dependencies

E3 (metrics and the simulator's waiting-for-reply cases), E4 (dashboard and API commands). Blocks E11 (thread summaries build on the same thread model).

## Open product questions

1. Default wait before a follow-up draft: 3 working days? Per contact later (E11).
2. Commitments: extract only from the executive's own mail, or also from what others promised to them ("vendor said Tuesday").
3. Follow-up drafts: automatic draft with approval (like delegation) or only a line in the brief by default.
4. Sent sync depth: last 30 days at connect, then incremental.

## Risks

- Reading Sent is a privacy and trust step: the user must see it in the mailbox settings and switch it on; shadow first.
- LLM-extracted commitments are untrusted text: dates and items are checked, never acted on without a tap.
- Threading by headers on IMAP providers is imperfect (roadmap risk 2); the simulator covers forwarded and broken threads.

## Exit

- On the simulated week: M2 ≥ 90% for delegations and waiting-for-reply; every planted dropped thread appears in the brief within the set wait.
- On the pilot mailbox: one real waiting-for-reply chase went out after a tap.
- ADR for the Sent read; the mailbox settings page shows the switch.
