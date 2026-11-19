# Sent mail read on the pilot mailbox (F104 stage 13), 2026-11-19

Live org (oldest, plan active), its one active mailbox. Ids stay out of the repo. Release v0.3.1 (has stage 13a time budget).

## Steps
- Flag `sent_sync` on for the org (earlier the same day, `org:flag`).
- U1 (the "Track my sent mail" switch): set by the coordinator with `mailbox:settings sent-sync --value on` at 18:56:07Z, on the owner's instruction of 2026-11-19 to bypass blockers on active tickets. Undo: `--value off` (deletes the rows) or the panel switch.

## Checks (after the next `mail.sync`)
1. `sent_sync_done`: `status done`, `kind initial`, `duration_ms 173`. Incremental lines follow on later ticks.
2. `sent_sync_failed` / `sent_sync_mark_failed`: 0 lines.
3. `dropped_fields`: 0 lines.
4. `mailbox:settings show`: `sent: on, folder Wysłane, stored 0, last none, first pass done, error none`.
5. `sent_emails` by content and origin: `headers_only | system | 3`. No `user` rows.
6. `outbox_kind_check` ends with `'sent_missing'`.
9. Answered marks (origin `user` joined to `emails`): 0, because there are no `user` rows.
10. Time budget: one pass, 173 ms, 0 `budget` lines.

## Finding (N2)
Wysłane holds 3 mails from the last 30 days, all sent by the assistant (origin `system`), and none sent by the owner. Either the owner sent no mail from this mailbox in 30 days, or Interia webmail or the owner's client does not save a copy in Wysłane. Ask the owner which. If the owner sent mail, N2 holds: Interia keeps no copy, and the Sent read sees only the assistant's mail.
