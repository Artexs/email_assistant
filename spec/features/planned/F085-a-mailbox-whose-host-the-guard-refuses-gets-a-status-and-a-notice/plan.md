# F085 · A mailbox whose host the guard refuses gets a status and a notice — plan

> **Status 2026-11-14 — planned.** Plan base: 8720bb0. 7 stages; nothing built yet. Builds after F088 (in `spec/features/done/`). Stage 02 is the only migration.

Ticket: [ticket.md](ticket.md). Defaults for the owner: [questions.md](questions.md). Workers read `ticket.md`, this file and their one stage file. A gap or a deviation is a question in the final message, not a choice: the coordinator decides from § Input or asks the owner.

## Input

Owner and coordinator words, word for word:

- Ticket outcome: "When the mail host guard (F082 stage 8) refuses the host of a mailbox, the mailbox gets a clear status and the owner gets one notice. Today the refusal is only a `sync <id> failed: host not allowed` log line on every run, so nobody sees it. The status shows in the panel and in `mailbox:check`, and the notice follows the same one-per-episode rule as the other mailbox notices."
- Ticket acceptance: "A mailbox whose host the guard refuses at sync or send time gets a status that the panel and `mailbox:check` show." "The owner gets one Telegram notice per episode, with no host name or address in the text." "A test with a fake resolver that returns a local address covers the status and the notice."
- Ticket out of scope: "Changes to the guard rules or its address ranges." "The connect form: it already refuses such a host with an answer."
- F082 cold review, finding 5: "A blocked host shows only as `sync <id> failed: host not allowed` (`jobs.ts:85`). There is no notice or status change."
- Coordinator instruction (2026-11-14): "F088 landed (detector registry, outbox migration): use it; at most one migration. Texts follow the F098 registry (en and pl)." "Master moved a lot (F091, F100 stage 05/06 touch sync, F098 texts, F099 flags): check every path and name against HEAD."

### Product decisions (from the ticket)

- **P1 Status.** A refused host gives the mailbox a status that the panel and `mailbox:check` show (D1, D13, D14).
- **P2 Notice.** Linked owners get one Telegram notice per episode. The text holds no host name and no resolved address (D7, D8).
- **P3 Proof.** A test with a fake resolver that returns a local address covers the status and the notice (D19, stage 05).

### Design decisions of this planning job (2026-11-14)

"Default" marks a choice the owner may still change; [questions.md](questions.md) lists it. None changes the stage list.

- **D1 A new mailbox status `host_blocked`.** `mailboxes.status` gains `host_blocked` next to `active`, `paused`, `auth_error`. `listSyncTargets` lists `active` mailboxes only, so the sync, triage, committer, returned and chaser jobs skip a blocked mailbox, as they skip `auth_error`. Reason: the ticket asks for a status, and `auth_error` is the existing shape of "the system cannot use this mailbox" (status, `status_changed_at` episode, notice, way out). Rejected: a column `host_blocked_at` next to `active` (sync would keep trying, the sync-late notice would come as a second notice after 30 min, and every reader of `active` would have to read the column too). Default (Q1).
- **D2 One status list.** `mailboxStatuses` in `packages/core/src/web/mailboxes.ts` becomes `["active", "paused", "auth_error", "host_blocked"]`. The server type `MailboxStatus` and `mailboxStatusSchema` (`apps/server/src/modules/mail/repo/mailboxes.ts:121-122`) derive from it (`(typeof mailboxStatuses)[number]`, `z.enum(mailboxStatuses)`). An integration test compares the CHECK list of `mailboxes.status` with `mailboxStatuses` (stage 02), as `telegram-schema.test.ts` does for `outbox.kind`.
- **D3 The way in.** Only a `HostNotAllowedError` (`apps/server/src/modules/mail/port.ts:220`, thrown by `resolveMailHost`) while a background job opens the mailbox sets the status:
  - the sync job (`apps/server/src/modules/mail/jobs.ts`, the `catch` of `run()`): the IMAP host;
  - the committer (`apps/server/src/modules/actions/committer.ts`, `openFor`): the IMAP host, and the SMTP host when the batch has an approved send. This is the "send time" of the ticket: `openSmtpSender` resolves the host when the committer opens it (`mail/imap/smtp.ts:70`), before any send.

  One function `markHostBlocked(db, ctx, mailboxId, { now, source: "sync" | "committer" })` in a new file `apps/server/src/modules/mail/host-status.ts`: one transaction with a conditional update `active → host_blocked` (`status_changed_at = now`) and, only when the row changed, the audit row `mailbox.host_blocked` (actor `system`, data `{ mailbox_id, source }`). It never throws: it logs (D16). A `paused` or `auth_error` mailbox does not change: a user's pause wins; after a resume the next sync meets the guard again. Not a way in: a DNS lookup failure (a `SoftError`: it passes, the next tick tries again, as today), the CLI tools (`mailbox:check`, `mailbox:audit`, `mailbox:seed`, `mailbox:signals`, `mailbox:backfill` print the error), the connect form and the password check (they answer `host_not_allowed`). Rejected: the unconditional `setMailboxStatus` that `auth_error` uses (a refusal must not end a pause).
