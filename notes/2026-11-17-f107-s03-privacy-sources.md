# F107 stage 03: privacy policy, sources and open placeholders

Files: `apps/web/src/legal/en/privacy.md`, `apps/web/src/legal/pl/privacy.md`. Test: `apps/web/src/lib/legal-privacy.test.ts`. The new allowed placeholder is `<backup retention>` (`apps/web/src/lib/legal.ts`). Stage 06 builds `docs/legal/claims.md` from the table below.

## Open placeholders

In the two privacy sources (each language):

- `<provider name>`, `<contact>`, `<address>`: P3, no person or company in a public repo.
- `<to confirm: legal basis>` (seven times, one per purpose): no source states a legal basis.
- `<backup retention>`: the off-site backup lifecycle rule is a Backblaze UI setting, not in the repo (`docs/capabilities/backups.md` rule 3 says only "for example after 90 days").
- `<to confirm: OpenAI terms check date>`: ADR 0015 holds the OpenAI terms (no training on API data, abuse logs up to 30 days, no EU location, 2026-11-06). Nobody has checked them since.
- `<to confirm: transfer mechanism>`: no source names a transfer mechanism for OpenAI or Telegram.
- `<to confirm: assessment of automated decisions>`: whether the sorting is a decision with legal effect is a legal judgement; no source makes it.

In the registries (shown in the generated tables of the privacy page and the DPA Annex 2; stage 01 and 02 own them, not changed here):

- `packages/core/src/legal/subprocessors.ts`:
  - `<to confirm: location>`: `tailscale`, `healthchecks`, `hibp`, `microsoft-oauth`, `google-oauth`, `auth-smtp`.
  - `<to confirm: country>` (after "No EU location"): `openai`, `gemini`.
  - `<B2 region>` (`backblaze`, Q3) and `<SMTP provider>` (`auth-smtp` name): these two are not in `legalPlaceholders`. No test checks registry text against that list.
  - `<to confirm: SMTP provider privacy page>` (`auth-smtp` `termsUrl`).
  - Every `termsUrl` of the other rows is unverified (stage 06 verifies them).
- The OAuth rows (`microsoft-oauth`, `google-oauth`) hold `<to confirm: location>`. The policy text does not describe mailbox OAuth (stage rule: no planned features). The table shows the rows with their "used when" key, so a reader of the privacy page sees them. Stage 06 decides if the text must name them.

## Statement and source

