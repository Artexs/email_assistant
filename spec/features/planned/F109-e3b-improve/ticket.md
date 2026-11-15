---
opened: 2026-11-13
---

# F109 · E3b Improve

## Outcome

Suspicious mail gets a warning and no delegation draft, attachments show in the notice and reach the classifier, and each classifier change (urgency context, sender history, list signal, a second opinion before a hide) ships only when it wins on the dev set and holds on the holdout. During an LLM pause, VIP and whitelisted mail gets a "not triaged yet" notice. Source: Stage 2 row 15 (`docs/product/stage-2/05-execution-plan.md` §2.1), epic `docs/product/stage-2/epics/E03-measured-core.md` and its discovery notes.

## Scope

- Phishing and suspicious-mail rules (PD-063): code rules, stored reason codes, warning in notices, no delegation draft, sim measurement.
- Attachments (PD-064): summary line in notices; name, type and size in the classifier prompt.
- Urgency profile storage and its API and CLI command (PD-017); E4-B builds the editor on it.
- Prompt `classifier-v3` experiments on the dev set and one holdout gate (PD-061, PD-062).
- Conditional escalation to a stronger model (PD-060), with its own dev and holdout gate.
- Degraded-mode notice during an LLM pause (PD-067). Capability pages.

## Out of scope

- New categories, reply drafts (E6a, F115), follow-ups (E5b, F116), the urgency editor and unsubscribe (E4-B, F110), the contacts model (E11a, F120), provider fallback (F072).
- Folder hint (F061) and the cold-mail reason code: no sim truth to measure them (plan D14).
- Changes to the frozen corpus `lab-01` v1.

## Acceptance

- A committed holdout report gives the phishing recall, the whitelisted flags and the other-mail flag rate of the rules against the targets of `plan.md` stage 05.
- With the flag `suspicious_mail` on, a flagged `delegation` mail gets no draft and its notice shows the warning (integration test).
- A dev report per `classifier-v3` part and one holdout report decide the production prompt; the registry names the prompt that the rule of `plan.md` D13 picked.
- The escalation dev report states "ship" or "no ship" by `plan.md` D16; escalation runs in triage only after "ship" and with the flag `escalation` on.
- During an LLM pause, a VIP mail gets one "not triaged yet" notice with the sender only (integration test).
- All checks of `plan.md` § Done when (6 items) hold.

## Slices

16 stages, one worker job each, in the order and lanes of `plan.md` § How to run. Stage 02 (the only migration), 09, 11, 13 and 14 are `[risky]` (migration, LLM spend or production prompt change). Stage 14 builds only when stage 13 says "ship". No owner checkpoint stops the build.

## Sequenced

- Plan after: none (F097 and F100 are in `done/`; their interfaces are at HEAD).
- Build after: F097 (E2a), F100 (E3a), both in `spec/features/done/`.
- Gate: second pass after the first E2a holdout report (PD-060, PD-061). The planner took it on defaults (plan P10, `questions.md` Q1); the build does not wait.

## Notes

- First holdout report: `evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v2.md`; gap report `evals/results/2026-11-15-sim-vs-real-gap-lab-01.md`.
- Interfaces for later tickets: `suspiciousReasonsOf` (E5b, E6a), the urgency command (E4-B), `escalation` role (E11b reads the gate files).
