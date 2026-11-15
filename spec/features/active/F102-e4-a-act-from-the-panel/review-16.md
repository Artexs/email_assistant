# F102 stage 16 review (Opus 5.5, PASS 8165d65b)

Model: Opus 5.5, because the stage is [risky]: it plans a mail to a real person; it must not double a reminder or send without a tap.

No BLOCKING. Probes (two connections, 20 loops each, 15 s deadlock timeout): remind against the chaser tick gives exactly one reminder; two POST remind at once give one 200 and one 409 `reminder_waiting`; a retry gives 200 then 409; remind against cancel or done leaves no reminder for a closed delegation; remind against turning `create_draft` off leaves nothing pending after the switch is off; no deadlock. ADR 0003 end to end with the real committer: the draft becomes `applied`, the send stays `awaiting_approval` with `approved_by` null, the fake sender sends 0 mails; after the panel approve (the tap) one mail goes to the delegate only. The draft is byte-identical to the chaser's (old inline code, shared builder). Flag before role, owner only, strict `{}` body, stable 200/400/401/403/404/409 codes, flat audit data without names or addresses, no migration.

TG1 (proven by mutation; fixed in a Sonnet continue): no test fixes the order "reminder_waiting before delegate_inactive" (the two states can exist together: turning a delegate off does not expire a waiting reminder). Add a test with an inactive delegate and an `awaiting_approval` reminder that expects `reminder_waiting`.
TG2 (equivalent today): swapping the lock order (delegation first, settings share lock second) passes all tests; no contender holds the settings lock and then waits for a delegation lock. The decided order (settings, delegation, reminder sends) holds by code review only. Keep it in mind for any new writer.

Notes:
- N4 plan drift: the stage text says `last_reminder_at` changes when the send is applied; both the chaser and remind-now set it at planning (`markReminderPlanned`). Remind-now has no gap rule by design; the chaser waits 3 days from the planning time, also after a rejected manual reminder.
- N5: the card differs from the chaser's on purpose: a single approval card ("Send? Reminder to …") with Send and Reject, no set card (D9).
- N6: the worker's surviving mutants m17a, m17b, m17e and the reviewer's r1 and r4 are equivalent (second filter or the composite FK).
- N7 (stage 19 docs): add the audit event `delegation.remind_requested` to the audit lists in `docs/capabilities/delegation.md` (line 56), the `audit_log` row in `docs/architecture.md` and `docs/modules.md` (line 249); the chaser text (rule 8, "3 days apart") needs the remind-now exception.
