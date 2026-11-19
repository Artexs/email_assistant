# F108 questions and defaults

No blocking question. Each item has a coordinator default; the build goes on with it. Decisions by number are in [plan.md](plan.md).

1. **[important: security] Where the database passwords live on the VPS.** Default: the three keys move from `.env` to a new host file `deploy/db.env` (mode 600). Compose reads it only to build the database URLs. The server and `cli` never get it (D1, D5). Other option: an allow-list of about 80 keys for the server (drifts with each new key).
2. **[important: security] `APP_PASSWORD` also leaves the server env.** Default: yes. The server keeps `DATABASE_URL` (role `app`), which holds the same password; the separate key adds nothing (D5).
3. **[minor] The restore drill keeps one env file.** Default: the drill server still sees its own random drill passwords. They are throwaway and `restore.sh --down` deletes them (D9).
4. **[minor] Sim stack and local dev unchanged.** Default: `compose.sim.yaml` and the local `.env` keep the passwords. Neither holds production data (D9).
5. **[important: production] Two releases for the change.** Default: the coordinator makes and deploys release N (adds the `migrate` service) and splits the env before the contract stage is built; the next release removes the migrator URL from the server. A rollback to N works. A rollback below N needs `deploy/env-split.sh --undo` first; `rollback.sh` refuses until then (D4, D8).
6. **[important: irreversible] Old `.env.bak-*` copies on the VPS.** Default: delete a copy only when every line in it also exists, with an equal value, in `.env` or `deploy/db.env`. Otherwise keep it and add an owner item with the differing key names (D12). Values are compared by a script and never printed.
7. **[important: production] Proof that the backup is in Backblaze.** Default: list the bucket from this PC when a read remote already exists here (the VPS key is write-only; the README says the read key is on "the Mac"). Otherwise the evidence is `backup ok`, the status file and the F114 drill; the listing becomes owner step O1 (D10).
8. **[minor] The bucket lifecycle rule.** Default: read it with `rclone backend lifecycle` from the PC; if that is refused, log "not read" and keep the README step (D11).
9. **[important: scope] Mailbox connect, triage and Telegram "paused" in the second-org run.** Default: skip them unless the owner gives a test mailbox and a second Telegram account (O2). Record them as not verified. The plan checks the paused state through the API and the log (D13).
10. **[important: production] F108 closes only after the F114 restore drill.** Default: stages 01–06 build and deploy now. Stage 07 waits for F114 in `done/`. If the drill ran at a tag without stage 01, the new restore path stays stub-tested only (V4, recorded in `outcome.md`). The drill waits for the owner's `age` key (`notes/owner-later.md` item 3).
11. **[minor] Old S6 files.** Default: stage 07 sets the S6 status line and moves `tasks/active/s6-pre-sale.md` and `tasks/planned/s6f-hosted-production.md` to `tasks/done/` (as was done for S6b).
12. **[minor] `MIGRATOR_DATABASE_URL` in the VPS `.env`.** Default: the split tool moves it to `deploy/db.env` with the passwords (Compose sets the real value; the moved line is unused but kept, so nothing is lost) (D6).

## Owner steps (optional, none blocks)

- O1 (stage 06): a read-only rclone remote for the backup bucket on the PC, if none exists.
- O2 (stage 07): a test mailbox (IMAP password) and a second Telegram account for the smoke organization.
- F114 U1–U3 (not F108's, but stage 06 reports them): `age` key path, `BACKUP_PING_URL`, `OPERATOR_TELEGRAM_CHAT_ID`.