- **D4 An SMTP refusal blocks the whole mailbox (default, Q5).** Reading stops too. Reason: one status and one way out; a mailbox whose server name points into a private network is a setup or security problem, not a send problem. Rejected: a send-only hold (a second state that every send reader must know).
- **D5 The way out: an automatic re-check, and the password change.**
  - At the start of each `mail.sync` run, `recheckBlockedHosts(deps)` (in `host-status.ts`) lists the `host_blocked` mailboxes of organizations that are not `suspended` (`listMailboxTargets(db, { statuses: ["host_blocked"], includeSuspended: false })`), reads each row (`getMailbox`) and runs `checkMailboxHosts(mailbox)`: the guard on `imap_host` and on `smtp_host`, with no connection and no password. When both are `allowed`: one transaction with a conditional update `host_blocked → active` (`status_changed_at = now`) and the audit row `mailbox.host_allowed` (actor `system`, data `{ mailbox_id }`). The run reads its target list after the re-check, so it syncs the mailbox at once. `refused`: no change, no log line. `lookup_failed`: no change, one `warn` line.
  - `updateMailboxPassword` (`mail/connect.ts:262`, web `POST /api/mailboxes/:id/password` and `mailbox:password`) makes a `host_blocked` mailbox `active`, as it does for `auth_error`: its IMAP and SMTP login test went through the guard. A refused host makes that call fail with `HostNotAllowedError` (web `400 host_not_allowed`) and changes nothing.
  - The sync detector gives a mailbox 30 min of grace after `status_changed_at` (`channels/notices/sync.ts`), so the reactivation gives no false "sync is late" notice.
  - No "works again" notice: the owner sees the state in `/status`, the digest and the panel (default, Q2). Rejected: an owner-only way out (the owner cannot change a host: there is no host edit).
- **D6 Re-check cadence and flaps (default, Q9).** The re-check runs at every sync run (every 5 min today; F100 stage 07 may make it 2 min). There is no flap guard: each new episode gives a new notice. Reason: a public provider never resolves into the refused ranges, so a flap is a DNS problem that the owner should see. The texts name no interval ("at each sync").
- **D7 The notice kind `host_blocked`** (the checklist `docs/code-patterns.md` § Add a notice kind; the template is `send_held`, F099 stage 05):
  - Receivers: the linked owners (`run.owners`), as `auth_error`.
  - Dedup key `host_blocked:<mailbox id>:<status_changed_at ms>`: one notice per episode.
  - A `pending` row becomes `failed` / `outdated` when the mailbox leaves `host_blocked`, and an older episode's pending row when a newer one starts (`cancelPendingOutbox`, `channels/repo.ts:457`, its `kind` union gains `host_blocked`).
  - Detector `apps/server/src/modules/channels/notices/host-blocked.ts` (`hostBlockedDetector`, name `host-blocked`, kinds `["host_blocked"]`), listed in `detectors` right after `authErrorDetector`.
  - View (strict): `{ address, since, now, timeZone }`. No mailbox id (the text does not print it).
  - Outbox CHECK: `host_blocked` in `outbox_kind_check`, and `outbox_host_blocked_mailbox_check CHECK (kind <> 'host_blocked' OR mailbox_id IS NOT NULL)`.
  - The quiet hours hold it, as every notice except the digest (sender rule).
