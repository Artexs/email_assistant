# F103 stage 12 — Convert the roots and testmail

Part of [`../plan.md`](../plan.md). Needs stage 01 landed. May run next to one other conversion stage.

Two steps.

## Step 1 — Convert 26 calls

**Goal.** Every log call in `apps/server/src/web.ts`, `composition.ts`, `retention.ts` and `modules/testmail/` is an event (D5, D7). A URL, an origin or a file path never reaches a field.

**New field names** (`platform/log-fields.ts`, each only if it is not there yet): number `body_rows`, `header_rows`, `triage_rows`, `payload_rows`, `error_rows`, `task_rows`, `outbox_rows`, `token_rows`, `wait_ms`, `attempts` (exists); code `batch`, `case_id`.

| File:line             | Old text                                                         | Level | Event                                                | Fields                                                                                                                      |
| --------------------- | ---------------------------------------------------------------- | ----- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| composition.ts:25     | `actions committer: mailbox changes are off (ACTIONS_SCOPE=off)` | info  | `actions_scope`                                      | `config_key: "ACTIONS_SCOPE"`, `scope: "off"`                                                                               |
| composition.ts:29     | `… synthetic mail only`                                          | info  | `actions_scope`                                      | `config_key: "ACTIONS_SCOPE"`, `scope: "synthetic"`                                                                         |
| composition.ts:32     | `… real mail of every active mailbox … (ACTIONS_SCOPE=all)`      | warn  | `actions_scope`                                      | `config_key: "ACTIONS_SCOPE"`, `scope: "all"`                                                                               |
| composition.ts:41     | `sends: off (SEND_SCOPE=off)`                                    | info  | `send_scope`                                         | `config_key: "SEND_SCOPE"`, `scope: "off"`                                                                                  |
| composition.ts:45     | `sends go only to the SEND_TEST_ADDRESSES list`                  | warn  | `send_scope`                                         | `config_key: "SEND_SCOPE"`, `scope: "self"`                                                                                 |
| composition.ts:48     | `sends go to real recipients after an owner's tap`               | warn  | `send_scope`                                         | `config_key: "SEND_SCOPE"`, `scope: "all"`                                                                                  |
| web.ts:69             | `web: no organization for user …`                                | warn  | `web_no_organization`                                | `user_id`                                                                                                                   |
| web.ts:78             | `web: audit ${kind} failed:`                                     | error | `web_audit_failed`                                   | `kind`, `...errorFields`                                                                                                    |
| web.ts:99             | `web: terms record failed for user …`                            | error | `terms_record_failed`                                | `user_id`, `...errorFields`                                                                                                 |
| web.ts:117            | `web: auth mail notice for user … failed`                        | error | `web_auth_mail_notice_failed`                        | `user_id`, `...errorFields`                                                                                                 |
| web.ts:293            | `web is off (WEB_BASE_URL is empty)`                             | info  | `web_off`                                            | `config_key: "WEB_BASE_URL"`                                                                                                |
| web.ts:298            | `WEB_BASE_URL is http:// on a non-loopback host`                 | warn  | `web_cookies_not_secure`                             | `config_key: "WEB_BASE_URL"`                                                                                                |
| web.ts:311            | `auth mail: off …` / `auth mail: on …`                           | info  | `auth_mail_off` / `auth_mail_on` (two literal calls) | —                                                                                                                           |
| web.ts:316            | `AUTH_PWNED_CHECK=off: leaked passwords are not refused`         | warn  | `pwned_check_off`                                    | `config_key: "AUTH_PWNED_CHECK"`                                                                                            |
| web.ts:356            | `operator ids: N`                                                | info  | `web_operators`                                      | `count`                                                                                                                     |
| web.ts:357            | `web is on: ${origin}, dist ${dist}`                             | info  | `web_on`                                             | — (the origin and the path are not logged)                                                                                  |
| retention.ts:98       | `retention org …: body N, headers N, …`                          | info  | `retention_org_done`                                 | `org_id`, `body_rows`, `header_rows`, `triage_rows`, `payload_rows`, `error_rows`, `task_rows`, `outbox_rows`, `token_rows` |
| retention.ts:129      | `retention org … failed:`                                        | error | `retention_org_failed`                               | `org_id`, `...errorFields`                                                                                                  |
| retention.ts:132      | `retention: N organizations, N rows`                             | info  | `retention_done`                                     | `org_count`, `count: total`                                                                                                 |
| retention.ts:134      | `retention failed:`                                              | error | `retention_failed`                                   | `...errorFields`                                                                                                            |
| testmail/bundle.ts:74 | `could not remove old bundle worktree ${name}`                   | warn  | `testmail_bundle_remove_failed`                      | — (the name is a commit sha folder: not needed)                                                                             |
| testmail/send.ts:160  | `waiting N ms (${status or "network"})`                          | info  | `testmail_wait`                                      | `wait_ms`, `code` (the HTTP status number or `"network"`)                                                                   |
| testmail/send.ts:195  | `failed ${batch}/${caseId} ${code}`                              | info  | `testmail_send_failed`                               | `batch`, `case_id`, `code`                                                                                                  |
| testmail/send.ts:242  | `sent ${batch}/${caseId} attempt N`                              | info  | `testmail_sent`                                      | `batch`, `case_id`, `attempts`                                                                                              |
| testmail/send.ts:292  | `recovered ${batch}/${caseId} by label`                          | info  | `testmail_recovered`                                 | `batch`, `case_id`                                                                                                          |
| testmail/send.ts:326  | `stopped: ${stoppedBy}`                                          | info  | `testmail_stopped`                                   | `reason: stoppedBy`                                                                                                         |

