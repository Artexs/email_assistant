# E11 · Contacts and context

> Tier: Should. Status: needs a discovery session after E3 and E6 numbers. Size: about 20 stages, 4k lines (like S3).

## Outcome

The system knows who each sender is to the user and uses that to find urgent mail, pick delegates and draft better. Threads are summarized as one story, not one mail. The privacy story has a technical answer.

## Users

Executive; the operator (privacy options).

## In scope

- Contacts model (old mental model v2): per sender: relation (client, team, vendor, newsletter, unknown), trust score, competence tags for delegates, response history; built from mail history and user reactions.
- Suggestions that update from reactions: suggest VIP, suggest blocklist, suggest a delegate; the user confirms, never automatic.
- Thread summaries (whole thread, not one mail) for the brief and for the approval context.
- Privacy options: a PII sanitizer before the LLM (names and addresses replaced by tokens, restored after), or a local-LLM provider behind the provider switch (ADR 0015). Pick one by the E2 eval: accuracy loss vs privacy gain.
- Snooze ("show me again Monday") in the brief, if still wanted (small).
- Per-contact wait before a follow-up (E5 default becomes adaptive).

## Out of scope

RAG or vector search unless E2 showed a gain (then its own ticket). CRM integrations. Mail analytics (later, only if wanted).

## Dependencies

E3 (metrics and simulator), E6 (drafts use the contact context). E5 (thread model).

## Open product questions

1. Where the contact page lives: the panel (new page) or only as data behind VIP and delegates.
2. Sanitizer vs local model: which privacy story the product tells first.

## Risks

- A contacts table is personal data of non-users: retention and delete (E7) must cover it from the first migration.
- Suggestions can feel like surveillance; show the reason ("you replied to 12 of 14 mails from this sender").

## Exit

- On the simulator: `urgent` recall improves with contact context against the E3 baseline, or the feature stays off by default.
- VIP suggestions appear in the panel with reasons; the sanitizer or local model passes the eval within the accepted loss.

## Input from the E3 discovery (2026-11-13, PD-062, PD-063)

- E3b may ship a counts-only sender history hint (past labels and corrections per sender); the contacts model replaces it and must beat it on the E2a holdout.
- The look-alike rule of the phishing flag compares against known domains; the contacts model becomes its source of "known senders".