- **D8 No host name and no address (default, Q3).** The notice names the mailbox by its own mail address, as `auth_error`, `sync_stale` and `send_held` do. No text, log line, audit row, error text, CLI line or panel text of this ticket prints a host name, a resolved address, a port or which side (IMAP or SMTP) was refused. The guard's error message is `host not allowed` and holds none of them (`host-guard.ts:40-44`). Tests assert that the rendered text does not contain the host names `imap.x.test` and `smtp.x.test` or the address `10.0.0.7`.
- **D9 The texts (en and pl).** Exact strings (Polish follows the F098 glossary and register: informal, no case ending on an address, `skrzynka`, `synchronizacja`, `komunikat`):

  | Where (key) | en | pl |
  | --- | --- | --- |
  | `notices.hostBlocked.first(address, since)` | `⛔ The system stopped connecting to the mail server of ${address} at ${since}.` | `⛔ System przestał łączyć się z serwerem poczty skrzynki: ${address}. Od: ${since}.` |
  | `notices.hostBlocked.why` | `The server name points to a private or local network address, and the system never connects there.` | `Nazwa serwera wskazuje adres w sieci prywatnej lub lokalnej, a system nigdy się z takim nie łączy.` |
  | `notices.hostBlocked.noRead` | `The system does not read or send mail of this mailbox now. No mail is lost: it stays on the mail server.` | `System nie czyta teraz tej skrzynki i nie wysyła z niej poczty. Żadna wiadomość nie ginie: zostaje na serwerze poczty.` |
  | `notices.hostBlocked.recheck` | `The system checks the server again at each sync and starts the mailbox again by itself. /status shows the state.` | `System sprawdza serwer przy każdej synchronizacji i sam wznowi skrzynkę. /status pokazuje stan.` |
  | `digest.mailbox.hostBlocked(since, last)` | `⛔ Mail server not allowed since ${since} · last sync ${last}` | `⛔ Serwer poczty niedozwolony od ${since} · ostatnia synchronizacja: ${last}` |
  | `bot.status.stateHostBlocked(since)` | `mail server not allowed since ${since} (checked again at each sync)` | `serwer poczty niedozwolony od ${since} (sprawdzany przy każdej synchronizacji)` |
  | `bot.status.approvedHostBlocked(count)` | `${count} approved, held: the mail server is not allowed` | `zatwierdzono ${count}, wysyłka czeka, bo serwer poczty jest niedozwolony` |
  | `bot.switch.hostBlocked(address)` | `⛔ ${address}: its mail server is not allowed; the system checks it again at each sync.` | `⛔ ${address}: serwer poczty jest niedozwolony; system sprawdza go przy każdej synchronizacji.` |
  | `bot.taps.approvedHostBlocked` | `Approved. The mail server of this mailbox is not allowed, so the send waits; /status shows it.` | `Zatwierdzono. Serwer poczty tej skrzynki jest niedozwolony, więc wysyłka czeka; /status pokazuje stan.` |
  | `bot.taps.sendAgainHeld.host_blocked` | `A new send was approved. The mail server is not allowed, so the send waits; /status shows it.` | `Zatwierdzono nową wysyłkę. Serwer poczty jest niedozwolony, więc wysyłka czeka; /status pokazuje stan.` |
  | `bot.taps.heldNotes.host_blocked` | `The mail server is not allowed, so the sends wait` | `Serwer poczty jest niedozwolony, więc wysyłki czekają` |
  | `approvals.held.host_blocked` | `The mail server is not allowed, so the send waits` | `Serwer poczty jest niedozwolony, więc wysyłanie czeka` |
  | panel `status_host_blocked` | `Server not allowed` | `Serwer niedozwolony` |
  | panel `mb_host_blocked_hint` | `The mail server name points to a private or local network address, so the system does not connect. It checks again at each sync and starts the mailbox by itself.` | `Nazwa serwera poczty wskazuje adres w sieci prywatnej lub lokalnej, więc system się nie łączy. Sprawdza ją przy każdej synchronizacji i sam wznowi skrzynkę.` |
  | panel `op_col_mailboxes` (changed) | `Mailboxes (all / login error / server not allowed)` | `Skrzynki (wszystkie / błąd logowania / serwer niedozwolony)` |

  Before stage 01 the worker reads the `pl` entries next to each key: when the file already uses another word for the same idea (for example for "sends wait"), use that word and say so in the final message. The other `pl` texts of the ticket follow the same rule.
