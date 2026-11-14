# F107 stage 01 — Sub-processor and data-category registries

Part of [`../plan.md`](../plan.md). Decisions P2, D3, D4, D12.

## Step 1 — Sub-processor registry

**Goal.** One typed list of every outside service that receives data, for the legal pages (stage 02) and the E10b security page.

**Files.** New `packages/core/src/legal/subprocessors.ts` (exported from `@ea/core`); its unit test. A server unit test next to the LLM provider registry or config for the checks that need server code.

**Interfaces.** D3 names and shapes. Rows at the plan base (worker checks each against the code at `HEAD`):

| id | personalData | activeWhen | dataReceived (en, short) |
| --- | --- | --- | --- |
| `openai` | yes | llmProvider `openai` | mail text, subject, sender for triage and drafts |
| `gemini` | yes | llmProvider `gemini` | the same |
| `telegram` | yes | env `TELEGRAM_BOT_TOKEN` | the items of the consent text `tg_consent_text` (en and pl), no more, no less |
| `backblaze` | yes | host `backup` | the database dump, encrypted with `age` before upload |
| `tailscale` | yes | always | panel traffic (encrypted), device and network metadata |
| `healthchecks` | no | env `HEARTBEAT_URL` | a timing ping, no personal data |
| `hibp` | no | env `AUTH_PWNED_CHECK` (on unless `off`) | 5 hex characters of a password hash |
| `auth-smtp` | yes | env `AUTH_SMTP_HOST` | the address and the link of an auth mail; name `<SMTP provider>` |

`location` uses facts from ADR 0015, the consent text and `docs/architecture.md`; an unknown location is `<to confirm: location>`; Backblaze is `<B2 region>` (Q3). `termsUrl` is the provider's privacy or data page; stage 06 verifies each URL.

**Test.**
1. Every key of `llmProviders` has exactly one row with `activeWhen = { kind: "llmProvider", provider: <key> }` (today `gemini`, `openai`).
2. Every `env` key of a row is a key of the server config schema (`TELEGRAM_BOT_TOKEN`, `HEARTBEAT_URL`, `AUTH_PWNED_CHECK`, `AUTH_SMTP_HOST`).
3. Row ids are unique; every `Texts` value has a non-empty `en` and `pl`.

## Step 2 — Data-category registry

**Goal.** One typed list of what the system stores, about whom and for how long, so the privacy page, the records of processing and the tests share it.

**Files.** New `packages/core/src/legal/data-categories.ts` (exported like step 1); a server integration test for coverage; a server unit test for the retention pins.

**Interfaces.** D4 names and shapes. Categories (ids fixed; tables from `docs/architecture.md` §5 at `HEAD`):
`account` (users, memberships, auth tables), `organization` (organization and mailbox settings), `mailbox-secret` (encrypted credentials), `mail-body`, `mail-headers` (subject, addresses, captured headers), `mail-ids` (Message-ID, dedup keys: `untilDelete`), `ai-results` (triage results, action payloads, drafts), `delegation` (delegates, delegations), `rules` (sender rules), `chat` (Telegram links, outbox), `audit` (audit log, feedback labels), `tombstones` (DSR hashes). A table holds one category; a table with columns of two kinds (for example `emails`) goes to the category of its most personal column, and the category's `label` names the other columns.

**Decisions.**
- `kept` of `mail-body` is `{ kind: "orgSetting", defaultDays: 30 }`; `mail-headers`, `ai-results`, `chat` are `{ kind: "days", days: 90 }`; `audit` and `mail-ids` are `untilDelete`; reset and invite tokens are part of `account` with the note in its label (1 day after expiry). The worker takes each number from the retention code, never from this list.
- `subjects` includes `others` for every category that holds data of senders or recipients who are not users.
- `NO_PERSONAL_DATA_TABLES`: the migration table and tables of codes or counts only; each entry has a reason string.

**Test.**
4. (int) Every table of the `public` schema (from `information_schema.tables`) is in exactly one category or in `NO_PERSONAL_DATA_TABLES`; the test names the missing or doubled tables.
5. (int) A probe table `f107_probe` made inside the test transaction makes check 4 fail with `f107_probe` in the message (then rolls back).
6. Every table of `DSR_ADDRESS_MAP` is in a category whose `subjects` include `others`.
7. `mail-body.kept.defaultDays` equals the column default of `organizations.data_retention_days` (30); every `{ kind: "days" }` value equals `RETENTION_TEXT_DAYS` (90).
8. Category ids are unique; `tables` lists hold no duplicate.

**Check.** `bun test packages/core/src/legal`, the new server unit test and the new integration test file.

**Done when.** Tests 1–8 pass and the Proof of `plan.md` prints `PROOF_OK`.

**Out of scope.** Rendering (stage 02), legal texts (03–05), the version guard (02).
