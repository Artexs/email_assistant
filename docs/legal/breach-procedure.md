# Personal data breach procedure (GDPR Art. 33, 34) — DRAFT, not legal advice

Status: draft of the build commit. The steps run from the first sign of a breach to the notices. The provider is the processor of the mail of each organization and the controller of the account data of members (`docs/legal/records-of-processing.md`). The text of Art. 33 and 34 was read at EUR-Lex on 2026-11-17 (rows of `docs/legal/claims.md`). No lawyer has checked it.

This paper writes no new runbook. Where a runbook exists, a step links to it. Where none exists, the step says so and shows a visible placeholder. Contact of the provider: `<contact>`. Address: `<address>`.

Rule for every step: never put mail text, an address, a password or a key into a notice, a ticket, a log or this repository. Name organizations by their id (`docs/decisions/0024-structured-logs-and-operator-alerts.md` point 1).

## Detect

Signs of a breach come from these sources:

- **The Healthchecks.io alert.** The server pings Healthchecks.io every 5 minutes. A stop gives an alert after the period and the grace time (`deploy/README.md` § Heartbeat). A second check watches the nightly backup (`deploy/README.md` § Backups, Status file and ping).
- **Operator notices.** The job `ops.slo` sends operator alerts to the operator Telegram chat: sync lag, urgent latency, LLM failure rate, free disk and backup age (ADR 0024 point 6). Each alert has an entry in `docs/known-alerts.md`: search it first.
- **Logs and audit rows.** Read the logs with `bash deploy/logs.sh` (`deploy/README.md` § Logs). The audit rows `org.exported`, `org.delete_refused`, `dsr.find` and `dsr.erase` show in the security log of an organization (`docs/capabilities/account-data.md` rule 16). Sign-in rows (`web.login`, `web.login_locked`) are in the same log (`docs/architecture.md` §7 "Audit").
- **A report from a person.** A member, an owner, a provider or any other person tells the operator.

None of the alerts above detects a leak of data by itself. They show a stop or a fault. A leak is found by a person who reads the logs or the audit rows, or who gets a report. E8b replaces this step with its alert runbooks (the alert design is in ADR 0024). `<to confirm: breach detection beyond availability alerts>`.

When a sign appears, write down the date and the time of awareness. The clocks of the later steps start there. Keep the note outside this repository (see "Record").

## Contain

Stop the harm first. Do the steps that fit the case, in this order. Each step names the runbook that holds the commands.

1. **Stop the server** when it leaks data now: `$C stop server` (`deploy/README.md` § Heartbeat uses this command for a test stop). Start it again with `$C start server`.
2. **Roll back the release** when a new release caused the breach: `deploy/rollback.sh` (`deploy/README.md` § Roll back a release). The script never restores the database.
3. **End every session.** Run `delete from auth_sessions;` and ask the members to sign in again (`docs/capabilities/backups.md` rule 5; `deploy/README.md` § Backups). A member can also use "sign out everywhere" in the Account card (`docs/capabilities/web-panel.md`).
4. **Rotate the secrets that the breach may have exposed.** Change the value in `.env` on the host, then run `$C up -d server` (`deploy/README.md` § Telegram shows this for the bot token).
   - **`CREDENTIALS_KEY`.** The stored mailbox secrets are sealed with it. A new key with the old key version cannot open them: the check `bun run credentials:check` shows `failed` above 0 (`deploy/README.md` § VPS lost, step 3 and step 6). The ADR says that after a key loss every mailbox must connect again (`docs/decisions/0009-encrypted-credentials.md`). No rotation runbook exists: `<to confirm: CREDENTIALS_KEY rotation steps>` (E8b).
   - **`WEB_AUTH_SECRET`.** It signs the session and encrypts the second factors. A new value makes every second factor unreadable: each user needs `bun run web:two-factor-reset` (`docs/architecture.md` §7 "Two-factor sign-in"). Then run step 3.
   - **The bot token (`TELEGRAM_BOT_TOKEN`).** A wrong or revoked token stops the polling with a 401: put the new value in `.env` and run `$C up -d server` (`deploy/README.md` § Telegram). How to revoke the old token at Telegram: `<to confirm: bot token revoke steps>`.
   - **Mailbox passwords.** The owner changes the password at the mail provider. Then store the new one with `bun run mailbox:password` (`docs/capabilities/sync.md`; the check of the login runs first). After an organization delete, the command `org:delete` prints the mailboxes whose password the owner must change (`deploy/README.md` § Delete an organization).
   - Other keys of `.env` (LLM keys, backup keys, Tailscale): `<to confirm: rotation of other keys>`.