- **D10 Exhaustive readers.** Each reader of the mailbox status that this ticket touches becomes an exhaustive `switch` with no `default`, or a `Record<MailboxStatus, …>` (`docs/code-patterns.md` § Size and shape), so a later status fails typecheck where it is missed: `StatusBadge` (already a `Record`), the digest mailbox line (`packages/core/src/digest/digest.ts` `mailboxLine`), `statusText`, `approvedText` and the skip in `switchMailboxes` (`channels/commands.ts`), `heldReason` (`channels/callbacks.ts`), the result of `switchMailboxStatus` (`mail/status.ts`).
- **D11 Pause and resume of a blocked mailbox are refused (default, Q10),** as for `auth_error`. `SwitchResult` gains `{ kind: "host_blocked" }` (`mail/status.ts:14`); the web route answers `409 wrong_status` (`mail/routes.ts:78`); Telegram `/pause` and `/resume` skip it with `bot.switch.hostBlocked(address)`. The panel shows no pause or resume button for it. Removal works: `removeMailbox` pauses only an `active` mailbox and deletes the others as they are (`mail/remove.ts:42`).
- **D12 Held sends say why, and still expire.** An approved send of a blocked mailbox waits: the committer skips the mailbox. A core type `HeldBy = "scope" | "paused" | "auth_error" | "host_blocked"` (exported from `packages/core/src/digest/approvals.ts`, used by `approvalEdit` and by `channels/callbacks.ts`) carries the cause to the tap answer, the set answer, the "send again" answer and the card edit line; `/status` says it in the approvals line. The approval expiry also lists `host_blocked` mailboxes (`actions/expiry.ts:196`), so `held_timeout` (48 h after the tap) still ends a held send. Reason: without it the tap answer promises "Sending within a minute", and the send never expires.
- **D13 Panel and operator.** `StatusBadge` gets `host_blocked` (variant `destructive`, text `status_host_blocked`); `MailboxCard` shows the owner hint `mb_host_blocked_hint` and no pause, resume or password button for it (the "More" menu keeps "Change password" and "Remove"). The operator org list gets a count `mailboxes.hostBlocked` (`packages/core/src/web/operator.ts:38`, `operator/service.ts:76`, `OrgTable.tsx` cell `total / authError / hostBlocked`); the org detail already uses `StatusBadge`. `org:status` prints `host_blocked=N` (`scripts/org-status-lines.ts:44`). No banner: the auth-error banner stays as it is (default, Q6).
- **D14 `mailbox:check`.** A new service `inspectMailbox(deps, ctx, mailboxId, opts)` in `mail/check.ts` returns `{ status, statusChangedAt, hosts: { imap, smtp }, report }`. It reads the row, runs `checkMailboxHosts` first, and calls the existing `checkMailbox` only when both hosts are `allowed` (else `report: null`, no connection). The script `apps/server/src/scripts/mailbox-check.ts` prints `status: <status> since <ISO time>`, `imap-host: allowed|refused|lookup_failed`, `smtp-host: …`, then the report lines. A `refused` host prints `the host guard refuses a mail server of this mailbox: no connection` and exits 2; a `lookup_failed` host prints `mail host lookup failed: no connection` and exits 1. It changes no status (read-only, as today without `--probe`). The script calls the service, not a repository (ADR 0023).
- **D15 No feature flag (rule exception, default, Q4).** The styleguide puts each new user-visible behaviour behind a flag. This ticket fixes an error path that exists today (a refused host fails every sync run with no sign); the mailbox notices `auth_error` and `send_held` ship without a flag; a flag would keep the silent failure for every organization without it. The rollback is the code rollback of D17.
- **D16 Log lines** (event form, `docs/code-patterns.md` § Logs; field names already in `platform/log-fields.ts`):

  | Event | Level | Fields | When |
  | --- | --- | --- | --- |
  | `mailbox_host_blocked` | warn | `mailbox_id`, `reason` (`sync` / `committer`) | `markHostBlocked` changed the row |
  | `mailbox_host_refused` | info | `mailbox_id`, `status` | the guard refused, the row was not `active` |
  | `mailbox_host_block_failed` | error | `mailbox_id`, `...errorFields(error)` | the transaction of `markHostBlocked` failed |
  | `mailbox_host_allowed` | info | `mailbox_id` | the re-check made the row `active` |
  | `mailbox_host_check_failed` | warn | `mailbox_id`, `...errorFields(error)` | a lookup failed in the re-check, or a per-mailbox error |
  | `mailbox_host_recheck_failed` | error | `...errorFields(error)` | the re-check list failed (the sync run goes on) |

  The old line `sync <id> failed: host not allowed` goes away: a blocked mailbox is not a sync target. Use `log.with({ mailbox_id })` only if the file already does; else pass `mailbox_id` in the call.
- **D17 Roll back the code, not the migration.** A release older than stage 02 cannot parse `host_blocked` (`mailboxStatusSchema` throws in `listMailboxes`; `noticeKindSchema` throws in `claimDueOutbox`, `channels/repo.ts:368`, and stops the sender). Before such a rollback run, in this order:
  `UPDATE outbox SET status = 'failed', error_code = 'outdated', locked_at = NULL WHERE kind = 'host_blocked' AND status IN ('pending', 'sending');`
  `UPDATE mailboxes SET status = 'active', status_changed_at = now() WHERE status = 'host_blocked';`
  The old code then logs the refusal at each run again. The migration's `down` part does the same before it restores the old CHECK lists. Stage 07 writes this into `deploy/README.md`.
- **D18 Order: read before write, the way out before the way in.** Stage 01 teaches core and the panel the value; stage 02 lets the DB hold it and adds the notice; stage 03 teaches the server readers; stage 04 adds the way out; stage 05 adds the way in. At every landed commit, no reader meets a value it does not know, and no mailbox can enter `host_blocked` without a way out. Until stage 05, no row is ever `host_blocked` outside tests.
- **D19 Tests never open a network connection.** The test preload allows local hosts for GreenMail. A test that needs the guard sets `configureMailHosts({ allowLocal: false, lookup })` with a fake `lookup` and puts back `configureMailHosts({ allowLocal: true })` in `afterEach` (as `apps/server/test/integration/mail-host-guard.test.ts` does). A test that runs the sync job or the committer through the guard uses a guarded fake opener: for its own mailbox it calls `resolveMailHost(opts.host)` and then returns the fake provider or sender; it never calls the real IMAP or SMTP client with a public address. Refused address `10.0.0.7`; public address `93.184.216.34`. Fixture hosts: `imap.x.test`, `smtp.x.test` (`fixtures.ts` `createOrgWithMailbox`).
- **D20 Audit events.** `auditEvents` (`apps/server/src/modules/audit/repo.ts`) gains `mailboxHostBlocked: "mailbox.host_blocked"` (data `mailbox_id`, `source`) and `mailboxHostAllowed: "mailbox.host_allowed"` (data `mailbox_id`). They are not in `securityEvents` (default, Q8). `delete_mailbox` deletes them with the mailbox (it deletes audit rows by `data->>'mailbox_id'`).
- **D21 No operator notice (default, Q7).** The operator sees the count in the console and in `org:status`. Rejected: a `host_blocked` twin of `auth_error_24h` (not asked; one more hourly scan).