| Statement (short) | Source |
| --- | --- |
| Roles: organization is controller of its mail; provider is processor, and controller of member account data | Stage 03 file, section 1 (the plan, not a law text). Weak. |
| Mail data kinds, header facts, attachment names | `docs/architecture.md` §7 (retention table), `docs/capabilities/retention.md` rule 2 |
| Sent folder read: read-only, off by default, needs flag `sent_sync` and switch | `docs/capabilities/sent-mail.md` (What it does now), `docs/capabilities/web-panel.md` |
| Member data (name, e-mail, language, hash, sessions with device and address, terms version, Telegram chat) | `docs/capabilities/web-panel.md` rules 3 and Data; `docs/architecture.md` §7 (sessions, terms, backups hold password hashes) |
| Mailbox secret encrypted; AES-256-GCM, key in env, memory only | ADR 0009, `docs/architecture.md` §7 |
| Audit log holds ids, codes, numbers | ADR 0008 |
| Kept ids (Message-ID, dedup key, thread key, content hash); row stays | `docs/capabilities/retention.md` rule 2, `notes/2026-11-12-s6a-customer-core.md` |
| Logs hold no mail text, address or password | `docs/capabilities/logs.md`, `docs/architecture.md` §7 Logs |
| Daily retention job; rows stay | `docs/capabilities/retention.md` rules 1 and 2 |
| Backup nightly, whole database; keeps cleared texts and deleted data until expiry; local copies 7 days default | `docs/capabilities/backups.md` rules 1, 2 and Data; `deploy/backup.env.example` (`KEEP_DAYS=7`) |
| Mailbox keeps mail, drafts and folders stay | `docs/capabilities/account-data.md` Limits |
| Telegram keeps messages until the member deletes them; chats not end-to-end encrypted; items sent to Telegram; open-loop items | `tg_consent_text` (`apps/web/src/i18n/en.ts` line 352) |
| Consent recorded before Telegram link | `docs/capabilities/digest-and-notices.md` rule 1 (`web.telegram_consent`) |
| AI input: mail text, subject, sender, delegates, last 3 mails of the thread; mail older than 7 days not sent | `docs/capabilities/triage.md` rules 3 and the `too_old` line |
| "This install uses OpenAI"; no training, `store: false`, abuse logs 30 days, no EU location | ADR 0015 (Decision, data rules). Weak: terms of a third party, not checked since 2026-11-06; install-specific (E2; stage 06 gives the condition in `claims.md`). |
| Gemini may be used instead | ADR 0015 (switch `LLM_PROVIDER`) |
| Backup encrypted with `age` before upload, key not on the server | `docs/capabilities/backups.md` What it does now |
| Approved draft leaves from the owner's own mailbox by SMTP | `docs/capabilities/drafts-and-send.md` What it does now |
| Never sends on its own; owner approves exact text; 48 h expiry; reminders use the same path | `docs/capabilities/drafts-and-send.md` What it does now |
| AI cannot choose a recipient | `docs/architecture.md` §7 (untrusted text; "A recipient is never LLM text") |
| Shadow mode changes nothing; assist moves only auto categories that passed the gate; each move has a reason; Undo 7 days | `docs/architecture.md` §4.3 modes table, `docs/capabilities/actions-and-undo.md` rules 2 and What it does now |
| Export by the operator, encrypted, no hash, secret, token or session | `docs/capabilities/account-data.md` rule 6, `deploy/README.md` § Export |
| Delete: Account card with flag `org_delete`, else the operator; what goes; backups keep rows; restore needs a repeat | `docs/capabilities/account-data.md` rules 1, 3, 4, 15; `deploy/README.md` § Delete an organization |
| Data requests on the written instruction of the owner; find and erase; tombstone; blanked digests; delegates and sender rules listed only; Telegram messages stay | `docs/capabilities/account-data.md` rules 7–13 and Limits; `deploy/README.md` § Data request |
| One month to answer (Art. 12(3)) | `deploy/README.md` § Data request (line "GDPR Art. 12(3): answer within one month"). The article text itself is not checked (stage 06). |
| Supervisory authority in Poland is UODO | Stage 03 and stage 05 files only. Weak. |
| TLS certificates always checked | `docs/architecture.md` §6.1 and §7 |
| Panel only through Tailscale, no public address | ADR 0017, `docs/architecture.md` §7. Weak: the S6 path is a public proxy, so this holds for the home VPS install only (E2). |
| Lockout 10 in 15 min for 15 min; leaked-password check sends 5 hex characters; optional TOTP | `docs/architecture.md` §7 (Lockout, Leaked passwords, Two-factor) |
| Tenant filter by organization plus row-level security as second barrier | `docs/architecture.md` §5 Tenancy and §7 Tenant isolation |
| Version at the top; new version shows a dialog; acceptance records version and time | `docs/architecture.md` §7 Terms, `docs/capabilities/web-panel.md` rule 3 |
| Weekly numbers and AI cost per mailbox (measurement purpose) | `docs/capabilities/measurement.md` What it does now |

## Judgement calls

- The stage said "do not describe planned features (read Sent, ...)". Reading Sent is built at `HEAD` (`docs/capabilities/sent-mail.md`, off by default), and `sent_emails` is in the data-category registry. The text names it as optional and off by default. Stage 06 may remove the bullet if the owner does not want it public before the feature ships.
- The Polish text follows the UI rules of `notes/2026-11-14-polish-ui.md` (informal "ty", mode name "tryb podglądu", the switch label of `sent_switch`).
- The text avoids hours and numbers that a code change could move, except those that a source states (7 days of local backup, 48 h, 7 days of Undo, 10 in 15 minutes, 30 days of OpenAI abuse logs).
