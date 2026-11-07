> **Status 2026-11-07 — planned.** Idea from S4 (stage 15). Not started.

# Edit the approval message with the result

Scope: `docs/architecture.md` §4.5. Needs: S4.

## Goal

The result of a send is a new Telegram message (outbox kind `send_result`). The approval message keeps only the line that the tap added. An edit of the approval message with the result would read better: one message for each mail, from the request to the result.

## Done when

- After a send ends, the approval message shows the result text instead of a new message (or both: the plan decides).
- The `outbox` has an edit kind that uses `external_message_id` of the approval row. A missing id falls back to a new message.
- Tests: the edit path, the fallback, and a message that is older than the Telegram edit window.
- `docs/architecture.md` §4.5 and `docs/modules.md` §3.8 describe the edit.

## Plan

`outbox.external_message_id` is stored for every sent row, and `ChatChannel` has `edit`. Decide how the edit keeps the button of a failed send (📤 Send again).

- [ ] Write the plan (the outbox edit kind, the sender change, the fallback, tests).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-07: Created from the S4 follow-ups (stage 21, step 21.3).
