---
opened: 2026-11-13
---

# F085 · A mailbox whose host the guard refuses gets a status and a notice

## Outcome

When the mail host guard (F082 stage 8) refuses the host of a mailbox, the mailbox gets a clear status and the owner gets one notice. Today the refusal is only a `sync <id> failed: host not allowed` log line on every run, so nobody sees it. The status shows in the panel and in `mailbox:check`, and the notice follows the same one-per-episode rule as the other mailbox notices.

## Scope

- Starting seam: `apps/server/src/modules/mail/host-guard.ts` (`HostNotAllowedError`), the sync loop in `modules/mail/`, the mailbox status flow (§4.6 of `docs/architecture.md`) and the notice detection of `channels.notifier`.
- Found by the cold review of F082 (finding 5, `spec/features/active/F082-s6b-public-login/plan-review-1.md`).

## Out of scope

- Changes to the guard rules or its address ranges.
- The connect form: it already refuses such a host with an answer.

## Acceptance

- A mailbox whose host the guard refuses at sync or send time gets a status that the panel and `mailbox:check` show.
- The owner gets one Telegram notice per episode, with no host name or address in the text.
- A test with a fake resolver that returns a local address covers the status and the notice.

## Notes

Plan details belong to the `plan-task` run that picks up this ticket.