### States and events

| Status now | Event | Result | Test |
| --- | --- | --- | --- |
| `active` | sync: guard refuses the IMAP host | `host_blocked`, audit row, notice to owners | 05: 5.1 tests 1–2 |
| `active` | committer: guard refuses the IMAP or SMTP host | `host_blocked`; the batch is released with no attempt counted | 05: 5.1 tests 3–4 |
| `active` | lookup fails (`SoftError`) | stays `active`; `warn`; the next tick tries again | 05: 5.1 test 5 |
| `paused` / `auth_error` | `markHostBlocked` called (a race) | no change; `mailbox_host_refused` | 05: 5.1 test 6 |
| `host_blocked` | re-check: both hosts allowed | `active`, audit row, synced in the same run; a pending notice becomes `outdated` | 04: 4.1 tests 2, 6; 05: 5.2 |
| `host_blocked` | re-check: a host refused | no change, no line | 04: 4.1 test 3 |
| `host_blocked` | re-check: lookup fails | no change, one `warn` | 04: 4.1 test 4 |
| `host_blocked` | organization `suspended` | no re-check, no notice sent until the resume | 04: 4.1 test 5 |
| `host_blocked` | password change, guard passes | `active`, `reactivated: true` | 04: 4.2 test 1 |
| `host_blocked` | password change, guard refuses | `HostNotAllowedError`, no change | 04: 4.2 test 2 |
| `host_blocked` | pause or resume (web, Telegram) | refused: `409 wrong_status`, Telegram skip text | 03: 3.1 |
| `host_blocked` | remove | removed, as `auth_error` | 03: 3.1 test 4 |
| `host_blocked` | an owner approves a send | the send waits; answer `approvedHostBlocked` | 03: 3.2 |
| `host_blocked` | 48 h after an approval | the expiry ends the send (`held_timeout`) | 03: 3.1 test 5 |
| `active` again | the guard refuses again | a new episode: a new notice; the old pending one is `outdated` | 02: 2.1 test 6 |

Crash and repeat: the status change and its audit row share one transaction (`markHostBlocked`, the re-check). The notice has no source mark: the detector finds the status again at the next tick and the dedup key stops a second row. The committer releases the batch before it marks the mailbox; a crash between them leaves an `active` mailbox, and the next tick meets the guard again. Two runs at once (sync and committer): the conditional `WHERE status = 'active'` lets one of them change the row and write the audit row. Tenants: every new repository call takes a `TenantContext`; the only cross-tenant read is the existing `listMailboxTargets`.

## Facts checked (2026-11-14, at 8720bb0)