- The six scope lines use one code per switch, `actions_scope` and `send_scope`, with the value in `scope`, as `main.ts` does for `triage_scope` (`log.info("triage_scope", { scope: "off" })`, D5). Each keeps its level.
- `terms_record_failed` is the code that `platform/auth.ts:320` writes for the same failure (D5: one code for one kind of line); `docs/known-alerts.md:47-51` then needs one search, not two.
- `retention_org_done` keeps the old condition of the line (check the code around `retention.ts:98`).
- `batch` and `case_id` come from the testmail corpus (codes); the writer drops a value with a space.

**Decisions.** D2, D5, D7, D16.

**Test.**

1. Every test that matched an old text matches the event text: `grep -rn "web is on\|web is off\|operator ids\|auth mail: \|AUTH_PWNED_CHECK=off\|no organization for user\|audit .* failed\|terms record\|auth mail notice\|actions committer\|sends go\|sends: off\|retention\|waiting .* ms\|stopped: \|recovered .* by label" apps/server/test apps/server/src --include=*.test.ts`. At least `retention-job.test.ts`, `web-terms.test.ts` (`terms record`, F089 review M4), `web-http.test.ts`, `main-start-log.test.ts`, `testmail/send.test.ts` may match.
2. `main-start-log.test.ts` passes: the server start writes only event lines with allow-listed keys, now also for `web_on` and the scope lines.
3. New case in the test of `web.ts` (or `web-http.test.ts`): with `WEB_BASE_URL=http://panel.x.test:4321`, no captured line holds `panel.x.test` or `4321`.

**Check.** `bun test apps/server/src/modules/testmail apps/server/test/integration/retention-*.test.ts apps/server/test/integration/web-*.test.ts apps/server/test/integration/main-start-log.test.ts` plus the unit tests the grep found.

**Done when.** No `no-restricted-syntax` message in these files; the tests pass.

## Step 2 — Lint level and known alerts

**Files.** `eslint.config.js` (add `"apps/server/src/*.ts"` and `"apps/server/src/modules/testmail/**/*.ts"` to the `error` block); `log-lint.test.ts`: the case at line 176 (`apps/server/src/web.ts` gives `[1]`) changes to `[2]`, and one case for `apps/server/src/modules/testmail/__log-fixture.ts` gives `[2]`; `docs/known-alerts.md` and `deploy/README.md` by D17 (known matches at `0a5c2ee`: `known-alerts.md:47-51` (`terms record`), `:175` (`web is off`), `:183` (`web is on`), `:199` (`WEB_BASE_URL is http://`); `deploy/README.md:394` (`retention org <id>: …` → `retention_org_done` with `org_id` and the row counts); run the per-row grep for the rest).

**Check.** `bun test apps/server/src/platform/log-lint.test.ts`.

**Done when.** The lint cases pass; the Proof of `plan.md` (`/tmp/f103-s12`) prints `PROOF_OK`; the final message gives the warning count and lists new field names and calls not in the table. When stages 02–12 have all landed, the count is 0 or names only lines of other tickets.

**Out of scope.** The F099 and F095 lines in `web.ts` and `composition.ts` that have not landed yet.
