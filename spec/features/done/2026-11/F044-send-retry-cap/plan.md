> **Status 2026-11-07 — planned.** Idea from S4 (stages 12.1 and 13.1). Not started.

# A shorter cap for send retries

Scope: `docs/architecture.md` §4.1 rule 6 (outcomes table), §4.6. Needs: S4.

## Goal

A soft `envelope` error (a 4xx reply, a lost connection or a timeout before the content) retries every 5 minutes without a count. Only `held_timeout` ends it, 48 hours after the tap. A shorter cap with its own text, for example 6 hours and then `failed` / `smtp_error`, would tell the user sooner.

## Done when

- A send that gets only soft errors before the content ends as `failed` / `smtp_error` after the cap (the plan sets the number of hours).
- The result notice names the cause in its own text and offers 📤 Send again.
- Tests: a scripted sender with soft errors reaches the cap; the cap does not touch a retry with a count; there is no retry after `content`.
- `docs/architecture.md` §4.1 rule 6 and the alert entry `action <id>: failed smtp_error` describe the cap.

## Plan

The retry rule is in `actions/send.ts` (`sendOutcomeOf`, `sendFailed`). The cap needs the time of the first try: `approved_at` is available, or a new column. Decide in the plan.

- [ ] Write the plan (where the first-try time comes from, the cap, the notice text, tests).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-07: Created from the S4 follow-ups (stage 21, step 21.3).
