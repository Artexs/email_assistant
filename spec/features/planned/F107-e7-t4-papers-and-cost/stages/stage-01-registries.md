# F107 stage 01 — Sub-processor and data-category registries

Part of [`../plan.md`](../plan.md). Decisions P2, D3, D4, D12.

## Step 1 — Sub-processor registry

**Goal.** One typed list of the outside services that get data.

**Files.** New `packages/core/src/legal/subprocessors.ts` (exported from `@ea/core/web`: the web app imports only that entry, and the root re-exports it); its unit test. A server unit test for the checks that need server code, and the map `OUTSIDE_SERVICE_KEYS` next to the config.

**Interfaces.** D3 names and shapes. Rows (check each at `HEAD`):

| id | personalData | activeWhen | dataReceived (en, short) |
| --- | --- | --- | --- |
| `openai` | yes | llmProvider `openai` | mail text, subject, sender for triage and drafts |
| `gemini` | yes | llmProvider `gemini` | the same |
| `telegram` | yes | env `TELEGRAM_BOT_TOKEN` | the items of `tg_consent_text`, no more, no less |
| `backblaze` | yes | host `backup` | the database dump, encrypted with `age` before upload |
| `tailscale` | yes | always | panel traffic (encrypted), device and network metadata |
| `healthchecks` | no | env `HEARTBEAT_URL` | a timing ping |
| `hibp` | no | env `AUTH_PWNED_CHECK` unless `off` | 5 hex characters of a password hash |
| `auth-smtp` | yes | env `AUTH_SMTP_HOST` | the address and link of an auth mail; name `<SMTP provider>` |

`location`: facts from ADR 0015, the consent text, `docs/architecture.md`; else `<to confirm: location>`; Backblaze `<B2 region>` (Q3). `termsUrl`: the provider's privacy page (stage 06 verifies it).

**Decisions.** `OUTSIDE_SERVICE_KEYS: Record<string, string | { exempt: string }>` maps each config key that names an outside endpoint or credential to a row id, or to an exempt reason (own database, own panel URL, a local key).

**Test.**
1. Every key of `llmProviders` has exactly one row with `activeWhen = { kind: "llmProvider", provider: <key> }`.
2. Every `env` key of a row is a key of the server config schema.
3. Every config schema key that ends in `_URL`, `_HOST`, `_API_KEY`, `_TOKEN` or `_ENDPOINT` is a key of `OUTSIDE_SERVICE_KEYS`; every mapped id is a row id. A new key fails with its name.
4. Row ids are unique; every `Texts` value has a non-empty `en` and `pl`.

## Step 2 — Data-category registry

**Goal.** One typed list of what the system stores, about whom and for how long.

**Files.** New `packages/core/src/legal/data-categories.ts` (exported as in step 1); a server integration test for coverage; a server unit test for the retention pins.

**Interfaces.** D4 names and shapes. A category groups columns with one period; `columns` entries are `table.column` or `table.*`. Ids: `account`, `organization`, `mailbox-secret`, `mail-body`, `captured-headers`, `mail-headers`, `mail-ids`, `ai-results`, `delegation`, `rules`, `chat-links`, `messages`, `audit`, `tombstones`; add one when a period does not fit (name it in the final message).

**Decisions.**
- Take every period from `docs/capabilities/retention.md` rule 2 and the clear functions at `HEAD`. A column that no clear function touches is `untilDelete`.
- `subjects` includes `others` for every category that holds data of people who are not members.
- `NO_PERSONAL_DATA_TABLES`: tables of codes, counts or migrations only; each with a reason.

**Test.**
5. (int) Every table of the `public` schema is in at least one category or in `NO_PERSONAL_DATA_TABLES`, never in both. Read the catalog (`pg_class`, `relkind = 'r'`) as the migrator role (`MIGRATOR_DATABASE_URL`, as `db-role.test.ts` does): the `app` role sees not every table.
6. (int) In one migrator transaction: create `f107_probe (id int)`, run the check 5 query in that transaction, expect `f107_probe` in the missing list, roll back.
7. Every table of `DSR_ADDRESS_MAP` is in a category whose `subjects` include `others`.
8. Fixed pins (unit): `emails.body_text` → `{ kind: "orgSetting", defaultDays: 30 }`; `email_headers.*` → `orgSetting`; `emails.subject` → `{ kind: "days", days: 90 }` (equal to `RETENTION_TEXT_DAYS`); `emails.dedup_key` → `untilDelete`; `chat_links.*` → `untilDelete`; `actions.provider_result` → `untilDelete`; `delegations.task_summary` → `{ kind: "daysAfterClose", days: 90 }`. `defaultDays` equals the default of `organizations.data_retention_days` (int test).
9. Category ids are unique; a column is in at most one category.

**Check.** `bun test packages/core/src/legal`, the new server unit and integration tests.

**Done when.** Tests 1–9 pass and the Proof of `plan.md` prints `PROOF_OK`.

**Out of scope.** Rendering (02), legal texts (03–05), the version guard (06).
