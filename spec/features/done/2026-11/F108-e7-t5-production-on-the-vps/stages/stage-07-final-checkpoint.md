# F108 stage 07 — Final checkpoint: a second organization on the VPS; close S6

A coordinator run on the VPS and this PC; no worker job. Needs stage 06: its record (`server env ok`, backup checks) in the queue note. Needs the F114 drill record in `deploy/README.md` § VPS lost (present since 2026-11-19; P5). Steps 1–8 read nothing from stages 01–06.

Part of [`../plan.md`](../plan.md). Risk: the pilot org shares the host and the database.

## Carry-over reads

`docs/capabilities/tenancy-and-plans.md` (plan state, paused banner, Telegram "account paused"), `docs/capabilities/account-data.md` (`org:delete`), `deploy/README.md` § Invite a customer, § Customers, § Delete an organization; `tasks/active/s6-pre-sale.md` (checkpoint 3 and "Done when"); the drill record in `deploy/README.md` § VPS lost and `notes/2026-11-15-vps-deploy-queue.md` § Restore drill record (F114 has no `outcome.md`); the F139 rerun record, if it ran.

## Rules

- Never pass the pilot org id to a write command. Read the pilot org id from `org:status` first and compare before every write.
- Test data only: name `F108 smoke <yyyy-mm-dd>`, email `f108-smoke-<yyyymmdd>@x.test` (D13). No real address.
- Print no setup link, token or password in the notes. The setup link is a secret for 24 h: use it, then let it expire.
- Record every command and its result line in `notes/2026-11-15-vps-deploy-queue.md` § "F108 checkpoint".

## Steps

1. Before: pilot `org:status` (plan, last sync), `ops:alerts`, health. Keep the numbers.
2. `org:invite --org-name "F108 smoke <date>" --email <smoke address> --display-name "F108 smoke" --lang en` → a new org id and a setup link.
3. Set the password and accept the terms through the link, from the PC on the tailnet with a browser tool (Playwright in a temp folder; not committed). Then `org:status --org-id <new>`: one member, terms version set.
4. Mailbox and triage (Q9): only when the owner gave a test mailbox (O2). Else record "connect and triage: not verified (no test mailbox)".
5. `org:plan --org-id <new> --plan suspended`. Checks: an API write as the smoke user answers `403 org_suspended`; the panel API that feeds the banner reports `suspended`; the log has no triage or sync line for the new org after the change. Telegram "account paused": only with O2; else "not verified".
6. `org:plan --org-id <new> --plan active`: the audit row `org.plan_changed` exists; a write works again.
7. `org:delete --org-id <new> --confirm "F108 smoke <date>"` (through `cli`) → ok. Then `org:status --org-id <new>` finds no org; the `information_schema` count of rows with that `org_id` is 0 (use the F106 check if one exists).
8. After: pilot `org:status` plan unchanged, a new `sync_done` line after step 7, `ops:alerts` none, health 200.

## Close

9. CI: the last three `ci` runs on `master` are green (`gh run list`). The two old timing tests are closed in `docs/known-alerts.md` (F093): confirm, do not edit.
10. Restore: cite the first drill result (2026-11-19, tag `v0.3.1`, `restore.sh` 173 s, counts equal) in `docs/capabilities/backups.md`. `v0.3.1` has no `deploy/compose-lib.sh`, so it does not prove the `migrate` path (V4). Cite the F152 drill rerun (Restore drill record 2 in `notes/2026-11-15-vps-deploy-queue.md`) when it ran at a tag that holds `deploy/compose-lib.sh` (the board puts it on v0.4.2): then V4 is proven. Else write V4 "new restore path not proven on a host" in `outcome.md` and in `notes/owner-later.md`.
11. `tasks/active/s6-pre-sale.md`: status line "S6 done 2026-MM-DD"; move it to `tasks/done/` with `git mv`; `tasks/planned/s6f-hosted-production.md` the same. Each S6 "Done when" line that F108 owned gets its evidence pointer.
12. `outcome.md` in the ticket folder (3–6 sentences, the evidence pointers, the not-verified lines of steps 4 and 5).

**Done when.** Steps 1–12 recorded; the pilot numbers of step 8 match step 1 (plan, sync still running); every "not verified" line is in `outcome.md` and in `notes/owner-later.md` when it needs the owner.

**Out of scope.** A real customer, a real mailbox of another person, any change of the pilot org.