5. **Restore from a backup** only when the data is damaged. Use `deploy/README.md` § VPS lost and § Restore (D20) (replay the deletes and erases that came after the backup).

## Assess

Find out what happened. Answer these questions and write the answers down.

- **Which data?** Name the data categories (the ids of `docs/legal/records-of-processing.md`). Mail text and mailbox secrets weigh more than counts and ids.
- **Whose data?** Name the organizations by id and the kind of people: members, or other people (senders, recipients, delegates). `bun run org:status` lists the organizations (`deploy/README.md` § Customers). `<to confirm: how to count the people of one organization>`.
- **Was the data readable?** A backup is encrypted with `age` and the key is not on the host (`docs/capabilities/backups.md` rule 1). Mailbox secrets are encrypted in the database (ADR 0009). A leak of the `.env` file together with the database makes the secrets readable (`docs/legal/dpia.md`, risk R6).
- **Which role?** The mail of an organization: the provider is the processor. The account data of members: the provider is the controller.
- **How high is the risk to the people?** Mark it `no risk`, `risk` or `high risk`. This mark decides the notices below. The test of the law: `<to confirm: risk test for the notice duties>`.

## Notify the controller

For the mail of an organization the organization is the controller. The provider tells the owner of each affected organization.

- **When.** Without undue delay. The target is 24 hours after awareness. This is a default of the F107 plan; the law sets no number for the processor (F107 question Q9: the owner confirms it). `<to confirm: 24 hours target>`. The 72 hours of the next step belong to the controller.
- **How.** By a private channel, never by an open mail. Use the contact of the owner: `<to confirm: contact channel of the owners>`.
- **What.** The nature of the breach, the data categories, the organizations and the approximate number of people, the likely effects, and the measures taken and planned. Add no mail text.
- **Content list.** Art. 33(3) lists the same points for the notice to the authority, and adds the contact point of the data protection officer (read at EUR-Lex on 2026-11-17).

For the account data of members the provider is the controller: continue with the next section as the controller.

## Notify the authority and the people

- **The controller notifies the supervisory authority** within 72 hours after it becomes aware of the breach (Art. 33(1)), unless the breach is unlikely to put people at risk. In Poland the authority is UODO. The 72 hours and the exception were read at EUR-Lex on 2026-11-17. The authority was read at the site of UODO on the same day (`docs/legal/claims.md`).
- **The controller notifies the people** when the breach is likely to put them at high risk (Art. 34). The article was read at EUR-Lex on 2026-11-17.
- **When the provider is the controller** (account data of members), `<provider name>` makes both notices.
- **When the organization is the controller,** the provider helps with facts, on the written request of the owner. The DPA says that the processor tells the controller without undue delay and follows this procedure (`apps/web/src/legal/en/dpa.md`, section "Breaches").
- A notice to people has no mail text and no secret in it.

## Record

Every breach goes into the breach register, also a breach that no one notifies. The register lives at `<to confirm: breach register location>`, outside this public repository (F107 question Q5).

Each entry holds the facts of the breach, its effects and the measures taken (Art. 33(5)). Add: the time of awareness, the time of each notice, the data categories, the organization ids and the decision about the notices with its reason. The entry holds no mail text, no address and no secret.

## After

- **Find the cause** and fix it. A fix is a patch release (`deploy/README.md` § Release). A bug becomes a ticket.
- **Write the alert entry** in `docs/known-alerts.md` when a log line or an alert showed the breach: use its template (event code, first seen, source, cause, fix, status).
- **Update the papers.** Change the risks and the levels in `docs/legal/dpia.md`. Change the records of processing, the sub-processor list or the data category list when the cause was in them (`packages/core/src/legal/subprocessors.ts`, `packages/core/src/legal/data-categories.ts`).
- **Check the secrets again** after a restore: `bun run credentials:check` must show `failed=0` (`docs/capabilities/backups.md` rule 7).
- **Tell the owners** what changed and what they must do, for example to change a mailbox password.
