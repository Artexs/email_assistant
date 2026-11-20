# Known alerts

Alerts we have already diagnosed. Before you diagnose an alert, search this file for its text.

When you find the cause of a new alert, add an entry below (newest first).

Since F089, a log line is an event: key a new entry by its `event` code (and the field that tells the cases apart, for example `reason=`). An old heading keeps its old text in parentheses, so a search for an old log line still finds it.

Status values: `fixed` · `fix pending` · `workaround` · `won't fix` · `investigating`

## Template

### `<event code>` (or the exact alert text, or its stable part)

- **First seen:** YYYY-MM-DD
- **Source:** which module / source / command raised it (log line, monitor)
- **Cause:** what actually went wrong
- **Fix:** what was changed (commit hash, file) or what to do when it fires
- **Status:** fixed / fix pending / workaround / won't fix / investigating

---

### `reply_sweep_failed` (fields `action_id`, `error`, `error_code`)

- **First seen:** 2026-11-18 (F115 stage 09; not seen live)
- **Source:** `apps/server/src/modules/replies/sweep.ts` (job `replies.sweep`, level `warn`).
- **Cause:** The sweep could not check or close one open reply send (a database error in the close, or a read that failed). The sweep goes on with the next send; the failed one is tried again in 5 minutes.
- **Fix:** No action for one line. If the same `action_id` repeats, read the `error_code` and the lines of the same run. The send still ends by itself 7 days after its creation, and the committer runs the same checks before any send, so no mail goes out on a stale reply.
- **Status:** investigating

### `reply_llm_config_error` and `reply_draft_error` (fields `reply_request_id`, `error_code`; `reply_draft_error` also `error`)

- **First seen:** 2026-11-18 (F115 stage 07; not seen live)
- **Source:** `apps/server/src/modules/replies/draft-one.ts` (job `replies.drafter`, level `error`).
- **Cause:** `reply_llm_config_error`: the model of the role `drafter` answered with a configuration error (a bad key, a model that does not exist, a blocked project). The request goes back to `pending` in 5 minutes with no try, and the other requests of the run wait through the pause of the job. `reply_draft_error`: a database error or a bug after the claim of a request; the request is released with a counted try, and the third ends it `failed` / `internal`.
- **Fix:** `reply_llm_config_error`: check `LLM_PROVIDER` and the API key of that provider (and `OPENAI_OWN_MODEL` on an own endpoint) (`deploy/README.md` § Reply drafts), then restart the server. `reply_draft_error`: read `error_code` and the stack of the line, file a bug with the request id (no mail text is in the line).
- **Status:** investigating

### `draft_copy_kept` (fields `action_id`, `reason`; level `info`, not an alert)

- **First seen:** 2026-11-18 (F115 stage 08; not seen live)
- **Source:** `apps/server/src/modules/actions/drafts.ts` (`removeDraft`).
- **Cause:** A reverse row (after a send, a reject, an expiry or a new version) found a Drafts copy that the system must not delete: the hash differs (the user edited it) or a reply has no baseline (`reason` is `no_baseline`).
- **Fix:** None. The copy stays in Drafts for the user to delete. Many lines with `no_baseline` point to `draft_copy_unhashed` for that mailbox.
- **Status:** won't fix

### restore drill (`deploy/restore.sh --target drill`; the failure text `restore failed at guard-empty`)

- **First seen:** 2026-11-19 (first drill, F114 stage 09 Part C)
- **Source:** `deploy/restore.sh` on the VPS, project `ea-drill`.
- **Cause:** drill 1 took 173 s for `restore.sh` and 9 min wall time (RTO target 2 h). Counts before, drill and after were 2 / 2 / 1 / 313 (`organizations`, `users`, `mailboxes`, `emails`). On a fresh volume the first run fails at `guard-empty` with `FATAL: the database system is shutting down`: `pg_isready` turns healthy during the init phase of the Postgres image, before the final start. A checkout of `v0.1.0` fails at step `credentials` (`Script not found "credentials:check"`): use `v0.2.0` or later.
- **Fix:** `restore.sh` now waits for the final server on TCP (step `db-ready`: `pg_isready -h 127.0.0.1` inside the `db` container, up to 60 probes, 1 s apart) before `guard-empty`. The init server listens on the socket only, so a TCP answer means the init ended. `restore failed at db-ready` means no TCP answer after 60 probes: read `$C logs db`. Next drill: 2027-05-19 (+6 months).
- **Status:** fixed in code; drill rerun pending

---

### `push_key_version_mismatch`

- **First seen:** 2026-11-19 (the push sender is new, F118 stage 08)
- **Source:** the push sender (`channels.push`, `channels/push-sender.ts`), level `error`, once per run.
- **Cause:** `CREDENTIALS_KEY_VERSION` in `.env` is not the version that sealed the stored push devices. The key was changed, or the server runs an old `.env`.
- **Fix:** put the right `CREDENTIALS_KEY` and `CREDENTIALS_KEY_VERSION` back and restart. Nothing is lost: the sender removes no device and fails no row for this error; all push rows wait 10 minutes, then the sender tries again, and a row older than 24 h ends `expired`. A key change with the SAME version makes the stored devices unreadable instead: the sender removes each one (`push_secret_unreadable`, the rows end `no_device`) and the members turn notices on again in Settings (`deploy/README.md`).
- **Status:** open until the key is restored (a configuration alert: it fires on every run until `CREDENTIALS_KEY_VERSION` matches the stored devices again).

---

### Log store: vlagent reads no lines

- **First seen:** 2026-11-15 (the store is new, F103 stage 18)
- **Source:** the log store UI (`/select/vmui/`) shows no `server` lines, or `$C --profile ops logs vlagent` shows no file read. The store itself is healthy.
- **Cause:** `vlagent` reads `/var/lib/docker/containers/*/*-json.log` and nothing else. It finds no file when the Docker root directory is not `/var/lib/docker`, or when the `server` container does not use the `json-file` driver (a `local` log has another path and format).
- **Fix:** check `docker info --format '{{.DockerRootDir}}'` and `docker inspect --format '{{.HostConfig.LogConfig.Type}}' $($C ps -q server)`. The root must be `/var/lib/docker` and the type `json-file`; if not, fix the driver (`bash deploy/check-logging.sh`, then `$C up -d --force-recreate --wait server`) or change the `vlagent` mount and glob in `deploy/compose.yaml`. Then run `$C --profile ops up -d --force-recreate vlagent`.
- **Status:** workaround

### `slo_sync_lag` (operator alert text `ALERT slo_sync_lag`; also `STILL OPEN`, `RESOLVED`, `TEST`)

- **First seen:** 2026-11-15 (F114 stage 03; not seen live)
- **Source:** job `ops.slo` (`apps/server/src/modules/operator/slo-job.ts`, check `checkSyncLag`). The text goes to the operator chat `OPERATOR_TELEGRAM_CHAT_ID` (with no chat: the `info` line `slo_alert_sent`, `kind=slo_sync_lag`).
- **Cause:** An active mailbox of an organization that is not suspended has shown no sign of life for more than `SLO_SYNC_LAG_MIN` minutes (default 15). A sign of life is the last sync, the last status change, the creation of the mailbox, or the resume of its organization. Line 2 shows the count of late mailboxes and the age of the oldest; line 3 shows up to five mailbox ids. The alert opens at once, repeats every `SLO_REPEAT_H` hours (default 6) while a mailbox is late, and resolves when no mailbox is late. For 10 minutes after a server start it gives no verdict (an open alert stays open).
- **Fix:** `bun run org:status` lists the mailboxes with their organization ids; then `bun run mailbox:check --org-id <uuid> --mailbox-id <uuid>` for the id in line 3. The usual causes: the IMAP server is down or slow, the password changed (`auth_error` is a different status and does not count here), the sync job fails (grep the log for `sync_failed`), or the server was down. When the cause is gone, the next sync clears the alert within 5 minutes.
- **Status:** won't fix (expected behaviour)

### `slo_urgent_latency` (operator alert text `ALERT slo_urgent_latency`)

- **First seen:** 2026-11-15 (F114 stage 03; not seen live)
- **Source:** job `ops.slo` (`checkUrgentLatency`).
- **Cause:** An urgent mail that the urgent notice covers waited more than `SLO_URGENT_LATENCY_MIN` minutes (default 10) outside the quiet hours (22:00 to 07:00 of the organization) for its notice, or still waits. Line 2 shows the count and the longest wait; line 3 shows up to five mail ids. A late notice that went out stops counting one hour after its send, so the alert resolves one hour after the last late notice. Three readings can look like a false alarm, and are not:
  - A notice that fails for good (`blocked`, `no_chat`, `bad_view`) has no send time, so the mail counts as late for the 24 h look-back. One user who blocked the bot can hold this alert open. Check `outbox` rows of kind `urgent` with `status = 'failed'` for the mail id, and fix the chat link of that user.
  - The wait starts at the receive time of the mail (or at the later status change of the mailbox or resume of the organization), not at the triage time. A slow or late triage counts as a late notice.
  - The check reads at most 200 urgent mails per organization in 24 h. Mail beyond that counts as late. This is an edge case that a real organization does not reach.
- **Fix:** For each id, read the state of the notice: the `outbox` row of kind `urgent` and the log lines of the sender (`outbox_failed`). A stuck worker or a Telegram outage is the usual cause. The alert resolves by itself once the notices go out.
- **Status:** won't fix (expected behaviour)

### `slo_llm_errors` (operator alert text `ALERT slo_llm_errors`)

- **First seen:** 2026-11-15 (F114 stage 03; not seen live)
- **Source:** job `ops.slo` (`checkLlmErrors`).
- **Cause:** In the last `SLO_LLM_WINDOW_MIN` minutes (default 30) at least `SLO_LLM_MIN_CALLS` calls (default 5) ran and at least `SLO_LLM_FAIL_PCT` percent of them failed (default 20), or an organization is paused by a spent quota (`http_429_quota`). Line 2 shows the failed and total calls and the percent; line 3 shows up to five organization ids with a quota pause. The alert closes only when fewer than `SLO_LLM_CLEAR_PCT` percent fail (default 10) or there are too few calls, and no quota pause remains.
- **Fix:** Read the `reason_code` of the failed `llm.call` audit rows in the window. `http_429_quota` means the provider quota is spent: raise the quota at the provider. Other codes (`http_5xx`, `timeout`) mean a provider outage: wait, or change `LLM_*` roles in the config.
- **Status:** won't fix (expected behaviour)

### `slo_disk` (operator alert text `ALERT slo_disk`)

- **First seen:** 2026-11-15 (F114 stage 04; not seen live)
- **Source:** job `ops.slo` (`checkDisk`, stage 04). Line 2 shows the free percent and the free gigabytes of the volume `SLO_DISK_PATH`.
- **Cause:** The free space is below `SLO_DISK_FREE_PCT` percent (default 15) or below `SLO_DISK_FREE_GB` gigabytes (default 2). It closes at 5 points and 0.5 GB above those values.
- **Fix:** Free space on the VPS: old backups (`BACKUP_DIR`), Docker images and build cache (`docker system df`), logs. Never delete the database volume. `deploy/README.md` § Release (the script `deploy/release.sh`) has the disk check.
- **Status:** won't fix (expected behaviour)

### `slo_backup_age` (operator alert text `ALERT slo_backup_age`)

- **First seen:** 2026-11-15 (F114 stage 04; not seen live)
- **Source:** job `ops.slo` (`checkBackupAge`, stage 04), reading the status file that `deploy/backup.sh` writes.
- **Cause:** The status file is missing or unreadable (line 2: no backup status file), the last backup run failed, or the last good backup is older than `SLO_BACKUP_MAX_AGE_H` hours (default 26).
- **Fix:** Read `~/ea-logs/backup.log` on the VPS and run `deploy/backup.sh` by hand; the last line must be `backup ok <name> <bytes>`. The alert resolves at the next tick after a good run.
- **Status:** won't fix (expected behaviour)

### `slo_check_failed` (field `kind`; fields `error`, `error_code`)

- **First seen:** 2026-11-15 (F114 stage 03; not seen live)
- **Source:** job `ops.slo` (`apps/server/src/modules/operator/slo-job.ts`, level `warn`).
- **Cause:** The check of one kind threw, or the alert state of that kind could not be read or written (usually a database error). The job skips that kind for this tick and runs the other kinds. An open alert of the kind stays as it is.
- **Fix:** Read `error` and `error_code`. A database error repeats for all kinds: check `/health` and the database. If one kind fails every 5 minutes, read the check code of that kind. No operator alert goes out for this line: it is only in the log.
- **Status:** investigating

### `slo_alert_send_failed` (fields `kind`, `status`; fields `error`, `error_code`)

- **First seen:** 2026-11-15 (F114 stage 03; not seen live)
- **Source:** job `ops.slo` (`slo-job.ts`, level `warn`). `status` is the phase: `open`, `repeat` or `resolved`.
- **Cause:** The direct send to the operator chat failed (Telegram down, the bot was removed from the group, a wrong chat id, a timeout after 10 s). The job writes no mark, so the next tick (5 minutes later) sends the same notice again. Nothing is lost; the notice is late.
- **Fix:** If it repeats, check the bot and the group: `bun run telegram:check`, then `bun run ops:alert-test --kind slo_disk`. The open and resolved alert state stays in `ops_alerts` (`bun run ops:alerts`).
- **Status:** investigating

### `slo_urgent_zone_bad` (field `org_id`)