- The guard: `resolveMailHost` (`apps/server/src/modules/mail/host-guard.ts:45`) throws `HostNotAllowedError` (a `HardError`, message `host not allowed`, `mail/port.ts:220-225`) for a local name or literal and when any resolved address is local; a lookup error is a `SoftError` `mail host lookup failed (<code>)`. With `allowLocal: true` it returns `{ host }` with no check. `configureMailHosts` sets the process policy; `mailHostPolicy()` reads it.
- `openImapProvider` calls the guard (`mail/imap/client.ts:130`); `openSmtpSender` and `verifySmtpLogin` call it through `smtpConnectOptions` (`mail/imap/smtp.ts:70`). `openMailboxProvider` (`mail/open.ts`) opens IMAP, then (with `withSender`) SMTP, through the injected `deps.openProvider` and `deps.openSender`.
- The sync job (`mail/jobs.ts:78-102`): `MailAuthError` → `setMailboxStatus(..., "auth_error")`; `SoftError` or `CursorMovedError` → `warn`; anything else → `log.error(\`sync ${mailboxId} failed:\`, message)` (old-form line; the F100 flag refresh in the same file already uses event lines). A `HostNotAllowedError` lands in the last branch today.
- The committer `openFor` (`actions/committer.ts:189-208`): releases the batch, then `MailAuthError` → `auth_error`, `SoftError` → `warn`, else `log.error`. The file has 399 lines.
- `listSyncTargets` = `listMailboxTargets({ statuses: ["active"], includeSuspended: false })` (`mail/repo/targets.ts`); it gates sync, triage, committer, returned and chaser. The expiry lists `["active", "paused", "auth_error"]` with `includeSuspended: true` (`actions/expiry.ts:196`).
- `mailboxes.status` CHECK: `CHECK (status IN ('active', 'auth_error', 'paused'))`, inline in `db/migrations/20261103100001_mail.sql:11` (no explicit name). `MailboxStatus` and `mailboxStatusSchema` (`mail/repo/mailboxes.ts:121-122`) list the same three; `listMailboxes` and `getMailboxSummary` parse with the schema. `changeMailboxStatus` takes `from`/`to` of `"active" | "paused"`.
- `outbox_kind_check` holds 12 kinds; the newest file that sets it is `db/migrations/20261114100003_outbox_send_held.sql` (it also adds `outbox_send_held_mailbox_check`). `outbox.mailbox_id` references `mailboxes` `ON DELETE CASCADE` (`20261106000001_telegram.sql`). The newest migration file at the plan base is `20261114130001_two_factor.sql`.
- `noticeKinds` (`packages/core/src/notices/kinds.ts`), `noticeViewSchemas` (`views.ts`, `authErrorView` at line 102), `noticeRenderers` (`renderers.ts`, `auth_error` at line 78), `renderAuthErrorNotice` (`packages/core/src/digest/notices.ts:53`), the texts `noticeTexts` (`packages/core/src/texts/notices.ts`, interface `NoticeTexts`). `apps/server/src/modules/channels/notices/registry.test.ts` and `apps/server/test/integration/telegram-schema.test.ts:396` ("the CHECK lists match the lists of core") fail until kind, renderer, detector and CHECK agree.
- `authErrorDetector` (`channels/notices/auth-error.ts`) is the template: per mailbox, cancel when not in the status, else queue for each owner with key `auth_error:<id>:<status_changed_at ms>`, `warnSkipped` on a failed queue, cancel older pending rows with `exceptDedupKey`.
- Texts registry (F098 stages 06–11, in `master`): `packages/core/src/texts/bot.ts` (`BotTexts`: `status.stateAuthError`, `status.approvedAuthError`, `switch.loginError`, `taps.approvedAuthError`, `taps.sendAgainHeld`, `taps.heldNotes`), `texts/approvals.ts` (`held: { scope, paused, auth_error }`, line 77), `texts/digest.ts` (`mailbox.authError`). `textsFor` returns English for every locale until F098 stage 12 sets `POLISH_MESSAGES_ON` (`packages/core/src/texts/index.ts:75`). Core unit tests read `textTables.pl` directly.
- Readers that branch on the status: `channels/commands.ts` (`approvedText` line 125, `statusText` line 171, `switchMailboxes` line 229), `channels/callbacks.ts` (`heldAnswers`, `heldReason`, `heldReasonOfAny`, lines 345-380; file 377 lines), `packages/core/src/digest/digest.ts` (`DigestMailbox.status` line 20, `mailboxLine`), `packages/core/src/digest/approvals.ts:378` (`heldBy`), `mail/status.ts` (`SwitchResult`, line 42), `mail/routes.ts:78`, `mail/connect.ts:262`, `operator/service.ts:76`, `scripts/org-status-lines.ts:44`, `apps/server/src/web.ts` (`countMailboxes`: the banner count, unchanged), `actions/undo.ts:43` (`=== "active"`, unchanged).
- Panel: `apps/web/src/components/mailboxes/StatusBadge.tsx` (`Record<MailboxView["status"], TextKey>`), `MailboxCard.tsx` (hint and buttons per status), `components/operator/OrgTable.tsx` (`op_col_mailboxes`), `OrgDetail.tsx` (uses `StatusBadge`); texts `apps/web/src/i18n/en.ts` and `pl.ts` (`status_auth_error`, `mb_auth_error_hint`, `op_col_mailboxes`); `i18n.test.ts` checks the key sets and placeholders.
- `mailbox:check` (`scripts/mailbox-check.ts`) calls `checkMailbox` (`mail/check.ts`) and prints `capabilities:`, `folder …`, `search-header:`, `smtp-saves-sent:`; it prints no status today. Its integration test `apps/server/test/integration/mail-check.test.ts` runs the script as a subprocess with `MAIL_ALLOW_LOCAL_HOSTS: "true"`.
- Audit: `auditEvents` in `apps/server/src/modules/audit/repo.ts`; `security-events.test.ts` checks only that `securityEvents` codes are audit events.
- Log fields: `mailbox_id`, `reason`, `status`, `error`, `error_code` are in `logFieldNames` (`platform/log-fields.ts`); `errorFields(error)` gives `{ error, error_code? }`.
- Test fixtures: `createOrgWithMailbox` (hosts `imap.x.test` / `smtp.x.test`), `linkChat`, `addMember`, `isolateChannels` (`apps/server/test/integration/fixtures.ts`); `channels-notices.test.ts` has `org`, `run`, `setStatus`, `rows` helpers and the `auth_error notices` describe (line 264); `mail-jobs.test.ts` has `addBox`, `openers`, `jobFor`, `mailboxRow`.

## Not verified

