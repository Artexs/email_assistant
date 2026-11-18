---
opened: 2026-11-13
---

# F120 · The assistant knows who each sender is to the user and suggests rules from it

## Outcome

The assistant keeps a count-only profile of each sender per mailbox (mails, answers, corrections, reply times; no mail text, keyed hash, deleted 12 months after the last mail). From it, the owner gets VIP, whitelist and blocklist suggestions with a reason on the Rules page, sees one sender line in Activity and Approvals, and open loops wait as long as the contact usually takes to reply. The profile line enters the classifier prompt only if it wins the sim holdout. Stage 2 row 26 (`docs/product/stage-2/05-execution-plan.md` §2.1), epic E11 page and discovery notes §2.

## Scope

- Profile table and an hourly recompute pass from the stored mail, Sent, flags and feedback of 90 days.
- Privacy: retention, DSR find and erase, export, org and mailbox delete.
- Suggestions (generator, Accept and Dismiss, Rules card, weekly-report line).
- Readers: sender line, per-contact loop wait, known domains for the look-alike rule, a `classifier-v4` lab experiment.

## Out of scope

- A contacts page, trust score, client or vendor labels, learned delegate tags, thread summaries, snooze (PD-104, PD-105).
- The EU endpoint and the own model (E11b, F111).
- A sender line in Telegram (questions.md Q1).

## Acceptance

- `plan.md` § Done when, items 1–6.
- No column of `sender_profiles` holds a plain address (stage 03 scan test).
- A DSR erase removes the person's profile rows in every mailbox of the organization (stage 04).
- Accept on a suggestion creates the sender rule; Dismiss hides it for 90 days (stage 05).

## Slices

13 stages, one worker job each; order and parallel lanes in `plan.md` § How to run. Stage 02 is the only migration. Stage 13 is a coordinator VPS step.

## Sequenced

- Plan after: F116 (open loops), F102 (approvals page), F104 (Sent sync), F110 (history check): all have `stages/`.
- Build after: F100 (E3a, done), F104 (E5a), F110 (E4-B) in `spec/features/done/`.
- Gate: — (stage 13 waits for the F104 and F110 VPS stages).

## Notes

- Decisions: `plan.md` § Input; defaults: `questions.md`; ADR 0034 (accepted with amendments in stage 12).