- **First seen:** 2026-11-15 (F114 stage 03; not seen live)
- **Source:** job `ops.slo` (`checkUrgentLatency`, level `warn`), once per tick per organization.
- **Cause:** The time zone stored for the organization (`organizations.timezone`) is not a zone that the runtime knows. The check skips the urgent mail of that organization, so the urgent alert gives no verdict for it. The other organizations still count.
- **Fix:** Set a valid IANA zone for the organization (for example `Europe/Warsaw`). Also check the digest of that organization: it uses the same zone.
- **Status:** investigating

---

### `sso_refused` (fields `org_id`, `code`; the matching success line is `sso_sign_in`)

- **First seen:** 2026-11-15 (F119 stage 14 docs; not seen live)
- **Source:** `apps/server/src/platform/auth-sso.ts` (`reportSsoEvent`, level `warn`). One audit row `sso.refused` (`provider_id`, `code`) goes with it. The line holds the organization id and the code only: never the IdP e-mail.
- **Cause:** A person came back from the company IdP and our resolver refused the sign-in. No user, link or session was made. The code says why: `not_a_member` (no user with this address, or the user belongs to another organization first), `domain_mismatch` (the address is off the provider domain, a subdomain, or for Google the `hd` claim is wrong), `email_unverified` (the IdP said `email_verified: false`), `identity_mismatch` (the user is already linked to another IdP account of this provider), `sso_off` (the flag `sso_sign_in` is off for the organization). A `no_provider` refusal writes no line and no row.
- **Fix:** No action for one line. For a real person: `not_a_member` → the operator adds them (`bun run org:member --org-id <id> --add …`) or they used the wrong IdP account; `identity_mismatch` → `bun run org:member --org-id <id> --user-id <id> --unlink-sso`, then they sign in again; `sso_off` → `bun run org:flag --org-id <id> --flag sso_sign_in --on`. Many lines in a short time from a stranger mean someone probes the sign-in: the start of `/api/auth/sign-in/sso` allows 10 calls per 60 s per client address.
- **Status:** won't fix (expected behaviour)

### `sso_audit_failed` (fields `kind`, `error`, `error_code`)

- **First seen:** 2026-11-15 (F119 stage 14 docs; not seen live)
- **Source:** `apps/server/src/platform/auth-sso.ts` (`reportSsoEvent`, level `error`). `kind` is `login` or `refused`.
- **Cause:** The audit row of an SSO sign-in or refusal (`sso.login`, `sso.refused`) could not be written, usually a database error. The sign-in or the refusal went on as before: a failed audit write never stops it.
- **Fix:** Check the database (`/health`, the `error_code`). The lost row is not replayed (one lost `sso.login` row is accepted, ADR 0026 amendment). If it repeats, read the `app` role rights on `audit_log` and the foreign key to `organizations`.
- **Status:** investigating

### `operator_sso_session_refused` (field `user_id`)

- **First seen:** 2026-11-15 (F119 stage 14 docs; not seen live)
- **Source:** `apps/server/src/platform/http.ts` (`requireOperator` and the `/operator` page guard). Level `warn`. The line holds the event name and the user id only.
- **Cause:** An operator opened the console or called `/api/operator/*` with a company (SSO) session. The IdP owns the second factor of such a session, so the console needs a password session with TOTP. The API answers `403 { error: "password_sign_in_required" }`; the page answers the 404 page.
- **Fix:** The operator signs out and signs in with the password and the TOTP code, then opens the console again. The line stops.
- **Status:** won't fix (a refusal is the expected answer)

### `password_sign_in_refused_sso`, `reset_request_refused_sso` and `password_session_refused_sso` (field `user_id`)