- The name of the inline CHECK on `mailboxes.status` (Postgres names it `<table>_<column>_check`, so `mailboxes_status_check`). Stage 02 reads `pg_constraint` on the job DB before it writes the migration and uses the real name.
- That `bun run db:types` changes nothing (`status` and `kind` are `string` in the generated types). Stage 02 runs it and commits any change.
- The exact `pl` words of the F098 glossary for "sends wait" and "server". Stage 01 checks them against the neighbouring entries (D9).
- That F100 stage 07 (`MAIL_SYNC_EVERY_MIN`) does not move the sync job's `run()` before stage 04. Stage 04 reads the file at its start; the re-check call goes at the start of `run()` in any shape.

## Done when

1. A sync run with a fake resolver that answers `10.0.0.7` for the IMAP host sets `host_blocked` (`status_changed_at` = the run time), writes one audit row `mailbox.host_blocked` with `source: "sync"`, logs `mailbox_host_blocked`, and the next mailbox still syncs (stage 05, step 5.1).
2. A committer run whose SMTP host the fake resolver refuses sets `host_blocked` with `source: "committer"` and releases the batch with no attempt counted (stage 05, step 5.1).
3. One `host_blocked` outbox row per linked owner per episode, none for an assistant; a second run adds no row; the rendered text holds the mailbox address and none of `imap.x.test`, `smtp.x.test`, `10.0.0.7` (stages 02 and 05).
4. The re-check makes the mailbox `active` when both hosts pass, writes `mailbox.host_allowed`, syncs it in the same run, and the pending notice becomes `failed` / `outdated` (stages 04 and 05).
5. The panel shows the badge "Server not allowed" and the owner hint; the operator list counts the mailbox; `/status`, the digest, the tap answers and `org:status` name the state (stages 01 and 03).
6. `mailbox:check` prints `status: host_blocked since …` and the host lines, and with a refused host exits 2 without a connection (stage 06).
7. The CHECK lists of `mailboxes.status` and `outbox.kind` equal `mailboxStatuses` and `noticeKinds` (stage 02 tests).
8. `docs/capabilities/sync.md`, `digest-and-notices.md`, `drafts-and-send.md`, `actions-and-undo.md`, `web-panel.md`, `docs/architecture.md` §5 and the guard line of §7, `docs/modules.md`, `docs/known-alerts.md` and `deploy/README.md` describe the status, the notice, the way out and the rollback (stage 07).
9. The Proof passes after each stage.

## Rules for every stage

- Read `ticket.md`, this file and your one stage file. Build only your stage. A gap or a deviation is a question in your final message, not a choice.
- Never print, log, store or test-name a host name, a resolved address or a port (D8). Ids, codes and counts only in log lines and audit data.
- New log lines are events (D16, `docs/code-patterns.md` § Logs). Do not convert other old-form lines of a file you touch.
- No test opens a network connection (D19). A test that changes the mail host policy puts back `configureMailHosts({ allowLocal: true })` in `afterEach`.
- Readers of the mailbox status that you touch are exhaustive (D10): `switch` with no `default`, or a `Record`.
- A new or changed `pl` text follows the F098 glossary and register (informal, short, no case ending on an address); D9 holds the exact strings. Do not change any other text.
- Imports across modules go through the module `index.ts` (`../mail`, never `../mail/host-status`); `bun run lint` enforces it. Run `bun run graph:modules` after a stage that adds an import between two modules; this ticket adds none (the committer already imports `../mail`), so `git status --short docs/diagrams` stays empty.
- Comments state the rule in one sentence; no bare codes (`D5`, `F085`) in comments. A comment that needs a source names `spec/features/<lane>/F085-a-mailbox-whose-host-the-guard-refuses-gets-a-status-and-a-notice/` or an ADR.
- Format only the files of your stage (`bunx prettier --write <files>`). Never `bun run format` or `prettier --write .`.
- No temporary files inside the worktree (`bun run lint` lints every `.ts` file): use `/tmp/f085-sNN/`.
- Only stage 02 adds a migration. No stage changes `bun.lock` or adds a dependency.
- Before each commit: `git diff --staged`; look for bugs, secrets, debug code and changes outside the stage. Commit with explicit paths.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message list as proven only what a saved log shows. `NN` = the stage number.

```
mkdir -p /tmp/f085-sNN && bun run lint > /tmp/f085-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f085-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f085-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f085-sNN/int.log 2>&1 && echo PROOF_OK
```

While it works, a worker runs only the tests of the code it changed; the full chain runs once, as the proof. If `/tmp` is out of inodes (`df -i /tmp`), remove `/tmp/node-compile-cache` (`notes/2026-11-14-handoff-after-compaction.md`).

## Owner checkpoints and owner steps

None. The defaults marked "default" are in [questions.md](questions.md) and do not stop the build.

- Coordinator step C1, after stage 02 lands: `bun run db:migrate` on the shared dev DB (main checkout, no `test:int` running there).
- Deploy: the normal deploy after stage 05 or later (the coordinator; VPS steps are pre-approved). Run the migration before the new code starts. The rollback rule is D17.

