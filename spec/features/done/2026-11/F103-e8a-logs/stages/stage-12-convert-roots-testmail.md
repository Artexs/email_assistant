# F103 stage 12 — Convert the roots and testmail

Part of [`../plan.md`](../plan.md). Needs stage 01 landed. May run next to one other conversion stage.

Two steps.

## Step 1 — Convert 26 calls

**Goal.** Every log call in `apps/server/src/web.ts`, `composition.ts`, `retention.ts` and `modules/testmail/` is an event (D5, D7). A URL, an origin or a file path never reaches a field.

**New field names** (each only if missing): number `body_rows`, `header_rows`, `captured_header_rows`, `triage_rows`, `payload_rows`, `error_rows`, `task_rows`, `outbox_rows`, `token_rows`, `wait_ms`; code `batch`, `case_id`.

File, old text (start) → event: fields. Levels stay.

- `composition.ts`: `actions committer: mailbox changes are off (ACTIONS_SCOPE=off)` → `actions_scope`: `config_key: "ACTIONS_SCOPE"`, `scope: "off"`.
- `composition.ts`: `… applies mailbox changes to test mail only` → `actions_scope`: `scope: "synthetic"`, same `config_key`.
- `composition.ts`: `… real mail of every active mailbox … (ACTIONS_SCOPE=all)` → `actions_scope`: `scope: "all"`.
- `composition.ts`: `sends: off (SEND_SCOPE=off)` → `send_scope`: `config_key: "SEND_SCOPE"`, `scope: "off"`.
- `composition.ts`: `sends go only to the SEND_TEST_ADDRESSES list` → `send_scope`: `scope: "self"`.
- `composition.ts`: `sends go to real recipients after an owner's tap` → `send_scope`: `scope: "all"`.
- `web.ts`: `web: no organization for user …` → `web_no_organization`: `user_id`.
- `web.ts`: `web: audit ${kind} failed:` → `web_audit_failed`: `kind`, `...errorFields`.
- `web.ts`: `web: terms record failed for user …` → `terms_record_failed`: `user_id`, `...errorFields` (the code `platform/auth.ts` already writes for the same failure, D5).
- `web.ts`: `web: auth mail notice for user … failed` → `web_auth_mail_notice_failed`: `user_id`, `...errorFields`.
- `web.ts`: `web is off (WEB_BASE_URL is empty)` → `web_off`: `config_key: "WEB_BASE_URL"`.
- `web.ts`: `WEB_BASE_URL is http:// on a non-loopback host` → `web_cookies_not_secure`: `config_key: "WEB_BASE_URL"`.
- `web.ts`: `auth mail: off …` / `auth mail: on …` → `auth_mail_off` / `auth_mail_on` (two literal calls): —.
- `web.ts`: `AUTH_PWNED_CHECK=off: …` → `pwned_check_off`: `config_key: "AUTH_PWNED_CHECK"`.
- `web.ts`: `operator ids: N` → `web_operators`: `count`.
- `web.ts`: `web is on: ${origin}, dist ${dist}` → `web_on`: — (origin and path are not logged).
- `retention.ts`: `retention org …: body N, headers N, captured N, …` → `retention_org_done`: `org_id` and the eleven `*_rows` counts (the nine named above, plus `sent_body_rows` and `sent_header_rows`); keeps its condition (only when a count is above 0).
- `retention.ts`: `retention org … failed:` → `retention_org_failed`: `org_id`, `...errorFields`.
- `retention.ts`: `retention: N organizations, N rows` → `retention_done`: `org_count`, `count`.
- `retention.ts`: `retention failed:` → `retention_failed`: `...errorFields`.
- `testmail/bundle.ts`: `could not remove old bundle worktree ${name}` → `testmail_bundle_remove_failed`: — (the name is not needed).
- `testmail/send.ts`: `waiting N ms (${status or "network"})` → `testmail_wait`: `wait_ms`, `code` (HTTP status or `"network"`).
- `testmail/send.ts`: `failed ${batch}/${caseId} ${code}` → `testmail_send_failed`: `batch`, `case_id`, `code`.
- `testmail/send.ts`: `sent ${batch}/${caseId} attempt N` → `testmail_sent`: `batch`, `case_id`, `attempts`.
- `testmail/send.ts`: `recovered ${batch}/${caseId} by label` → `testmail_recovered`: `batch`, `case_id`.
- `testmail/send.ts`: `stopped: ${stoppedBy}` → `testmail_stopped`: `reason` (the `StoppedBy` union).

- The six scope lines use one code per switch, as `main.ts` does for `triage_scope` (D5).
- `batch` and `case_id` come from the testmail corpus (codes); the writer drops a value with a space.

**Decisions.** D2, D5, D7, D16.

**Test.**

1. Tests that matched an old text match the event text (at least `retention-job.test.ts`, `web-terms.test.ts`, `web-http.test.ts` (it matches `operator ids: 1`), `main-start-log.test.ts`, `testmail/send.test.ts` may).
2. `main-start-log.test.ts` passes: the server start writes only event lines with allow-listed keys, now also `web_on` and the scope lines.
3. `web-http.test.ts` (or the test of `web.ts`): with `WEB_BASE_URL=http://panel.x.test:4321`, no captured line holds `panel.x.test` or `4321`.

**Done when.** No `no-restricted-syntax` message in these files; the tests pass.

## Step 2 — Lint level and known alerts

- `eslint.config.js`: add `"apps/server/src/*.ts"` and `modules/testmail/**/*.ts` to the `error` block.
- `log-lint.test.ts`: the case that expects `[1]` for `apps/server/src/web.ts` now expects `[2]`; an old-form line at `modules/testmail/__log-fixture.ts` gives `[2]`.
- Docs by D17. Known quotes: `terms record`, `web is off`, `web is on`, `WEB_BASE_URL is http://`, and `deploy/README.md` `retention org <id>: …` (→ `retention_org_done` with `org_id` and the row counts).

**Done when.** No old text of the list in either doc; the Proof (`/tmp/f103-s12`) prints `PROOF_OK`; the final message gives the warning count, new field names and calls not in the list. When stages 02–12 have all landed, the count is 0 or names only lines of other tickets.

**Out of scope.** Behaviour of the web server, the scopes or the retention job.