- **First seen:** 2026-11-15 (F119 stage 14 docs; not seen live)
- **Source:** `apps/server/src/platform/auth-sso-required.ts` (the first two) and the session hook in `apps/server/src/platform/auth.ts` (the third). Level `info`. The line holds the user id only.
- **Cause:** The organization of the user has "SSO required", and the user is not its break-glass owner with TOTP on. (`reset_request_refused_sso` also fires for an SSO-only member: no password account and a membership in an organization with a provider; no "SSO required" is needed for it.) The password sign-in got the answer of a wrong password (`401 INVALID_EMAIL_OR_PASSWORD`), the reset request got the generic answer and no mail, or a password session was refused at its creation (a sign-in or a code step that passed the first check just before the operator's switch). No lockout count, no lock mail and no audit row follow.
- **Fix:** No action for one line. A real member signs in with the company account. If the IdP is down, the operator runs `bun run org:sso --org-id <id> --require off`. The break-glass owner is never refused.
- **Status:** won't fix (a refusal is the expected answer)

### `sign_in_options_failed` (fields `error`, `error_code`)

- **First seen:** 2026-11-15 (F119 stage 14 docs; not seen live)
- **Source:** `apps/server/src/platform/http.ts` (`GET /api/sign-in-options`, level `warn`).
- **Cause:** The small read that tells the login page whether company sign-in exists failed, usually a database error. The route answered `{ "sso": false }`, so the login page shows the password form only.
- **Fix:** Check the database (`/health`). The line stops when the read works again. Members with a company account see no company sign-in button until then.
- **Status:** investigating

### `sso_flag_killed_with_sso_required` (field `count`) and `sso_flag_check_failed` (fields `error`, `error_code`)

- **First seen:** 2026-11-15 (F119 stage 14 docs; not seen live)
- **Source:** `apps/server/src/main.ts` at the start (level `warn`; `countSsoRequiredWhileKilled` in `modules/tenancy/sso-require.ts`).
- **Cause:** `FEATURES_OFF` holds `sso_sign_in`, and `count` organizations require SSO. Company sign-in is closed for them, and the passwords of their members are refused, so only the break-glass owner of each organization can sign in. The second line means that the check itself failed (a database error); the start went on.
- **Fix:** Remove `sso_sign_in` from `FEATURES_OFF` and restart, or run `bun run org:sso --org-id <id> --require off` for each organization. A failed check: read the `error_code` and check the database.
- **Status:** won't fix (a warning of a deliberate kill switch)

### `sso_discovery_failed` (fields `error`, `error_code`)

- **First seen:** 2026-11-15 (F119 stage 14 docs; not seen live)
- **Source:** `apps/server/src/platform/auth-sso.ts` (`discoverProviderConfig`, level `warn`), in the CLI `bun run org:sso --set`.
- **Cause:** The discovery of the issuer failed with an error that is not one of the known discovery codes. The CLI printed `error discovery_failed discovery_unexpected_error` and stored nothing.
- **Fix:** Check the issuer URL and that the server reaches the IdP. Run the command again. A known failure prints its own code (`discovery_private_host`, `discovery_dns_failed`, `issuer_mismatch`).
- **Status:** investigating

### `action_no_provider` and `send_no_sender` (fields `action_id`, `action_type` for the first; before F103: `action <id>: no provider for <type>` and `action <id>: no sender for send`)

- **First seen:** 2026-11-15 (F103 stage 09)
- **Source:** `apps/server/src/modules/actions/apply.ts` (`action_no_provider`) and `send.ts` (`send_no_sender`) (`[actions]`, level `error`).
- **Cause:** The committer claimed an action that needs the mail server (or a send that needs the SMTP sender), but the run holds no provider (or no sender). This is a bug in the committer wiring, not a mailbox problem. The row goes back to its status with a 5 minute wait and no count.
- **Fix:** Read the `committer_*` lines of the same run and the code of `committer.ts` (`needs` of the handler). File a bug with the action type.
- **Status:** investigating

### `draft_copy_unhashed` (fields `action_id`, `error_code`)

- **First seen:** 2026-11-18 (F115 stage 08; not seen live)
- **Source:** `apps/server/src/modules/actions/drafts.ts` (`copyBaseline`, level `warn`).
- **Cause:** The draft step made its copy in Drafts, but the read of that copy right after the APPEND failed (`error_code` is the error name or code), found no copy (`copy_not_found`) or could not read its text (`text_unreadable`). The draft stays `applied` with no `provider_result.copy_hash`, so the copy check has no baseline.
- **Fix:** No action for one line. A reply send of that draft never sends: it ends `draft_missing` and the copy stays. Run `bun run reply:check-copy --org-id <uuid> --action-id <draft id>` to see what the server holds. If many lines appear for one mailbox, read the IMAP lines of the same time (the server may not return the text of a new draft at once).
- **Status:** investigating

### `send_waits_for_draft` (field `action_id`; before F103: `action <id>: the draft is not applied; the send waits`)

- **First seen:** 2026-11-15 (F103 stage 09)
- **Source:** `apps/server/src/modules/actions/send.ts` (`[actions]`, level `warn`).
- **Cause:** A claimed send found that its draft is no longer `applied` (a reject or a failure of the draft ran in the same moment). The send goes back to `approved` with no count and waits.
- **Fix:** No action if one line appears. If it repeats for hours, read the status of the draft row; the send expires by its 48 h rule.
- **Status:** won't fix (expected behaviour)

### `committer_open_failed`, `committer_folders_failed`, `committer_facts_failed`, `committer_close_failed`, `committer_release_failed`, `committer_failed` (fields `org_id`, `mailbox_id`, `error`, `error_code`; before F103: `committer <mailboxId>: open failed: …`, `sync folders failed`, `facts failed`, `close failed`, `release failed`, `committer <mailboxId> failed: …`)

- **First seen:** 2026-11-15 (F103 stage 08)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`; `committer_close_failed` is `warn`, the others `error`).
- **Cause:** One step of a committer run for one mailbox failed: the open of the IMAP or SMTP connection with an error that is not a login or soft error (`open_failed`), the read of the sync folders (`folders_failed`), the read of the owner and organization texts (`facts_failed`), the close of a connection (`close_failed`), the release of the claimed rows (`release_failed`), or the whole run of the mailbox (`failed`). The line has the error name and code only, never the error text.
- **Fix:** After `folders_failed`, `facts_failed` or `open_failed` the batch is released and the next tick (15 s) tries again. A release that failed leaves the rows locked until the lock is stale (10 min). If one mailbox repeats, run `bun run mailbox:check` and read the database and network logs of the same time.
- **Status:** investigating

### `operator_two_factor_required` (field `user_id`)

- **First seen:** 2026-11-14 (F105 stage 04; not seen live)
- **Source:** `apps/server/src/platform/http.ts` (`requireOperator` and the `/operator` page guard). Level `warn`. The line holds the event name and the user id only.
- **Cause:** an operator without two-factor sign-in opened the console or called `/api/operator/*`. The API answers `403 { error: "two_factor_required" }`; the page redirects to `/settings?two_factor=required`.
- **Fix:** the operator turns on two-factor sign-in in Settings → Account, then opens the console again. The line stops.
- **Status:** won't fix (a refusal is the expected answer)

### `two_factor_codes_unreadable` (field `user_id`)

- **First seen:** 2026-11-14 (F105 stage 08; not seen live)
- **Source:** `apps/server/src/platform/auth-two-factor.ts` (`backupCodesLeft`, called by `GET /api/me/two-factor`). Level `warn`. The line holds the user id and the error fields only.
- **Cause:** the user has two-factor sign-in on, but the `auth_two_factors` row is missing or its backup codes do not decrypt. The usual case is a changed `WEB_AUTH_SECRET`. The panel then shows that the number of backup codes is unknown.
- **Fix:** `$C run --rm cli bun run web:two-factor-reset --org-id <uuid> --user-id <uuid> --confirm "<organization name>"` for that user, after the check of who asks (`deploy/README.md` § Two-factor sign-in). The user turns the second factor on again.
- **Status:** workaround

### `user_moves_failed`

- **First seen:** the land date of F029 stage 04 (not seen live)
- **Source:** `apps/server/src/modules/mail/jobs.ts` (`syncOne`). `[mail]`, level `warn`. The line holds `mailbox_id` and the error fields only.
- **Cause:** the move finder failed after a good flag refresh: a lost connection, a DB error. The sync, the refresh line and `last_synced_at` are not affected.
- **Fix:** none needed for one line: the next refresh tries again (for a mailbox with more than 3,000 mails in the 30-day window it can be later in the rotation: the refresh touches the gone mail, which moves it to the back of the queue). Many lines in a row: read `error_code`, check the IMAP connection of the mailbox.
- **Status:** won't fix (expected behaviour; the next refresh tries again)
- **Related info lines** (not alerts): `user_moves_checked` (`count` = the candidates of one refresh: gone rows that still have the folder and UID of the read and no fresh move marker; it can be lower than the gone count of the refresh), `user_moves_found` (the rows that got a new folder) and `user_moves_retry` (a folder cursor moved; the next refresh tries again, with the same rotation delay for a mailbox of more than 3,000 mails).

---

### `new row violates row-level security policy for table "<table>"` (in `http_error`)

- **First seen:** 2026-11-14 (F092; not seen live)
- **Source:** Postgres, through `http_error` of `platform/http.ts` (the `route` field names the route). SQLSTATE `42501`.
- **Cause:** a web request wrote a row whose `org_id` is not the organization of the session. The code filter missed it; RLS refused it. The request answered 500 and wrote nothing.
- **Fix:** find the route and the repository function; fix the `org_id` it writes. Do not turn RLS off.
- **Status:** won't fix (the refusal is the safety net working)

### `invalid input syntax for type uuid` on every query of a request

- **First seen:** 2026-11-14 (F092; not seen live)
- **Source:** Postgres, through `http_error` of `platform/http.ts`.
- **Cause:** `app.org_id` holds a value that is not a UUID. Only `scoped-driver.ts` writes it, from `requireTenant`.
- **Fix:** check the membership row and the scope call.
- **Status:** won't fix (fail closed)

### `operator_route_refused` (field `user_id`)

- **First seen:** 2026-11-13 (F087 stage 6; not seen live)
- **Source:** `apps/server/src/platform/http.ts` (`requireOperator`). Level `warn`. The log line holds the event name and the user id only.
- **Cause:** a signed-in user who is not in `OPERATOR_USER_IDS` called a path under `/api/operator`. The answer is `404 { error: "not_found" }`.
- **Fix:** none for a single line. Many lines for one user id mean someone probes the operator routes: check the user. If the user is the operator, add the id to `OPERATOR_USER_IDS` and restart.
- **Status:** won't fix (a refusal is the expected answer)

### `mailbox_host_blocked` (`reason=sync|committer`), `mailbox_host_check_failed`, `mailbox_host_block_failed`, `mailbox_host_recheck_failed` (before F085: `sync <id> failed: host not allowed`) and `sync_soft_error` with `error=MailHostLookupError error_code=<code>` (before F103: `sync <id>: mail host lookup failed (<code>); the next tick tries again`)

- **First seen:** 2026-11-13 (S6b, F082 stage 8 and 9; not seen live)
- **Source:** `apps/server/src/modules/mail/host-guard.ts` (`resolveMailHost`), through `modules/mail/port.ts` (`HostNotAllowedError`, a hard error). `mail/host-status.ts`, `mail/jobs.ts` and `actions/committer.ts` write the lines: `mailbox_host_blocked` (warn; the guard refused a host and the mailbox became `host_blocked`), `mailbox_host_check_failed` (warn; a lookup failed in the re-check), `mailbox_host_block_failed` (error; the DB write of the status failed), `mailbox_host_recheck_failed` (error; the re-check list failed, the sync run goes on). The sync job logs a failed lookup (a soft error, `MailHostLookupError`) as `sync_soft_error` at level `warn`. The connect form and the send path raise the same errors.
- **Cause:** `host not allowed`: the mail host is, or resolves to, a local, private, multicast, reserved, NAT64 or 6to4 address, and `MAIL_ALLOW_LOCAL_HOSTS` is not true. `MailHostLookupError`: the DNS lookup failed (`error_code` is the system code, `ENODATA` for an empty answer, `UNKNOWN` for none; the error message holds no host name).
- **Fix:** `mailbox_host_blocked`: run `bun run mailbox:check --org-id … --mailbox-id …` (it prints which side is refused and does not connect), then check the DNS answer of the provider host from the server container. A real provider host is public, so a refusal means a wrong host or a DNS change. The mailbox returns by itself when the name resolves to a public address. Do not set `MAIL_ALLOW_LOCAL_HOSTS` on the VPS. `mailbox_host_block_failed`: the DB failed; the next run tries again. `MailHostLookupError`: check DNS from the server container.
- **Status:** fixed for the silent failure (the owner gets a status and a notice); investigating (per case) for a real refusal

### `pwned_check_unavailable` (`status=`, `reason=no_range_lines`, `error=`; before F089: `pwned check unavailable: <status|name|no range lines in the answer>`)

- **First seen:** 2026-11-13 (S6b, F082 stage 6; not seen live)
- **Source:** `apps/server/src/platform/pwned.ts`. Warning. Fields: `status=<n>` (an answer other than 200), `reason=no_range_lines` (200 with no `SUFFIX:COUNT` line), or `error=<name>` (for example `TimeoutError`). The password set or change answers `503 PASSWORD_CHECK_UNAVAILABLE` and changes nothing.
- **Cause:** `api.pwnedpasswords.com` did not answer in 5 s (`TimeoutError`), answered with a status other than 200 (`status=<n>`), answered 200 with no `SUFFIX:COUNT` line, or the server has no outbound HTTPS to it.
- **Fix:** check outbound HTTPS from the server container to `api.pwnedpasswords.com`. For a long outage only: set `AUTH_PWNED_CHECK=off`, restart (the log then warns `pwned_check_off`, field `config_key=AUTH_PWNED_CHECK`), and remove the key when the API answers again.
- **Status:** investigating (per case)

### `lockout_failed`, `terms_record_failed` (before F089: `web: lockout: <label>`; `terms_record_failed` before F103: `web: terms record failed for user <id>: <label>`)

- **First seen:** 2026-11-13 (S6b, F082 stages 5 and 7; not seen live)
- **Source:** `apps/server/src/platform/auth.ts`. Level `error`. `lockout_failed` comes from the sign-in `after` hook (the failure count or the lock write failed). `terms_record_failed` (field `user_id`) comes from the reset path (`onPasswordReset` and the handler `termsAcceptedHandler` in `web-audit.ts`): the password was set, but the terms row was not written. `web-audit.ts` writes the same event code and fields.
- **Cause:** a database error. The sign-in itself is not changed: the user gets the normal answer. A failed lock write means that failed sign-ins are not counted. A failed terms write means the user sees the terms dialog at the next sign-in.
- **Fix:** read the `error` field (the old form: `<label>`) and check the database. No manual repair: the user accepts the terms in the dialog.
- **Status:** investigating (per case)

### `web_undo` (fields `kind`, `email_id`, `user_id`)

- **First seen:** 2026-11-11 (S5d)
- **Source:** `apps/server/src/modules/triage/routes.ts`, `POST /api/actions/undo`. Level `info`. One line for each web Undo. `kind` is `started`, `already`, `nothing`, `too_old` or `held`. Ids only, no mail text. There is no line for a 404 or for feedback.
- **Cause:** a member tapped ↩️ on the Activity page. A `started` Undo also writes the `action.undo_requested` audit rows and, for a mail that is not `unsure`, a `wrong` feedback row with source `undo`.
- **Fix:** none. It is a record, not an error. `held` means the mailbox is paused or `ACTIONS_SCOPE` does not admit the mail.
- **Status:** won't fix (expected)

### `action_failed` with `reason=mail_not_found` (in an e2e run after the activity spec; fields `action_id`, `reason`; before F103: `action <id>: failed mail_not_found`)

- **First seen:** 2026-11-11 (S5d, from the code; not seen in the stage 10 run)
- **Source:** the committer (`apps/server/src/modules/actions/apply.ts`), level `warn`, and an `action.failed` audit row. In an e2e run under `ACTIONS_SCOPE=synthetic` after `activity.spec.ts`.
- **Cause:** the spec taps ↩️ on a seeded synthetic mail (Message-ID `…@ea-seed.test>`). The committer then claims the reverse move and the reverse `mark_read`, and looks for the mail in GreenMail, where it does not exist. Expected: at most two lines for each project (the reverse move and the reverse `mark_read` of M1). In the stage 10 run `cleanUpOrg` removed the mailbox before the committer ran, so no line appeared.
- **Fix:** none. It may appear after the activity spec; it is harmless (the seeded mail is not in GreenMail). No retry follows. An `error` line in the same run is not expected: diagnose that one.
- **Status:** won't fix (expected)

### `org_timezone_changed` and `org_signature_changed` (fields `org_id`, `actor`)

- **First seen:** 2026-11-11 (S5c)
- **Source:** `apps/server/src/modules/tenancy/service.ts`, `updateOrganizationSettings`. Level `info`. One line for each changed field. `actor` is the user id. The lines hold no value (no zone, no signature text). The audit rows are `org.timezone_changed` (`from`, `to`) and `org.style_changed` (`set`, no text).
- **Cause:** the owner changed the organization timezone or the signature in the panel. A timezone change can skip, delay or bring forward one or more digests on that day (`notes/2026-11-11-web-settings-rules-facts.md`). A signature change applies to every message built after it, also to the send of an older draft.
- **Fix:** none. It is a record, not an error.
- **Status:** won't fix (expected)

### `refused: rule limit reached (1000)`

- **First seen:** 2026-11-11 (S5c)
- **Source:** the CLI `rules:add` (`apps/server/src/scripts/rules.ts`), on stderr, exit code 1. The web answers 409 `rule_limit` for the same case.
- **Cause:** the organization has 1000 sender rules (`SENDER_RULE_LIMIT` in `packages/core/src/triage/rules.ts`; cap of B7). Two adds at the same time can pass the cap by one or two rows. At the cap, a duplicate also gives this answer, not "already there".
- **Fix:** delete rules that are not needed (Rules page). Change `SENDER_RULE_LIMIT` only with a reason.
- **Status:** won't fix (expected)

### `mailbox_connect_failed` and `mailbox_password_check_failed` (fields `request_id`, `error`, `error_code`; before F103: `web: mailbox connect failed: <label>` and `web: mailbox password check failed: <label>`)

- **First seen:** 2026-11-11 (S5b)
- **Source:** `apps/server/src/modules/mail/routes.ts`, `POST /api/mailboxes` and `POST /api/mailboxes/:id/password`. Level `info`, one line per 422 or 502 answer.
- **Cause:** a user typo (wrong password, wrong host) or a provider outage or timeout. `error` is the error name and `error_code` its code, when it has one; the line never holds the password, the address or the server text.
- **Fix:** none needed for one line. Many lines in a row for one provider mean an outage or a changed server setting: check the preset hosts in `packages/core/src/mail/providers.ts`. WP and o2 user-name formats are not verified (`notes/2026-11-11-web-mailboxes-facts.md`).
- **Status:** won't fix (expected)

### `telegram_get_me_failed` (fields `error`, `error_code`, `method`)

- **First seen:** 2026-11-11 (S5b)
- **Source:** `apps/server/src/modules/channels/routes.ts`. Warning. Only `POST /api/channels/telegram/link` logs it. `GET /api/channels/telegram` and `/api/me` swallow the failure (`.catch(() => null)`). A `getMe` outage shows in the log only when someone clicks "Link Telegram".
- **Cause:** the Telegram API is not reachable (network, wrong `TELEGRAM_API_ROOT`, bad token) or the 3 s limit ran out. `error` is `GrammyError`, `HttpError` or the error name; `error_code` and `method` show for a Telegram error (`telegramErrorFields`, never the description).
- **Fix:** check the network and the bot token. The link route then answers 502 `telegram_unreachable` and writes no token row. `/api/me` shows `botUsername: null`.
- **Status:** investigating (per case)

### `home_path_failed` (before F089: `web: home path failed: <label>`)

- **First seen:** 2026-11-11 (S5b)
- **Source:** `apps/server/src/platform/http.ts`, the `/` page gate. Warning. The field `error` holds the error name.
- **Cause:** `homePath` (the onboarding state of the user) threw, for example a database error.
- **Fix:** none for one line: `/` redirects to `/onboarding`. Read the `error` field and check the database.
- **Status:** investigating (per case)

### `mail_local_hosts_allowed` (before F089: `mail: MAIL_ALLOW_LOCAL_HOSTS=true: local mail hosts are allowed`)

- **First seen:** 2026-11-11 (S5b, as `web: WEB_MAIL_ALLOW_LOCAL=true: the connect form accepts local hosts`); renamed 2026-11-13 (S6b, F082 stage 9)
- **Source:** `apps/server/src/main.ts`, once at start. Warning. A second line `config_key_renamed config_key=WEB_MAIL_ALLOW_LOCAL` (before F089: `WEB_MAIL_ALLOW_LOCAL is an old name: use MAIL_ALLOW_LOCAL_HOSTS`) shows when only the old key is set.
- **Cause:** `MAIL_ALLOW_LOCAL_HOSTS=true` lets the connect form, the sync and the send accept local and private mail hosts. The dev and e2e setups need it for GreenMail.
- **Fix:** the key must be empty or `false` on the VPS. If this line shows on the VPS, remove `MAIL_ALLOW_LOCAL_HOSTS` and `WEB_MAIL_ALLOW_LOCAL` from `.env` and restart.
- **Status:** workaround (dev and e2e only)

### `mailbox_removed` (fields `org_id`, `mailbox_id`, `user_id`; before F103: `mailbox <id> removed by user <id>`)

- **First seen:** 2026-11-11 (S5b)
- **Source:** `apps/server/src/modules/mail/remove.ts`. Level `info`. A failed status restore after a failed delete is `mailbox_status_restore_failed` (error, fields `org_id`, `mailbox_id`, `error`, `error_code`).
- **Cause:** an owner removed a mailbox in the panel. `delete_mailbox` deleted every row of it. Linked owners get the `mailbox_removed` notice.
- **Fix:** none. It is a record, not an error.
- **Status:** won't fix (expected)

### `sync_failed` with `error_code=23503` right after a removal (before F103: `sync <mailbox id> failed: … violates foreign key constraint …`)

- **First seen:** 2026-11-11 (S5b)
- **Source:** `apps/server/src/modules/mail/jobs.ts`, the per-mailbox `catch` of the sync job. Error line `sync_failed` (fields `org_id`, `mailbox_id`, `error`, `error_code`; the database text is not in the line), one per run that held the mailbox at that second.
- **Cause:** a sync run inserted a mail into a mailbox that `removeMailbox` deleted at the same time. The triage save is not affected: `saveTriage` returns `lost` and writes nothing (fact 11).
- **Fix:** none. The next tick has no mailbox and is clean. Investigate only when the line repeats with no removal.
- **Status:** won't fix (expected)

### `outbox_claim_lost` (field `outbox_id`)

- **First seen:** 2026-11-11 (S5b)
- **Source:** `apps/server/src/modules/channels/sender.ts`. Level `warn`, field `outbox_id` (the row id).
- **Cause:** right after a mailbox removal, `delete_mailbox` deleted a `sending` digest row that the sender already held. The digest went out, but the sender could not mark it. The unsent `digests` row stays, so the next digest repeats that period (B7, cold review finding 26).
- **Cause (other):** the message was sent, but the row was no longer `sending` with the same lock when the sender marked it `sent`. Another run reclaimed the row (stale claim) or the row was deleted (cascade). A duplicate message is possible (delivery is at least once).
- **Fix:** none. One repeated period is accepted. Investigate only when the line shows with no removal. Check the outbox row and the other lines with the same `outbox_id`.
- **Status:** won't fix (expected)

### `sync_folder_failing` (fields `org_id`, `mailbox_id`, `folder_key`, `failed_runs`=3; before F103: `sync <mailbox id> folder <key>: failed 3 runs in a row`)

- **First seen:** 2026-11-09
- **Source:** `apps/server/src/modules/mail/jobs.ts`, `[mail]` sync job. Error line, once per streak of 3 failed runs of one synced folder (D5).
- **Cause:** the folder read fails in each of 3 runs (IMAP error, a rejected folder, a DB error). The other folders sync as normal. The line names the key, never the path.
- **Fix:** read the warn or error lines before it: `$C logs --since 1h server | grep -E 'sync_folder_soft_error|sync_folder_missing|sync_failed'`. Switch the folder off if it stays broken: `mailbox:settings sync-folder … --key <key> --value off`. The line comes again only after the folder syncs once.
- **Status:** investigating (per case)

### `sync_folder_missing` (fields `org_id`, `mailbox_id`, `folder_key`; before F103: `sync <mailbox id> folder <key>: not on the server, skipped`)

- **First seen:** 2026-11-09
- **Source:** `apps/server/src/modules/mail/sync.ts`. Warning, one per run.
- **Cause:** the folder listing of the server has no folder with the stored path of that row (the user renamed or deleted the folder).
- **Fix:** none needed while the folder is gone: the sync skips that folder and runs the others. Restore the folder name, or switch the row off with `mailbox:settings sync-folder`.
- **Status:** workaround

### `sync_folder_discovery_failed` (fields `org_id`, `mailbox_id`, `error`, `error_code`; before F103: `sync <mailbox id>: folder discovery failed: <error>`)

- **First seen:** 2026-11-09
- **Source:** `apps/server/src/modules/mail/sync.ts`, discovery of the sort folders. Warning.
- **Cause:** the LIST of the server failed or the insert of the folder rows failed. An auth error is not caught here and ends the run as `auth_error`.
- **Fix:** none needed once. The sync goes on with the stored rows and skips the "not on the server" check for this run. Discovery runs again on the next tick. If it repeats, check the connection and the DB.
- **Status:** investigating (per case)

### `IMAP folder gave no highest UID`

- **First seen:** 2026-11-09
- **Source:** `apps/server/src/modules/mail/imap/client.ts`, `folderStatus()`. A `HardError`, so the folder counts as failed in that run.
- **Cause:** the folder reports mail (`exists` > 0), but `FETCH *` returned nothing. The folder changed during the read, or the server answered wrong.
- **Fix:** the next tick tries again. After 3 runs in a row, the alert `sync_folder_failing` follows. Check the folder in the webmail.
- **Status:** investigating (per case)

### `web_off` (field `config_key`=`WEB_BASE_URL`; before F103: `web is off (WEB_BASE_URL is empty)`)

- **First seen:** 2026-11-10 (S5a code; seen live with `WEB_BASE_URL= bun run dev`, hand check 8.2)
- **Source:** `apps/server/src/web.ts` (`webDeps`, level `info`, once per process start).
- **Cause:** The server started without `WEB_BASE_URL`, so the web panel is off: no login, no pages, no `/api` routes. The jobs, the Telegram bot and the CLIs work as before.
- **Fix:** No action, and expected on a host where the web panel is off; the VPS has it on since S5e (deploy/README.md, Web panel). To turn the panel on, set `WEB_BASE_URL` and `WEB_AUTH_SECRET` in the `.env` (only the user edits `.env`) and restart the server.
- **Status:** won't fix (expected behaviour)

### `web_on` (before F103: `web is on: <origin>, dist <path>`)

- **First seen:** 2026-11-10 (hand checks 8.2 and 11.3)
- **Source:** `apps/server/src/web.ts` (`webDeps`, level `info`, once per process start).
- **Cause:** The web panel is on. The line holds no origin and no path: read them from `WEB_BASE_URL` and `WEB_DIST` in the `.env`. The origin is the trust anchor for the cookie and the links.
- **Fix:** No action. Compare the `WEB_DIST` folder with the one that `bun run web:build` wrote (`apps/web/dist` unless `WEB_DIST` says otherwise). A wrong path gives `web_dist_missing`.
- **Status:** won't fix (expected behaviour)

### `web_dist_missing` (before F089: `web: dist folder missing, pages are off`)

- **First seen:** 2026-11-09 (S5a code; the route matrix of stage 6 covers it)
- **Source:** `apps/server/src/platform/http.ts` (`createApp`, level `warn`, once per process start).
- **Cause:** `WEB_DIST` (default `apps/web/dist`) does not exist or holds no `404.html`, so every `GET` and `HEAD` page path answers 503 `text/plain` "The web build is missing. Run bun run web:build." The `/api/*` routes and `/health` answer as before.
- **Fix:** Run `bun run web:build`, or set `WEB_DIST` to the folder that holds the build (the image sets `/app/apps/web/dist`). Then restart the server.
- **Status:** workaround (build the pages, or set `WEB_DIST`)

### `web_cookies_not_secure` (field `config_key`=`WEB_BASE_URL`; before F103: `WEB_BASE_URL is http:// on a non-loopback host: cookies are not Secure`)

- **First seen:** 2026-11-10 (S5a code; not seen live)
- **Source:** `apps/server/src/web.ts` (`webDeps`, level `warn`, once per process start).
- **Cause:** `WEB_BASE_URL` uses `http://` and its host is not `localhost`, `127.0.0.1` or `[::1]`. Better Auth adds `Secure` to the session cookie only for an `https://` base URL, so the browser sends the cookie in clear text.
- **Fix:** Use an `https://` origin: behind Tailscale Serve on the VPS (S5e). An `http://` non-loopback origin is for a test network only.
- **Status:** won't fix (expected only in a misconfiguration: the VPS uses an `https://` `WEB_BASE_URL` since S5e)

### `password_reset_requested` (before F089: `web: reset requested for user <id>`)

- **First seen:** 2026-11-09 (S5a code; not seen live)
- **Source:** `apps/server/src/platform/auth.ts` (the default `sendResetPassword`, level `info`, field `user_id`).
- **Cause:** A `request-password-reset` reached a `createAuth` instance that has no own `sendResetPassword`. It cannot happen over HTTP. With the auth-mail sender off, the `/api/auth/*` allow-list answers 404 for that path. With the sender on (S6b), `webDeps` passes its own `sendResetPassword`. The CLIs (`web:invite`, `org:invite`) pass their own callback in `scripts/lib/invite-delivery.ts` and print the link, so they log no line.
- **Fix:** Investigate: a line means a code path changed or a new `createAuth` caller exists. Check who builds the auth instance without `sendResetPassword` (`webDeps` in `web.ts`, `scripts/lib/invite-delivery.ts`, `scripts/e2e-seed.ts`).
- **Status:** investigating

### `operator_notice_unsent`, `operator_notice_send_failed` and `operator_notice_failed` (field `kind=auth_mail_failed`)

- **First seen:** 2026-11-13 (S6b code; not seen live)
- **Source:** `apps/server/src/modules/channels/operator.ts` (`authMailFailed`). The operator chat gets `Auth mail <kind> to user <id> of org <id> failed (<code>).` One notice per user, code and day. With no operator chat the notice is not sent: the log gets `operator_notice_unsent` (level `warn`, field `kind`; never the text) and the audit row `operator.notice` keeps the notice. A failed audit write or lookup gives `operator_notice_failed` (level `error`, fields `kind`, `error`). A failed send gives `operator_notice_send_failed` (level `error`, fields `kind`, `error`, `error_code`, `method`; never the Telegram description). The same failure is a `warn` line `auth mail <kind> to user <id> failed: <code>` from `platform/auth-mail.ts`.
- **Cause:** The auth-mail sender could not send an invite, reset or lock mail. `<code>` is the nodemailer code (for example `EAUTH`, `ECONNECTION`), `TIMEOUT` or `UNKNOWN`.
- **Fix:** Check the `AUTH_SMTP_*` and `AUTH_MAIL_FROM` keys and the provider (login, port 465 or 587, `AUTH_SMTP_SECURITY`). Make a new link by hand: `bun run web:invite --org-id <uuid> --user-id <uuid> --print`.
- **Status:** open while the sender is off (the home VPS prints the links; no notice fires there)

### `better_auth_log reason=invalid_password` (before F089: `better-auth: Invalid password`)

- **First seen:** 2026-11-09 (S5a code; a wrong sign-in makes it, for example in the Playwright smoke of stage 13)
- **Source:** `apps/server/src/platform/auth.ts` (Better Auth `sign-in.mjs` text through the logger, level `warn`). `betterAuthLogReason` maps the library text to the `reason` code; the text itself never reaches the log.
- **Cause:** One sign-in came with a wrong password. The answer is the same 401 `INVALID_EMAIL_OR_PASSWORD` as for an unknown e-mail, so the line never says which of the two is wrong.
- **Fix:** No action for one line. Many lines per minute from one address mean someone guesses: the rate limit answers 429 after 3 tries in 10 s (W9). S6b (F082) locks a user after 10 failures in 15 minutes; see `docs/architecture.md` §7.
- **Status:** won't fix (expected behaviour)

### `better_auth_log reason=user_not_found` (before F089: `better-auth: User not found`)

- **First seen:** 2026-11-09 (S5a code; not seen live)
- **Source:** `apps/server/src/platform/auth.ts` (Better Auth text through the logger, level `warn`; `reason` from `betterAuthLogReason`).
- **Cause:** A sign-in or a reset named an e-mail with no `users` row. The user answers the same 401 as a wrong password (no hint which one).
- **Fix:** No action for one line; many lines from one address mean someone guesses (see the rate limit line above). A real user who sees the 401 text needs a setup link (`bun run web:invite`).
- **Status:** won't fix (expected behaviour)

### `better_auth_log reason=reset_user_not_found` (before F089: `better-auth: Reset Password: User not found`)

- **First seen:** 2026-11-09 (S5a code; not seen live)
- **Source:** `apps/server/src/platform/auth.ts` (Better Auth text through the logger, level `warn`; `reason` from `betterAuthLogReason`).
- **Cause:** A reset came with a token whose user row is gone (the organization or the user was removed). The reset does nothing.
- **Fix:** No action. Make a new setup link for the user (`bun run web:invite --org-id … --user-id …`) or remove the old link.
- **Status:** won't fix (expected behaviour)

### `better_auth_log reason=invalid_callback_url` (before F089: `better-auth: Invalid callbackURL: <url>`)

- **First seen:** 2026-11-09 (S5a code; the stage 3 fix review found the text)
- **Source:** `apps/server/src/platform/auth.ts` (Better Auth origin check through the logger, level `error`). The URL never reaches the log: only the `reason` code does.
- **Cause:** A request to `/api/auth/reset-password/<token>` or another auth path carried a `callbackURL` outside `WEB_BASE_URL` and `WEB_TRUSTED_ORIGINS`: a hand-edited or foreign link.
- **Fix:** No action for one line. Many lines mean someone probes the route. When a real link fires it, check `WEB_TRUSTED_ORIGINS` (the built shape needs its own origin, for example `http://127.0.0.1:8080`). Never paste such a link into a task file or a ticket: it holds a reset token.
- **Status:** investigating

### `better_auth_log reason=invalid_origin` (before F089: `better-auth: Invalid origin: <url>`)

- **First seen:** 2026-11-10 (S5a code; the final review found the path; not seen live)
- **Source:** `apps/server/src/platform/auth.ts` (the Better Auth origin check through the logger, level `error`). The URL never reaches the log: only the `reason` code does.
- **Cause:** A non-safe `/api/auth/*` request had no `Origin` header (or `Origin: null`) and `Sec-Fetch-Site: same-origin`, so our origin check let it through. Better Auth then checked the `Referer` header and found a foreign site. A browser does not send this combination. A script with hand-made headers does. Better Auth answers 403.
- **Fix:** No action for one line. Many lines from one address mean someone probes the auth routes: the rate limit holds them. When a real browser gets it, check `WEB_TRUSTED_ORIGINS` and the `Referrer-Policy` header (`same-origin`).
- **Status:** investigating

### `better_auth_log reason=schema_mismatch` and `http_error route=/api/auth/* error=BetterAuthError error_code=SCHEMA_MISMATCH` (before F089: `better-auth: Database schema mismatch … Missing tables …` and `GET /api/auth/*: BetterAuthError SCHEMA_MISMATCH`)

- **First seen:** 2026-11-10 (S5a merge: the first `test:e2e` run after a new migration)
- **Source:** `apps/server/src/platform/auth.ts` (the Better Auth logger at start) and `apps/server/src/platform/http.ts` (`onError`, one line per auth request).
- **Cause:** The server started before `bun run db:migrate` added the auth tables or columns. Better Auth checks the schema once and keeps the mismatch until the process restarts (`@better-auth/core` `db/schema-check.mjs`), so every login answers 500 even after the migration ran.
- **Fix:** Run `bun run db:migrate`, then restart the server. The deploy runs the migration before `up` (`deploy/README.md`). The e2e server command runs `db:migrate` before the server starts (`apps/web/e2e/playwright.config.ts`).
- **Status:** fixed (e2e config); a deploy that starts the server before the migration still gets it

### `better_auth_log reason=oauth_state_failed` (new in F119; `error_code=state_mismatch` or another state code)

- **First seen:** 2026-11-14 (F119 stage 03 test; not seen live)
- **Source:** `apps/server/src/platform/auth.ts` (the Better Auth text `Failed to parse state` through the logger; `reason` from `betterAuthLogReason`). The state value never reaches the log.
- **Cause:** A request to `/api/auth/sso/callback/<providerId>` carried a `state` that Better Auth could not use: an unknown, expired or changed value. Typical causes: the person waited too long at the IdP, opened the callback link twice, or the callback was called by hand. Better Auth answers a redirect to `/login?sso=failed&error=state_mismatch`.
- **Fix:** No action for one line. Many lines from one address mean someone probes the callback route: the sign-in rate limit does not cover it, so check the proxy log for the address. A real person who sees the failure signs in again from the login page.
- **Status:** investigating

### `better_auth_log reason=rate_limit_no_ip` (before F089: `better-auth: Rate limiting could not determine a client IP …`)

- **First seen:** 2026-11-09 (S5a code; not seen live)
- **Source:** `apps/server/src/platform/auth.ts` (the Better Auth rate limiter through the logger, level `warn`).
- **Cause:** A request reached Better Auth with no usable `x-client-ip`. The server sets `x-client-ip` before Better Auth (W1), so this line means that wiring changed; Better Auth then falls back to one shared per-path bucket for every client.
- **Fix:** Must not appear. If it does, the builder of the auth request or the `/api/auth/*` mount changed: check `authRequest` and `clientAddress` (with `peerAddress`) in `apps/server/src/platform/http.ts` and `WEB_TRUSTED_PROXIES`.
- **Status:** investigating

### `tenant_multi_membership` (before F089: `web: user <id> has <n> memberships; using the oldest`)

- **First seen:** 2026-11-09 (S5a code; the route matrix of stage 6 covers it)
- **Source:** `apps/server/src/platform/http.ts` (`requireTenant`, level `warn`, once per process and user id; fields `user_id`, `count`).
- **Cause:** The user is a member of more than one organization. S5 has no organization switcher, so `requireTenant` takes the oldest membership (`listMembershipsOfUser`, ordered by `created_at, org_id`).
- **Fix:** No action for one line: the user sees the oldest organization, and the audit rows of the web events go there. A second organization is a bug of the setup until a switcher exists.
- **Status:** won't fix (expected behaviour)

### `web_no_organization` (field `user_id`; before F103: `web: no organization for user <id>`)

- **First seen:** 2026-11-09 (S5a code; not seen live)
- **Source:** `apps/server/src/web-audit.ts` (`auditWebEvent`, level `warn`).
- **Cause:** A user with no membership signed in or set a password. There is no organization for the audit row `web.login`, `web.password_set` or `web.password_changed`. The login itself succeeded.
- **Fix:** Give the user a membership: `bun run org:create` makes an owner; any other user needs an invitation (S5b). Until then that user's `/api/me` answers 403 `no_organization` and the shell shows "Your account is not in any organization. Ask the owner for an invitation."
- **Status:** investigating

### `web_audit_failed` (fields `kind`, `error`; before F103: `web: audit <kind> failed: <label>`)

- **First seen:** 2026-11-09 (S5a code; not seen live)
- **Source:** `apps/server/src/web-audit.ts` (`auditWebEvent`, level `error`). `<kind>` is `login`, `password_set`, `password_changed`, `login_locked`, `sessions_revoked` or `other_sessions_revoked`.
- **Cause:** The audit row of a login or a password change was not written: a database error in `recordAudit` or in the membership query. The login itself succeeded, because the composer catches every `onEvent` error.
- **Fix:** Read the `error` field and check the DB (connection, migration state, the `audit_log` rows). One row is missing for that event; the next login writes its own.
- **Status:** investigating

### `auth_event_failed` (before F089: `web: onEvent <kind> failed: <label>`)

- **First seen:** 2026-11-09 (S5a code; not seen live)
- **Source:** `apps/server/src/platform/auth.ts` (`report`, level `error`; fields `kind`, `error`).
- **Cause:** The injected `onEvent` of an auth event rejected. `auditWebEvent` catches its own errors, so this line means the composition root supplies another `onEvent`, or that function changed. The login or the password change itself succeeded.
- **Fix:** Check the `onEvent` wiring in `apps/server/src/web-audit.ts`. `auditWebEvent` must return without a throw; an audit miss must never fail a login.
- **Status:** investigating

### `process_uncaught_exception` and `process_unhandled_rejection` (fields `error`, `error_code`)

- **First seen:** 2026-11-15 (F103 stage 14; before it Bun printed the message and the source line, and the process exited 1 as well)
- **Source:** `apps/server/src/platform/process-guard.ts`, installed in `main.ts`. The server process writes the event and exits with code 1; Compose restarts the container.
- **Cause:** A bug: code threw outside any `try`, or a promise rejected and nobody handled it. The event carries the error name and code only, never the message.
- **Fix:** Read `error` and `error_code`, then the lines of the same `run_id` or `request_id` just before it (a job run or a request). The container restarted, so check that `server_listening` follows. Fix the missing `catch` at the site.
- **Status:** investigating

### `console_output` (field `dropped_fields`=1; context fields `job`, `run_id`, `request_id` when set)

- **First seen:** 2026-11-15 (F103 stage 14)
- **Source:** `installConsoleGuard()` in `apps/server/src/platform/log.ts`, installed in `main.ts` when `LOG_FORMAT=json`. A library or other code called `console.log`, `info`, `debug`, `warn`, `error` or `trace`. The guard drops the text, so it can hold no database value or mail text.
- **Cause:** A library prints on its own (for example `better-call` prints `# SERVER_ERROR: …`). One `console_output` line stands for one call.
- **Fix:** Find the library by the `run_id` or `request_id` and the time: read our own lines around it (for example `better_auth_error`). Run the server in text format (dev) to read the text. An own call to `console.*` is a lint error: use the logger.
- **Status:** investigating

### `# SERVER_ERROR: <message and stack>`

- **First seen:** 2026-11-09 (S5a code, stage 3 fix review; not seen live)
- **Source:** `better-call` `router.mjs` (`console.error`), not our logger. It follows our own `better_auth_error` or `better_auth_log` line.
- **Cause:** An error that is not a `better-call` `APIError` was thrown inside Better Auth, for example a database error. The line holds the full message and stack, so it can hold database text. `onAuthError` cannot suppress it. In JSON format the console guard replaces the line with one `console_output` event (see the entry above); the text exists only in text format (dev).
- **Fix:** Read our own `better_auth_error` or `better_auth_log` line first (name and code only); use this line for the stack. A database label: check the DB. Cut database text before you paste the line into a task file or a ticket.
- **Status:** investigating

### `http_request method=POST status=403` bursts at level debug (`bad_origin`; before F089: `POST /api/… 403`)

- **First seen:** 2026-11-09 (S5a code; the route matrix of stage 6 covers it)
- **Source:** `apps/server/src/platform/http.ts`: the access log at level `debug` (event `http_request`, fields `method`, `route`, `status`, `ms`) and the origin check that answers 403 `{ error: "bad_origin" }`.
- **Cause:** A client sent a non-safe `/api/*` request without a trusted `Origin` (no `Origin` and no `Sec-Fetch-Site: same-origin` counts as untrusted). A browser on another origin, a proxy that drops `Origin`, or a `curl` call does this. The server refuses before any handler runs.
- **Fix:** Check `WEB_TRUSTED_ORIGINS`: it must hold the browser origin (the built shape needs its own, for example `http://127.0.0.1:8080`). Check that the reverse proxy passes `Origin`. Set `LOG_LEVEL=debug` only while you diagnose.
- **Status:** workaround (set the key or the proxy)

### `deps: bump better-auth …` (a Dependabot pull request)

- **First seen:** 2026-11-10 (stage 15.1; the first weekly run follows the merge)
- **Source:** a Dependabot pull request from `.github/dependabot.yml` (ecosystem `bun`, `directory: /`, weekly, `better-auth` only, at most 2 open PRs).
- **Cause:** Dependabot found a newer `better-auth`. The pins are exact, so one PR holds `apps/server/package.json`, `apps/web/package.json` and `bun.lock` together.
- **Fix:** Read the release notes (security releases are listed on better-auth.com/blog), run `bun run test:int` (the `web-auth*` tests) and `bun run web:build && bun run test:e2e`, then merge and deploy (S5e runbook). Never merge a bump with a red auth test. If no PR arrives, see user step 4 of `spec/features/done/2026-11/F050-s5a-web-foundation/plan.md`: the fallback is a second entry with `directory: /apps/server`.
- **Status:** won't fix (a process entry, not a fault)

### `runSend > 3: a lost response is repeated with the same key` and `AgentMail fake > holdResponseNext: … ^ this test timed out after 5000ms`

- **First seen:** 2026-11-10 (CI run on the S5a branch and on `master`; the `ci` job, `test:unit`)
- **Source:** `apps/server/src/modules/testmail/send.test.ts` and `apps/server/src/modules/testmail/agentmail/fake.test.ts` (unit tests, no database).
- **Cause:** Bun 1.3.14 (CI and the server image) `server.stop(true)` waits for in-flight handlers. The fake's `stop()` cleared the hold timer, so the held handler never ended and `afterEach` hung (log line `a beforeEach/afterEach hook timed out for this test`). Local runs used Bun 1.4.4, where `stop(true)` returns at once. This is a hang, not a slow runner: a longer timeout cannot help. The first entry text said "slow on a CI runner"; that was wrong.
- **Fix:** the fake's `stop()` releases held responses before it stops the server (F093 stage 1). To test on the CI Bun, run `bun run test:unit:ci`.
- **Status:** fixed (4ad0fbd)
- **Pin:** `.bun-version` is 1.4.4 since daea2dc (F094). The fix stays: `stop()` must not wait for a held handler.

### `STARTTLS against a scripted server with a self-signed certificate > … ^ this test timed out after 5000ms`

- **First seen:** 2026-11-12 (CI, `test:unit`, after F049 landed the test)
- **Source:** `apps/server/src/modules/mail/imap/smtp-starttls.test.ts` (three tests: `verifySmtpLogin upgrades first …`, `openSmtpSender sends after the upgrade`, `an untrusted certificate is refused and no password goes out`).
- **Cause:** Bun 1.3.14 cannot finish a server-side `new TLSSocket(socket, { isServer: true })` on an accepted `node:net` socket, so the test server never completed the handshake. Also, a Bun 1.3.14 client that upgrades a socket to an IP host checks the certificate against `localhost`, not the IP.
- **Fix:** at `STARTTLS` the scripted server relays the socket to a second, TLS-only server; the test certificate SAN was `IP:127.0.0.1,DNS:localhost` (F093 stage 1); since F094 it is `IP:127.0.0.1` only, and a test refuses a `localhost` certificate for an IP host. All security assertions are unchanged. Product effect until F094 (pin 1.3.14): STARTTLS to an IP-literal mail host failed the name check (fail-closed), and it accepted a certificate issued for `localhost` (fail-open). DNS names were fine. Since the 1.4.4 pin the check is against the IP. See `notes/2026-11-13-bun-version-drift.md`.
- **Status:** fixed (1796c23)
- **Pin:** `.bun-version` is 1.4.4 since daea2dc (F094); the image runs it after the VPS deploy of F094 stage 2.

### `mailbox:seed and mailbox:audit CLI > seed exits 1 … ^ this test timed out after 5000ms.`

- **First seen:** 2026-11-07
- **Source:** CI `bun run test:int`, `apps/server/test/integration/mail-seed.test.ts` (runs 42414616787 on `master`, 42417654598 on PR #1).
- **Cause:** the test starts six CLI processes one after the other. Their sum is near the 5 s default test timeout (3.9 s locally) and above it on a CI runner.
- **Fix:** the test has its own timeout of 30 s (`spec/features/done/2026-11/F046-flaky-mail-seed-cli-test/plan.md`). Local run: 3.9 s. It failed in 4 of 6 CI runs on 2026-11-07, so a re-run is not a fix.
- **Status:** fixed

### `job:run: TELEGRAM_BOT_TOKEN is empty`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/scripts/job-run.ts` (`[job-run]`, level `error`, exit code 1).
- **Cause:** `bun run job:run --name channels.notifier` ran with no `TELEGRAM_BOT_TOKEN` in the environment. The notifier cannot send without the bot token.
- **Fix:** Set `TELEGRAM_BOT_TOKEN` in the `.env` of that environment (only the user edits `.env`), then run the command again. The other jobs (`actions.expiry`, `delegation.chaser`) need no token.
- **Status:** won't fix (expected behaviour)

### `notice_queued` with `kind` `send_result` (fields `kind`, `outbox_id`)

- **First seen:** 2026-11-07 (S4 code; not seen live, the dev run (stage 19) and the VPS runs (stages 22, 23) are open)
- **Source:** `apps/server/src/modules/channels/notices/` (`[channels]`, level `info`).
- **Cause:** A send ended (`applied`, `failed`, `expired` or `rejected`) and the notice job queued one result message for each linked owner. The dedup key is `send_result:<action id>`, and `actions.result_notified_at` is set in the same transaction.
- **Fix:** No action for the line. Read the message in Telegram; the meaning of each text is in `deploy/README.md`, "Approvals and sends". The same line exists for the kinds `approval_set` and `delegation_answered`.
- **Status:** won't fix (expected behaviour)

### `notice_queued` with `kind` `approval` (fields `kind`, `outbox_id`)

- **First seen:** 2026-11-07 (S4 code; not seen live, the dev run (stage 19) and the VPS runs (stages 22, 23) are open)
- **Source:** `apps/server/src/modules/channels/notices/` (`[channels]`, level `info`).
- **Cause:** A send is `awaiting_approval`, its draft is `applied` and the mailbox is `active`, so the notice job queued one approval request for each linked owner. The dedup key is `approval:<action id>`; `actions.notified_at` is set in the same transaction. The 48-hour approval time counts from `notified_at`.
- **Fix:** No action. If no request arrives in Telegram, check that an owner is linked (`telegram:link`) and that the draft is `applied`.
- **Status:** won't fix (expected behaviour)

### `chaser_skipped_settings` (fields `org_id`, `mailbox_id`)

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/loops/jobs.ts` (`[loops]`, level `info`; once per mailbox and process start; the job `loops.chaser` replaced `delegation.chaser` in F116 stage 15). The same file writes `chaser_skipped` with `reason` `gate` once, when the first tick comes before 07:30 local time or after the run of the day.
- **Cause:** The mailbox is not in mode `assist` (or its switch `create_draft` is off) and the organization has the flag `open_loops` off, or the settings changed during the run (the chaser compares the settings version). The chaser does nothing for this mailbox. With the flag on and no `assist`, the chaser still closes stale and expired loops.
- **Fix:** No action if you want no reminders. To get them: `mailbox:settings mode --mode assist` and `mailbox:settings switch --name create_draft --value on` (`deploy/README.md`, "Assist mode"). `chaser_skipped` with `reason` `gate` is normal. `chaser_forced` (same fields) shows a run with `--force`.
- **Status:** won't fix (expected behaviour)

### `chaser_done` (fields `mailbox_id`, `due`, `overdue`, `reminders`)

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/delegation/chaser.ts` (`[delegation]`, level `info`; once per mailbox and day, only when `due` > 0; written by the job `loops.chaser`).
- **Cause:** The daily chaser run found `due` delegations past their due date (a count). It marked `overdue` of them `overdue` and planned `reminders` reminders (draft + send, `awaiting_approval`). The owners get one approval message for the set.
- **Fix:** No action. Tap 📤 Send all or ✖️ Skip all in Telegram. A reminder never goes out without a tap.
- **Status:** won't fix (expected behaviour)

### `loops_chaser_done` (fields `mailbox_id`, `count`, optional `kind`)

- **First seen:** 2026-11-15 (F116 stage 15; not seen live)
- **Source:** `apps/server/src/modules/loops/chaser.ts` (`[loops]`, level `info`; once per mailbox and day, one line for each part that has a count above 0).
- **Cause:** The daily chaser run planned `count` follow-up cards (no `kind`), closed `count` loops as `stale` (`kind` `stale`: two follow-ups and 14 days, or 30 days after the due date) or closed `count` promised loops as `expired` (`kind` `expired`: 7 days after the due date).
- **Fix:** No action. A follow-up never goes out without a tap. At most 10 sends (reminders and follow-ups together) are planned per mailbox and run; the rest comes the next day.
- **Status:** won't fix (expected behaviour)

### `notice_skipped` (fields `kind`, `item_id`, `error`)

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/channels/notices/` (`[channels]`, level `warn`; `kind` is `approval`, `approval_set`, `send_result`, `delegation_answered` and more; `item_id` is the row id (for `weekly_report` the organization id); `error` is the error name). Once per process and row. One line of the `send_held` kind (a hold with an unknown limit text) has `reason` `unknown_send_limit` and no `error`; it repeats on each tick. Other `send_held` skips carry `error` like the rest.
- **Cause:** The notice job could not build the message for one row (for example a draft payload that does not parse, a missing mailbox, or a missing organization). It skips that row and goes on with the others. The row keeps failing on every tick until someone fixes it, and the owner gets no message for it.
- **Fix:** Find the row with a read-only query (`$C exec db psql -U postgres -d email_assistant -c "<sql>"`):
  `approval`: `select id, status, notified_at, payload->>'kind' from actions where id = '<id>';`
  `approval_set`: `select id, status, notified_at from actions where payload->>'set_id' = '<id>';`
  `send_result`: `select id, status, status_reason, result_notified_at from actions where id = '<id>';`
  `delegation_answered`: `select id, status, answered_notified_at from delegations where id = '<id>';`
  Read `error` and the row (`<id>` is `item_id`), and fix the cause (a bug: file it with the action type, never with the payload). To stop the retries you can set `notified_at` (approval), `result_notified_at` (send_result) or `answered_notified_at` (delegation_answered) by hand: this writes to the database, so do it only after the user says go.
- **Status:** investigating

### `expiry_done` (fields `org_id`, `mailbox_id`, `count`, `expired_timeout`, `expired_draft_missing`, `expired_not_notified`, `expired_not_seen`, `expired_held_timeout`; before F103: `expiry <mailboxId>: expired <n> (timeout <t>, …)`)

- **First seen:** 2026-11-07 (S4 code; not seen live: the hourly timing is checked in the dev run, stage 19, which is open)
- **Source:** `apps/server/src/modules/actions/expiry.ts` (`[actions]`, level `info`; job `actions.expiry`, every hour).
- **Cause:** The job closed `count` sends as `expired`. The five `expired_*` fields split the count: `timeout` (48 h after the approval request), `draft_missing` (its draft failed or was removed), `not_notified` (no request went out within 7 days), `not_seen` (the request is older than 48 h and no owner received it: no `sent` outbox row) and `held_timeout` (approved, but held for 48 h after the tap). Each gives the owners a result notice.
- **Fix:** No action for `timeout`. A high `held_timeout` means sends were held: check `SEND_SCOPE`, a paused mailbox or a login error. A high `not_notified` means no owner is linked. A high `not_seen` means requests did not go out: check the owner chat link (`telegram:link`) and `outbox` rows with `failed`. The same reason `not_seen` also appears at the resume of a suspended organization (`bun run org:plan`, no log line from the job): the owner gets the result notice "you did not receive the approval request (the account was paused, or it did not go out)". The line `expiry_failed` (level `error`; fields `org_id`, `mailbox_id`, `error`, `error_code`) means one mailbox failed; the next hour tries again.
- **Status:** won't fix (expected behaviour)

### `committer_sends_held` (fields `org_id`, `mailbox_id`, `count`, `scope`, `config_key`=`SEND_SCOPE`; before F103: `committer <mailboxId>: SEND_SCOPE=<kind>, <n> approved sends wait`)

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `info`; once per mailbox and process start).
- **Cause:** `SEND_SCOPE` is `off` (the default), or `self` with recipients that are not in `SEND_TEST_ADDRESSES`, or `all` for another mailbox. `count` sends are `approved` with an applied draft, and the scope (`scope`) does not admit them. They stay `approved`.
- **Fix:** No action if you want no sends. To send: set `SEND_SCOPE` (and `SEND_TEST_ADDRESSES`) in the `.env` and restart the server (`deploy/README.md`, "Approvals and sends"). Held sends expire 48 h after the tap (`held_timeout`).
- **Status:** won't fix (expected behaviour)

### `action_failed` with `reason=hard_error` (a `create_draft` row; fields `action_id`, `reason`; before F103: `action <id>: failed hard_error`)

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/drafts.ts` (`[actions]`, level `warn`). A draft with a bad payload gives `action_failed` with `reason=bad_payload` from the same file.
- **Cause:** The draft APPEND (or its recovery, or the removal of a draft) failed with a hard error three times. The draft is `failed`, its open sends expire (`draft_missing`) and the owners get a notice. For a reverse row (draft removal) the notice says that the draft stays in Drafts.
- **Fix:** Read the audit row `action.failed` (`attempts`, `error`) and run `bun run mailbox:check`. Check that the Drafts folder exists and the mailbox is not full. For a reverse row, delete the draft by hand in the mail client. For `bad_payload`, file a bug with the action type (never with the payload).
- **Status:** investigating

### `send_copy_failed` (fields `action_id`, `error`, `error_code`; before F103: `action <id>: sent copy failed: <Class code>`)

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/send-finish.ts` (`[actions]`, level `warn`).
- **Cause:** The mail went out (the send is `applied`), but the copy to `Wysłane` failed: the locate or the APPEND gave an error. `provider_result.sent_copy` is `failed`, and the audit row `action.sent_copy_failed` holds the error label. The line has the error name and code only. The owners read "No copy in Sent".
- **Fix:** No action for the mail: it was sent. Add the copy by hand if you need it. If it repeats, check the `Sent` folder with `bun run mailbox:check`.
- **Status:** investigating

### `send_failed` with `reason=outcome_unknown` (fields `action_id`, `reason`, `send_stage`, `code`; before F103: `action <id>: failed outcome_unknown (stage <s>, code <c>)`)

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/send-failure.ts` (`[actions]`, level `warn`).
- **Cause:** The system cannot tell if the mail went out. Either the SMTP error had stage `unknown` (a connection that broke during or after the content, or an error that is not a typed SMTP error), or the process stopped while the send was `applying` and the recovery found no copy in `Wysłane`. The row is `failed`, the delegation is `cancelled` (`outcome_unknown`), and the system does not send again by itself.
- **Fix:** Look in `Wysłane` and ask the recipient. If the mail did not go out, tap 📤 Send again in the result notice. If it went out, do nothing (the delegation stays `cancelled`: follow-up `spec/features/planned/F041-delegation-went-out-button/plan.md`).
- **Status:** investigating

### `send_failed` with `reason=smtp_error` (fields `action_id`, `reason`, `send_stage`, `code`; before F103: `action <id>: failed smtp_error (stage <s>, code <c>)`)

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/send-failure.ts` (`[actions]`, level `warn`).
- **Cause:** One of four: a soft error before the content (`connect`, `login` or `envelope`) that comes 6 h or more after the tap (the soft cap, F044; `provider_result.cap` is `soft_retry`, the notice says "did not accept the mail for 6 hours", the mail was not sent); a hard error before the content (`connect`, `login` or `envelope`) three times; a 4xx or another non-5xx error after the content (`content`: the server may have the mail, so the system does not retry); or the mail could not be built three times (`compose`). The row is `failed` and the owners get a notice with 📤 Send again.
- **Fix:** For `content`, look in `Wysłane` and ask the recipient before you tap Send again. Otherwise check `/status` and `bun run mailbox:check`, fix the cause, then tap Send again. The line `send_retry` (level `warn`; fields `action_id`, `send_stage`, `code`) is a try that will repeat in 5 minutes; a soft error does not count, but the retries stop 6 hours after the tap. For the soft cap, check the mail server and the network first, then tap Send again.
- **Status:** investigating

### `send_failed` with `reason=smtp_rejected` (fields `action_id`, `reason`, `send_stage`, `code`; before F103: `action <id>: failed smtp_rejected (stage <s>, code <n>)`)

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/send-failure.ts` (`[actions]`, level `warn`).
- **Cause:** The mail server refused the mail with a 5xx reply, at the envelope (`MAIL FROM`, `RCPT TO`) or after the content. `send_stage` is `envelope` or `content`, `code` is the reply number (never the reply text). The row is `failed`. The draft stays in Drafts and the delegation is `cancelled`. There is no Send again button, because the address or the mail is wrong.
- **Fix:** Check the delegate address (`delegates:list`). Replace it with `delegates:disable` and `delegates:add`. The system does not plan the mail again; send it by hand from the draft if you need it.
- **Status:** investigating

### `mailbox:settings: refused: <category> did not pass go/no-go (use --force to set auto on anyway)`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/scripts/mailbox-settings.ts` (`[mailbox-settings]`, level `error`, exit code 2).
- **Cause:** A command `auto <category> on` named a category whose S1b go/no-go row is not `go` (precision below 0.98 or fewer than 30 kept labels). The gate refuses the change.
- **Fix:** No action if you did not want `auto` on. Read the line `go/no-go <category>: …` before it. To set `auto` anyway, run the command again with `--force`; the audit row records `forced`.
- **Status:** won't fix (expected behaviour)

### `notice_queued` with `kind` `action_failed` (fields `kind`, `outbox_id`)

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/channels/notices/` (`[channels]`, level `info`).
- **Cause:** An action became `failed` and the notice job queued one `action_failed` message for the user. The text says which action failed and why. The dedup key is `action_failed:<action id>`, so one action gives one notice.
- **Fix:** No action for the alert. Read the audit row `action.failed` of the action (`reason_code`). The user decides in the mailbox. See `deploy/README.md`, "Assist mode".
- **Status:** won't fix (expected behaviour)

### `returned_done` (fields `mailbox_id`, `count`)

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/triage/returned.ts` (`[triage]`, level `info`; job `triage.returned`, every 15 s). `count` is the number of mails of this run.
- **Cause:** The job processed `count` mails that the sync marked as returned to INBOX (`emails.returned_at`). Only some get a feedback row: `imap_move` for a user move back; none after an Undo or for an `unsure` mail.
- **Fix:** No action. A line `returned_failed` (field `email_id`, `error`, `error_code`) at level `error` means one row failed; read the error name and check the DB. A line `returned_mailbox_failed` (field `mailbox_id`) means the read of the mailbox failed. `returned_feedback` (debug) records one saved feedback row.
- **Status:** won't fix (expected behaviour)

### `expired <n> ready actions`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/scripts/mailbox-settings.ts` (`[mailbox-settings]`, level `info`; the commands `expire-ready` and every gate-closing setter).
- **Cause:** The CLI closed <n> `ready` mailbox actions as `expired`. A gate change (`mode shadow`, `auto off`, `switch off`, `mode assist` without `--keep-switches` when it turns a switch off) does this in the same transaction. The line shows only when a gate closed or `<n>` > 0. `expire-ready` does it on request.
- **Fix:** No action. Run `expire-ready` before you set `ACTIONS_SCOPE=all`, so that old `ready` rows do not apply. The next line shows how many `ready` mailbox actions are left.
- **Status:** won't fix (expected behaviour)

### `sync_below_cursor_limit` (fields `org_id`, `mailbox_id`, `folder_key`, `limit`; before F103: `sync <mailboxId> returned below cursor: list hit the limit <n>`)

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/mail/sync-below-cursor.ts` (`[mail]`, level `warn`).
- **Cause:** The list of mails moved in the last 7 days has 500 rows (`RETURN_CHECK_LIMIT`). The check looks at the newest 500 only, so older moved mails are not checked for a return.
- **Fix:** Check how many mails the system moved in 7 days. If the number is real, raise the limit in a task. No data is lost: the check only misses returns of the oldest rows.
- **Status:** investigating

### `sync_below_cursor_done` (fields `org_id`, `mailbox_id`, `folder_key`, `checked`, `returned`, `copies`; before F103: `sync <mailboxId> returned below cursor: checked <n>, returned <m>, copies <c>`)

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/mail/sync-below-cursor.ts` (`[mail]`, level `info`; one line per sync that has moved mails).
- **Cause:** <n> mails moved in the last 7 days were looked up in INBOX below the UID cursor, <m> of them came back (Interia keeps the UID). `copies` > 0 means a copy of a moved mail sits below the cursor while the original is still in its folder. A stored copy holds its UID, so the next sync counts it no more (`copies=0`). A copy that sync does not store counts again on every sync for 7 days. The debug line `sync_below_cursor_copy` (`email_id`; before F103: `sync <mailboxId> copy below cursor: email <id>`) names the row. When the cursor of the folder moves during the check, the warning `sync_below_cursor_moved` (`folder_key`) ends it and the next sync repeats it. When sync stores copies, the info line `sync_below_cursor_copies_stored` (`mailbox_id`, `folder_key`, `count`) follows. For each copy that sync does not store, the debug line `sync_below_cursor_copy_skipped` gives `email_id` (the moved row) and `kind`: `move_in_flight`, `held`, `cross_copy`, `uncertain` or `not_inserted`.
- **Fix:** `returned` > 0 is normal after a user move back. `copies` > 0: no loss. Sync stores and triages the copy unless a `sync_below_cursor_copy_skipped` line gives the reason (switch the log level to debug to see it). A copy that stays counted for days with `kind=held` or `uncertain` needs a look at the rows of that mail.
- **Status:** investigating

### `committer_soft_error` (fields `org_id`, `mailbox_id`, `error`, `error_code`; before F103: `committer <mailboxId>: <Class code>; the next tick tries again`)

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `warn`).
- **Cause:** Opening the mailbox failed with a soft error (network, timeout, server busy). The claimed actions go back to `ready` and no try counts.
- **Fix:** No action. The next tick (15 s) tries again. If it repeats for hours, run `bun run mailbox:check` and check the pilot mailbox and the network.
- **Status:** won't fix (expected behaviour)

### `committer_auth_error` (fields `org_id`, `mailbox_id`; before F103: `committer <mailboxId>: login failed, status is now auth_error`)

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `warn`).
- **Cause:** The mailbox refused the login (IMAP, or since S4 the SMTP login of a send). The committer set the mailbox status to `auth_error`; the sync notice tells the user. The claimed actions go back to `ready`; an approved send goes back to `approved` with no count and no mail sent.
- **Fix:** Fix the secret (password or app password) with `bun run mailbox:password` and set the mailbox to `active` again. Actions wait and apply later if they are younger than 24 h and the mail is younger than 7 days; older ones expire.
- **Status:** investigating

### `action_retry` (fields `action_id`, `attempts`, `max_attempts`, `error`, `error_code`; before F103: `action <id>: <Class code>, try <n> of 3`)

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/apply.ts` (`[actions]`, level `warn`).
- **Cause:** An IMAP call failed. A soft error (network, timeout) waits 5 minutes and does not count as a try. A hard error waits 5 minutes and counts. After the third hard error the action is `failed` (`hard_error`). `attempts` is the number of the try, `max_attempts` is 3, and the line has the error name and code only. `drafts.ts` writes the same event for a draft; `send.ts` writes `send_retry` for the mail that cannot be built (same fields) and `send_recovery_retry` for the recovery of a send that was left `applying` (same fields).
- **Fix:** No action for try 1 and 2. Read the `last_error` column of the action. For a repeat, check the mailbox with `bun run mailbox:check`.
- **Status:** won't fix (expected behaviour)

### `action_failed` with `reason=bad_payload` (fields `action_id`, `reason`; before F103: `action <id>: failed bad_payload`)

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/apply.ts` (`[actions]`, level `warn`).
- **Cause:** The payload of the action row is wrong (for example a missing folder key or UID). This is a bug in the code that planned the action, not a mailbox problem. The action is `failed` at once.
- **Fix:** Read the audit row `action.failed` and the `payload` of the action. File a bug with the action type. Never put the payload in the bug text if it holds mail data.
- **Status:** investigating

### `action_failed` with `reason=hard_error` (fields `action_id`, `reason`; before F103: `action <id>: failed hard_error`)

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/apply.ts` (`[actions]`, level `warn`).
- **Cause:** The third hard error in a row for the same action. The action is `failed`, the audit row `action.failed` has `reason_code` `hard_error` and the error label. The user gets an `action_failed` notice.
- **Fix:** Read the audit data (`attempts`, `error`). Check the mailbox with `bun run mailbox:check`. The mail stays where it was; the user can move it by hand.
- **Status:** investigating

### `action_failed` with `reason=mail_not_found` (fields `action_id`, `reason`; before F103: `action <id>: failed mail_not_found`)

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/apply.ts` (`[actions]`, level `warn`).
- **Cause:** The locate did not find the mail in its folder (the user moved or deleted it). The action is `failed` at once, without retries. An original action sends no notice; a reverse (Undo) action does.
- **Fix:** No action. The user changed the mailbox on their own. If it happens for mail that the user did not touch, check the identity locate (`locate.ts`) and the folder facts in `notes/2026-11-07-assist-actions-facts.md`.
- **Status:** won't fix (expected behaviour)

### `committer_actions_held` (fields `org_id`, `mailbox_id`, `count`, `scope`=`off`, `config_key`=`ACTIONS_SCOPE`; before F103: `committer: ACTIONS_SCOPE=off, <n> mailbox actions wait in mailbox <id>`)

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `info`; once per mailbox and process start).
- **Cause:** `ACTIONS_SCOPE` is `off` (the default), so the committer applies no mailbox change. `count` mailbox actions are `ready` and wait. The count has `move`, `mark_read` and `flag` actions, and since S4 (M10) also `create_draft` rows (drafts wait for the same scope). `save_summary` is not counted.
- **Fix:** No action if you want no changes. To apply them: set `ACTIONS_SCOPE=synthetic` or `all` in the `.env`, run `expire-ready` first when the rows are old (`deploy/README.md`, "Assist mode"), and restart the server.
- **Status:** won't fix (expected behaviour)

### `committer_stale_expired` (fields `org_id`, `mailbox_id`, `count`; before F103: `committer <mailboxId>: expired <n> stale actions`)

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `warn`).
- **Cause:** The committer found `count` `ready` actions that waited longer than 24 hours (D21) and closed them as `expired`. This happens after the scope was `off`, the mailbox had an `auth_error` or the server was down.
- **Fix:** No action. The mail stays in INBOX. If it repeats, find why the committer did not apply the actions in time (scope, `auth_error`, a pause).
- **Status:** won't fix (expected behaviour)

### `callback_failed` (fields `error`, `error_code`, `method`)

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/bot.ts` (`[telegram]`, level `error`). The line carries `job` `telegram.update` and the `run_id` of the update.
- **Cause:** The handler of a button tap threw an error (a database error or a bug). `error` is `GrammyError`, `HttpError` or the error name; `error_code` and `method` show for a Telegram error. The user sees "Something went wrong".
- **Fix:** Read the fields. A database error: check the DB and the migration state. Repeat the tap. If it repeats, file a bug with the fields (never with a message text). The lines of the same update share the `run_id`.
- **Status:** investigating

### `digest_member_failed` (fields `org_id`, `user_id`, `error`)

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/digest-job.ts` (`[channels]`, level `error`).
- **Cause:** Building or saving the digest of one member failed (for example a database error or a missing organization). The other members continue. The slot stays open, so the next minute tries again.
- **Fix:** Read `error`. If it repeats every minute, check the DB and the member's `digest_times` (`bun run digest:times`). A late slot older than 6 hours is skipped.
- **Status:** investigating

### `notices_org_failed` (fields `org_id`, `error`)

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/notices/` (`[channels]`, level `error`).
- **Cause:** Notice detection for one organization failed (database error or missing organization). The other organizations continue. The next tick (15 s) tries again.
- **Fix:** Read `error`. If it repeats, check the DB and the organization row.
- **Status:** investigating

### `outbox_resent_after_stale` (field `outbox_id`)

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `warn`).
- **Cause:** A row stayed `sending` for more than 5 minutes (the process died, or the DB commit after the send failed), so the next claim sends it again. The user can get the message twice.
- **Fix:** No action. If it repeats, look for crashes or DB errors around the first send of the row.
- **Status:** won't fix (expected behaviour)

### `outbox_refused` (field `code`)

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `error`, fields `outbox_id` and `code`). Code: `telegram_400`, `message_too_long` or `button_data_too_long`.
- **Cause:** Telegram or the adapter guard refused the text or the buttons (400). The row becomes `failed` / `bad_request` and is never sent again.
- **Fix:** Read the row (`text` length, `buttons`). A `message_too_long` or `button_data_too_long` code is a bug in the text builder: file it with the row id.
- **Status:** investigating

### `outbox_bot_blocked` (field `outbox_id`)

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `warn`).
- **Cause:** The member blocked the bot or deleted the chat. The row becomes `failed` / `blocked`.
- **Fix:** Ask the member to unblock the bot and send `/start`. If the chat is gone, make a new link (`bun run telegram:link`).
- **Status:** won't fix (expected behaviour)

### `outbox_paused` and `outbox_rate_limited` (fields `outbox_id`, `wait_ms`)

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `warn`). `outbox_rate_limited` is the 429 case (`wait_ms` is the `retry_after` wait). `outbox_paused` carries `code`: `telegram_network` and `telegram_500` (and other 5xx) are soft errors (backoff 30 s doubling to 15 min). `wait_ms` is milliseconds (the old text printed seconds).
- **Cause:** Telegram limited the bot (429) or was not reachable (network error, HTTP 5xx). The sender pauses and tries the same rows later. After 5 other errors a row becomes `failed` / `too_many_errors`.
- **Fix:** No action for short pauses. For a long one, check the network of the host and https://core.telegram.org reachability. Rows older than 24 hours become `failed` / `expired`.
- **Status:** won't fix (expected behaviour)

### `outbox_token_rejected` (Telegram answered 401; the sender pauses for 10 min)

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `error`, field `outbox_id`).
- **Cause:** Telegram answered 401 to a send: the token in `.env` is wrong, revoked or from another bot. The sender pauses for 10 minutes and tries again.
- **Fix:** Check the token with `bun run telegram:check`. Fix `TELEGRAM_BOT_TOKEN` in `.env` (the user edits it) and restart the server.
- **Status:** fix pending (user action when it fires)

### `telegram_set_commands_failed` (fields `error`, `error_code`, `method`)

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/polling.ts` (`[telegram]`, level `warn`).
- **Cause:** The server could not set the command list at the start (network error or Telegram error). Polling goes on; only the `/` menu in the app is missing or old.
- **Fix:** No action. The next start sets the list again. If it repeats with `error` `GrammyError`, `method` `setMyCommands` and `error_code` 401, fix the token.
- **Status:** won't fix (expected behaviour)

### `telegram_polling_failed` (fields `error`, `error_code`, `method`, `wait_ms`)

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/polling.ts` (`[telegram]`, level `error`).
- **Cause:** `bot.start` failed with an error other than 401 or 409 (network down, Telegram 5xx). The server tries again after `wait_ms` milliseconds: 1, 2, 4 … at most 30 minutes. The count resets after a good `getUpdates`.
- **Fix:** Check the network of the host. No action if the next try works. Mail sync and the DB are not affected.
- **Status:** won't fix (expected behaviour)

### `telegram_polling_conflict` (field `wait_ms`; dev and pilot must use different bots, ADR 0005)

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/polling.ts` (`[telegram]`, level `error`).
- **Cause:** Telegram allows one update consumer per token. A second process (for example the Mac with the pilot token, or a second server container) polls the same bot (409). The server tries again after `wait_ms` milliseconds: 1, 2, 4 … at most 30 minutes.
- **Fix:** Find and stop the other process. Use the dev bot on the Mac and the pilot bot on the VPS. The server takes over by itself at the next try.
- **Status:** workaround (stop the other poller)

### `telegram_polling_token_rejected` (check `TELEGRAM_BOT_TOKEN`; polling stopped)

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/polling.ts` (`[telegram]`, level `error`).
- **Cause:** Telegram answered 401 to `getMe` or `getUpdates`: the token is wrong, revoked or empty-looking. Polling stops and does not retry.
- **Fix:** Check the token with `bun run telegram:check`. Fix `TELEGRAM_BOT_TOKEN` in `.env` (the user edits it) and restart the server. Never print the token.
- **Status:** fix pending (user action when it fires)

### `[mailbox-audit] inbox=<n> stored=<m> missing=0 duplicates=<k> cross=<c>` (exit 2)

- **First seen:** 2026-11-05 (S1a 48-hour test, `~/ea-logs/audit.log` on the VPS)
- **Source:** `bun run mailbox:audit` (`apps/server/src/modules/mail/tools.ts`, `auditMailbox`).
- **Cause:** "duplicates" counts stored INBOX rows whose `(Message-ID, content hash)` key is not in the IMAP INBOX now. The sync never deletes rows, so a mail that the user deletes or moves out of INBOX after the sync stored it counts as a duplicate. On 2026-11-05 both rows were real mails deleted from the mailbox (not found in any folder).
- **Fix:** Check for a real double store first: `SELECT message_id_header, content_hash, count(*) FROM emails WHERE mailbox_id = '<MB>' AND folder = 'INBOX' AND received_at >= '<since>' GROUP BY 1, 2 HAVING count(*) > 1;`. 0 rows and `missing=0` = no problem. To name the rows, compare the `fetchSince` keys with `listFolderEmailKeys` in a one-off read-only script. Since the sort-folder sync the tool also prints one `folder=<key> …` line per enabled synced folder. A `cross` count is no problem: it counts mail that has a row in another synced folder (the mail is not lost; independent review m10, `spec/features/done/2026-11/F058-sync-sort-folders/plan.md`).
- **Status:** won't fix (audit limit; expected after a delete)

### `llm_daily_cap_reached` (fields `org_id`, `mailbox_id`, `count`, `day_start`, `until`)

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, `[triage]` worker. One warning per mailbox and quota day, per process (a restart logs it again). `count` is `LLM_DAILY_CAP`; `day_start` is the start of the quota day (America/Los_Angeles) and `until` the time when the mail waits until (both ISO times).
- **Cause:** The mailbox used `LLM_DAILY_CAP` LLM call attempts (`audit_log` event `llm.call`, failed calls too) since the start of the Pacific day.
- **Fix:** No action needed. The mail goes back to `pending` and waits until the next quota day. If it fires too early, check failed `llm.call` rows (503 retries count) and read `notes/2026-11-05-gemini-free-tier-triage.md`. Change `LLM_DAILY_CAP` only with the real RPD.
- **Status:** won't fix (expected behaviour)

### `llm_paused` (fields `code`, `wait_ms`, `until`)

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/pause.ts` (`[triage]`, level `warn`). Codes: `http_429`, `http_500`, `http_502`, `http_503`, `http_504`, `timeout`, `network`. `wait_ms` is the length of the pause, `until` its end (ISO time).
- **Cause:** Google quota or overload, or no network connection to Google (code `network`: refused, reset or DNS failure). Not the mail. The LLM client of the process pauses with a backoff of 5 → 60 min, in memory.
- **Fix:** Wait. The mail goes back to `pending` with `next_attempt_at` = the pause end and no try count. A restart clears the pause. Often seen with `gemini-3.8-flash` (503) and on Flash-Lite at busy times (`notes/2026-11-05-gemini-free-tier-triage.md`).
- **Status:** workaround

### `llm_config_paused` (fields `code`, `wait_ms`, `until`)

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/pause.ts` (`[triage]`, level `error`). The line holds the code, the length of the pause and its end only. It holds no hint: the hint for each code is in the Fix line below. The pause uses the same backoff as a soft error and the mail gets no try count.
- **Cause:** A bad or missing key, no access or billing, a wrong region or project, or an unknown model name. Retrying the mail does not help. Gemini codes: `http_401`, `http_402`, `http_403`, `http_404`, `http_400_key`, `http_400_precondition`. OpenAI codes (`LLM_PROVIDER=openai`): `http_401` (bad key), `http_403` (no access or region), `http_404` (unknown model), `http_429_quota`, `http_400_schema`, `schema_not_strict`. `http_429_quota`: no money on the OpenAI account or the project budget is spent. `http_400_schema`: OpenAI rejects the strict schema, so every mail would fail. `schema_not_strict`: our own check found a schema object that breaks the strict rules (a code change).
- **Fix:** One line for each code.
  - Gemini `http_401`, `http_402`, `http_403`, `http_404`, `http_400_key`, `http_400_precondition`: check `GEMINI_API_KEY` and the Google project (billing, region). Then restart the server.
  - OpenAI `http_401`, `http_403`, `http_404`: check `OPENAI_API_KEY`, `OPENAI_BASE_URL` (`llm_settings` and `llm:check` show the endpoint kind and host) and the OpenAI project (billing, budget, model access).
  - OpenAI `http_429_quota`: add credit or raise the budget, then wait for the pause to end or restart the server. `/status` and the digest show `⏸ LLM paused … (http_429_quota)` (F100 stage 07; flag `llm_pause_line`).
  - OpenAI `http_400_schema`: run `bun run llm:check --provider openai`, check the strict schema adapter and the rejected keywords (`notes/2026-11-06-openai-api-facts.md`).
  - OpenAI `schema_not_strict`: make every property required and nullable, `additionalProperties: false`.
- **Status:** investigating (per case)

### `triage_no_settings` (fields `org_id`, `mailbox_id`; before F103: `triage <mailboxId>: no mailbox_settings row, mailbox skipped`)

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, `[triage]` worker. One warning per mailbox and process.
- **Cause:** The mailbox has no `mailbox_settings` row, so the worker has no mode, tool switches or category policy for it.
- **Fix:** Create the settings row for the mailbox (default settings). Restart to log the line again. The worker skips the mailbox until the row exists.
- **Status:** workaround

### `triage_no_organization` (fields `org_id`, `mailbox_id`)

- **First seen:** 2026-11-15 (F103 stage 11)
- **Source:** `apps/server/src/modules/triage/jobs.ts`, `[triage]` worker. One warning per mailbox and process.
- **Cause:** The organization row of the mailbox is missing, so the worker has no time zone for it.
- **Fix:** Check the `organizations` row of `org_id`. The worker skips the mailbox until the row exists. Restart to log the line again.
- **Status:** investigating (per case)

### `triage_mailbox_failed` (fields `org_id`, `mailbox_id`, `error`, `error_code`; before F103: `triage <mailboxId> failed: <Class> <code>`)

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, error handler of one mailbox. `error` is the class name and `error_code` the `code` if the error has one, never the message text.
- **Cause:** An error outside the LLM call: thread read, save, DB or a bug. It stopped this mailbox for this run.
- **Fix:** The mail in work counts one try and waits 5 minutes. At 3 tries it ends as `unsure` / `triage_error`. Later claimed mail goes back with no count. Look at the class and code, then at the DB and server logs.
- **Status:** investigating (per case)

### `triage_failed` (fields `error`, `error_code`; before F103: `triage failed: <Class> <code>`)

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, outer handler of the run (for example the mailbox list failed).
- **Cause:** An error outside the per-mailbox handler, for example in `listSyncTargets` or the DB connection.
- **Fix:** The next run tries again. If it repeats, check the DB connection and the server log.
- **Status:** investigating (per case)

### `triage_claim_lost` (fields `org_id`, `mailbox_id`, `email_id`; before F103: `triage <emailId>: lost the claim`)

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/service.ts`, `[triage]`, on save of a triaged or skipped (`too_old`) mail. Warning.
- **Cause:** The `locked_at` of the mail changed during the work: a stale take-back by a later run (claim older than 5 min), or a slow LLM call. The save did nothing.
- **Fix:** No action. The run that holds the claim triages the mail. If it repeats often, check for two servers on one DB or very slow LLM calls.
- **Status:** won't fix (expected behaviour)

### `triage_release_failed` (fields `org_id`, `mailbox_id`, `error`, `error_code`; before F103: `triage <mailboxId>: release failed: <Class> <code>`)

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, when it puts claimed mail back to `pending`.
- **Cause:** The DB update failed (connection or lock). The mail stays `processing` with its claim.
- **Fix:** The mail becomes claimable after 5 minutes (stale claim). That take-back counts one attempt. Check the DB.
- **Status:** investigating (per case)

### `triage_error_save_failed` (fields `org_id`, `mailbox_id`, `error`, `error_code`; before F103: `triage <mailboxId>: triage_error save failed: <Class> <code>`)

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, when the third hard error should save `unsure` / `triage_error`.
- **Cause:** The DB write of the `triage_error` result failed.
- **Fix:** The code releases the mail with a 5-minute wait and a count. It tries again later. Check the DB.
- **Status:** investigating (per case)

### `llm_audit_failed` (fields `org_id`, `mailbox_id`, `email_id`, `error`, `error_code`; before F103: `triage <emailId>: llm.call audit write failed: <Class> <code>`)

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/service.ts`, after a failed LLM call. Warning.
- **Cause:** The `audit_log` row for the failed call could not be written. The error rules still run, but the call is missing from the daily cap count.
- **Fix:** Check the DB. The cap may count too few calls until it works.
- **Status:** investigating (per case)

### `Failed to copyto: failed to HEAD for download: Unknown 401`

- **First seen:** 2026-11-03
- **Source:** `deploy/backup.sh` on the VPS, `rclone copyto` to the B2 bucket.
- **Cause:** the B2 key can only write. Before the upload, rclone sends a HEAD request to check the target file, and B2 refuses it.
  The apt rclone (1.53) fails earlier; the VPS uses rclone 1.75.2 at `~/bin/rclone`.
- **Fix:** `rclone copyto --no-check-dest` in `deploy/backup.sh`. Cron `PATH` starts with `/home/serwer/bin` (`notes/2026-11-03-pilot-vps.md`).
- **Status:** fixed

### `Failed to create file system for destination "b2:…": failed to authorize account … lookup api.backblazeb2.com on 127.0.0.53:53: server misbehaving`

- **First seen:** 2026-11-18 03:30:07 UTC (again 2026-11-19 03:30:07). Worked 2026-11-04 to 2026-11-17.
- **Source:** `deploy/backup.sh` on the VPS (cron), `rclone copyto` to B2, in `~/ea-logs/backup.log`. Then `slo_backup_age` after 26 hours.
- **Cause:** a DNS lookup failed in `systemd-resolved` (stub `127.0.0.53`; upstream the router `192.168.1.1`). Proved: not the cron `PATH`, not Tailscale DNS (`accept-dns` off), not a standing fault (lookups work). Not proved: why the resolver failed at 03:30 on two nights (journal not readable for `serwer`; guess: router or upstream DNS). The old script had no retry.
- **Fix:** `deploy/backup.sh` retries the B2 copy up to `BACKUP_RCLONE_TRIES` times (default 5, waits 30/60/120/240 s). It also takes a `flock` lock. Details: `notes/2026-11-19-backup-dns-failures.md`. Not active on the VPS until the next release. Until then: run `deploy/backup.sh` by hand after a failed night (last line `backup ok …`).
- **Status:** workaround (fix in the repo, not deployed). Root cause of the resolver error open: with `sudo`, read `journalctl -u systemd-resolved` for 03:25 to 03:40 UTC.

### `Failed to create file system for "b2:…": Unknown 401 (401 unauthorized)` (also `error listing: Unknown 401`)

- **First seen:** 2026-11-19 ~18:22 UTC (two `deploy/backup.sh` runs at the same time).
- **Source:** `rclone` on the VPS.
- **Cause:** the B2 key is write-only, so any listing or HEAD gives 401. The apt `rclone` 1.53 (`/usr/bin/rclone`, first in `PATH` of a plain `ssh home_vm 'cmd'`) gives 401 even for the commands that work with `~/bin/rclone` 1.75.2. Concurrency is not the cause: one call alone gives 401 (tested). Which command gave the 401 at 18:22 is not proved (guess: a run without `~/bin` in `PATH`).
- **Fix:** run `backup.sh` with `PATH=$HOME/bin:$PATH` (cron and `deploy/release.sh` already do). Do not list the bucket with the write-only key. The new lock stops two runs at the same time (they collided on the `.part` file and `status.json.tmp`).
- **Status:** workaround

### `sync_failed` with `error_code=22P02` (before F103: `sync <mailbox id> failed: invalid input syntax for type bigint: "NaN"`)

- **First seen:** 2026-11-03
- **Source:** `[mail]` sync job, first sync of the Interia mailbox.
- **Cause:** Interia sends no `UIDNEXT` in the SELECT reply. The old `inboxStatus()` returned `NaN`, and the cursor update failed in Postgres. (Later finding, 2026-11-08: STATUS gives `UIDNEXT 1` for every folder, which is wrong too.)
- **Fix:** the status call (`folderStatus()` in `apps/server/src/modules/mail/imap/client.ts`; the sort-folder sync removed `inboxStatus`, `searchInboxSince` and `fetchByUids`) asks `STATUS (UIDNEXT)`, then uses the highest UID + 1, then 1. With STATUS at 1, the fix is D4 of `spec/features/done/2026-11/F058-sync-sort-folders/plan.md` (cursor from the highest UID + 1, per folder).
  A missing `UIDVALIDITY` now gives `IMAP INBOX gave no valid UIDVALIDITY`.
- **Status:** fixed

### `This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.`

- **First seen:** 2026-11-02
- **Source:** Gemini API, `bun run llm:check --provider gemini` (model `gemini-3.8-flash`, free tier). HTTP 503, status `UNAVAILABLE`.
- **Cause:** Google-side overload of the model. Not a key or config error (the key was accepted). One call hung for more than 90 s before the error.
- **Fix:** retry later. In the app: `platform/llm.ts` treats 503 as a soft error (wait with backoff, no count toward the 3 tries) and uses a 30 s timeout (ADR 0012). Optional fallback model in config.
- **Status:** workaround
- **Update 2026-11-05:** the script is now `apps/server/src/scripts/llm-check.ts`. Run `bun run llm:check --provider gemini` from the repo root. It prints `Request failed: LlmSoftError http_503` (no raw body). In the worker, a 503 pauses the LLM client 5 → 60 min (`docs/capabilities/triage.md` § Rules).
