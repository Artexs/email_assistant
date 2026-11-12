> **Status 2026-11-07 — planned.** Idea from S4 (task file question 7). Not started.

# A button 'It went out' after outcome_unknown

Scope: `docs/architecture.md` §4.5, §4.6. Needs: S4.

## Goal

After a send ends as `outcome_unknown`, the delegation stays `cancelled` even when the mail did go out. A later reply of the delegate is then not matched. A button '✅ It went out' in the result notice would set the delegation to `sent` with the stored `outgoing_message_id`, without a new SMTP call, so the reply is matched and the chaser works.

## Done when

- The `outcome_unknown` notice has a second button next to 📤 Send again. Only an owner can tap it.
- The tap sets the delegation from `cancelled` (`outcome_unknown`) to `sent` with `sent_message_id` = `actions.outgoing_message_id`, and writes an audit row. The send row stays `failed`.
- A second tap, a delegation in another state, and a send that was sent again give a toast and change nothing.
- Tests: the tap, the double tap, and a later reply that is matched to the delegation.
- `docs/architecture.md` §4.5 and §4.6 and `deploy/README.md` (section Approvals and sends) describe the button.

## Plan

`DelegationHooks.onSent` and `markDelegationSent` (from `drafted` and `cancelled`) already do the state change. Decide if the tap needs a new hook or a service function in `delegation`. The callback data is at most 64 bytes: use a new code such as `gw:<action id>`.

- [ ] Write the plan (callback code, handler, hook, texts, tests).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-07: Created from the S4 follow-ups (stage 21, step 21.3).