## Review

- A review job before the land (board reviewer: `spec/build.md` § TRACK, Sonnet 5.5, thinking high; the reviewer may run `bun run test:int:ci` at the candidate commit): stage 02 `[risky]` (migration, notice to people), stage 04 `[risky]` (a status change by a background job, the way out), stage 05 `[risky]` (the way in in sync and committer, the end-to-end proof).
- Stages 01, 03, 06 and 07 land on the worker's proof. The review of stage 02 also reads the `pl` texts of stage 01 against D9.

## Stages

| # | Stage | Risk | File |
| --- | --- | --- | --- |
| 01 | Core and panel know `host_blocked`: status list, digest line, held cause, texts (en, pl), notice renderer, badge and hint | normal | [stages/stage-01-core-and-panel.md](stages/stage-01-core-and-panel.md) |
| 02 | Migration (both CHECKs), server status type, the notice kind and its detector | `[risky]` | [stages/stage-02-migration-and-notice.md](stages/stage-02-migration-and-notice.md) |
| 03 | Server readers: pause and resume, expiry, `/status`, taps, operator count, `org:status` | normal | [stages/stage-03-server-readers.md](stages/stage-03-server-readers.md) |
| 04 | The way out: `checkMailboxHosts`, the re-check in the sync run, the password change | `[risky]` | [stages/stage-04-way-out.md](stages/stage-04-way-out.md) |
| 05 | The way in: `markHostBlocked` in the sync job and the committer; the fake-resolver end-to-end test | `[risky]` | [stages/stage-05-way-in.md](stages/stage-05-way-in.md) |
| 06 | `mailbox:check` prints the status and the host check | normal | [stages/stage-06-mailbox-check.md](stages/stage-06-mailbox-check.md) |
| 07 | Docs, known alert, deploy and rollback note | normal | [stages/stage-07-docs.md](stages/stage-07-docs.md) |

Order: 01 → 02 → 03 → 04 → 05 → 07. 02 needs the core lists and the renderer of 01; 03 needs the DB value of 02 for its tests; 04 needs 02 (status in the DB) and is the way out before 05 (D18); 05 needs 04. Stage 06 needs `checkMailboxHosts` of 04: it may build after 04 lands, next to 05. 07 names the files of 01–06.

## How to run (coordinator)

1. Start when F088 is in `spec/features/done/` (it is). Run `scripts/plan-drift.sh spec/features/planned/F085-a-mailbox-whose-host-the-guard-refuses-gets-a-status-and-a-notice 8720bb0` first; exit 1 means a refresh job before stage 01 (`.agents/limen/planner.md` § Refresh job). Move this folder to `spec/features/active/` and commit it before the first spawn.
2. Stage 02 is a migration: spawn it only when no other job with a migration stage builds. No `bun.lock` change in this ticket.
3. For each stage NN, after the stage before it has landed (stage 06: after stage 04):

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F085" \
  'Implement F085 stage NN. Read spec/features/active/F085-a-mailbox-whose-host-the-guard-refuses-gets-a-status-and-a-notice/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: mkdir -p /tmp/f085-sNN && bun run lint > /tmp/f085-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f085-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f085-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f085-sNN/int.log 2>&1 && echo PROOF_OK. In the final message, list as proven only what a saved log shows.'
```

4. Stages 02, 04 and 05: a review job on the stage branch before the land (`limen spawn --review --branch <stage branch> …` with the reviewer model). Land each stage with `limen land --keep-open`; the land of stage 07 closes the ticket.
5. After the land of stage 02: step C1 (`bun run db:migrate` on the shared dev DB).
6. Shared files (advisory, file gates do not stop a spawn): stage 03 edits `channels/commands.ts` and `channels/callbacks.ts` (F100 stages 13–17 and the F103 log conversion stages edit them too); stages 04 and 05 edit `mail/jobs.ts` (F100 stage 07, F103, F104 edit it); stage 05 edits `actions/committer.ts`; stage 01 edits `apps/web/src/i18n/en.ts` and `pl.ts` (F098 stage 13, F100 stage 18). When a land conflicts, resume the worker to merge `master` and prove again.
7. After each land, drop the job DB (`bun run db:worktree <name> --drop` from the main checkout, the name the prepare script printed).

## Planning progress

- [written] stage 01 · [ ] stage 02 · [ ] stage 03 · [ ] stage 04 · [ ] stage 05 · [ ] stage 06 · [ ] stage 07
- [ ] cold review (`plan-review-1.md`), findings applied

## Cold review

Not run yet.

## Log

- 2026-11-14: plan written by a planner job (Opus 5.5) at 8720bb0 (the job branch was fast-forwarded from 2170da8 to `master` twice while reading, so the plan reads the newest code: F100 stage 06 flag refresh in `mail/jobs.ts`, F098 stage 11 bot texts).
