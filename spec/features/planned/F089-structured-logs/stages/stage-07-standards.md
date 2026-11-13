# F089 stage 07 — The log standard in the docs

Part of [`../plan.md`](../plan.md). Read D7–D22 of `plan.md` first. Needs stages 01–06 landed (the docs name their files and event codes). Docs only, two steps. This is the last stage: its land closes the ticket.

Write in the style of the files you edit (plain technical English, short sentences, active voice). Name functions and files that exist at your base commit; check each name with `grep` before you write it.

## Step 1 — Code patterns, styleguide, architecture, ADR

**Goal.** Every planning session, worker and reviewer reads the log standard: what a line is, which fields pass, where the ids come from, what the lint does.

**Files.** Change: `docs/code-patterns.md`, `.agents/limen/styleguide.md`, `docs/architecture.md`, `docs/decisions/0024-structured-logs-and-operator-alerts.md`.

**Interfaces.**

`docs/code-patterns.md`: a new section `## Logs (ADR 0024)` directly before `## Style`, with these rules as bullets (your wording may be shorter, the content must stay):

- A log line is an event: `log.<level>("<event_code>", { <fields> })`. The code is a snake_case literal of at most 64 characters, constant, and names what happened (`auth_mail_failed`). `msg` equals the code. One code for one kind of line.
- Fields only from `logFieldNames` in `apps/server/src/platform/log-fields.ts`. Values: a number, a boolean, `null`, or a code of at most 64 characters from `A–Z a–z 0–9 _ . : / * -` without `://` (ids and route patterns are codes). The writer drops any other field or value and counts it in `dropped_fields`; a line with `dropped_fields` is a bug to fix. A change that logs a new field name adds it to the list; the review checks that its values are ids, codes, counts or times. The value rule does not stop a secret that looks like a code: never add a field for a token, a password or a key value, and never pass one in a code field.
- Errors: `...errorFields(error)` (name and code). Never `error.message`, a mail text, an address, a URL or a token.
- Context: the scheduler gives every line of a job tick `job` and `run_id` (`runJobTick`); the HTTP layer gives every line of a request `request_id` and sets the `x-request-id` header. Per-item ids come from a child logger: `const mailboxLog = log.with({ org_id, mailbox_id })`. Inside a run or a request, never pass `job`, `run_id` or `request_id` by hand (the context value wins and the call value is dropped); only a line outside any context names a job with `job` (`job_scheduled`, `job_skipped`). Name a child logger `<thing>Log` (the lint finds it by that name). Create a long-lived timer, interval, socket or pool at start, outside any context: it keeps the context it was created in.
- Format: the server prints `json` by default (its config) and the VPS pins `LOG_FORMAT: json` (`deploy/compose.yaml`); `text` prints `[module] event key=value …` (dev, `.env.example`). A process that does not load the config (a CLI, a test) prints `text` unless `LOG_FORMAT=json`. Tests run in `text` (the test preload).
- Lint: `no-restricted-syntax` in `eslint.config.js` (`logEventSelectors`) warns on any other log call in `apps/server/src`, and fails in the converted files (`platform/`, `main.ts`). E8a converts the modules one by one, moves each to the `error` block, and flips the rest at the end. A new log line in any file is an event from now on.
- `docs/known-alerts.md` keys the entries of event lines by the event code.

In `## Style`, the bullet "Use the `log` util (`platform/log`) with a `[module]` prefix, never `console.log`. No mail bodies or secrets in logs." becomes "Use the `log` util (`platform/log`), never `console.log`. The rules are in § Logs." In the Telegram bullet, "Other errors: `describeError(error)`." becomes "Other errors: `errorFields(error)` in an event line, `describeError(error)` only in an old-form line that E8a has not converted yet."

`.agents/limen/styleguide.md`:

- § Prefer: the bullet "`log` from `platform/log` with a `[module]` prefix; `describeError(error)`; for Telegram only `telegramErrorLabel(error)`." becomes "Log lines are events: `log.info(\"sync_done\", { mailbox_id, count })`, fields only from `platform/log-fields.ts`, errors as `...errorFields(error)`; `job`, `run_id` and `request_id` come from the context, never by hand (`docs/code-patterns.md` § Logs). For Telegram errors in an old-form line only `telegramErrorLabel(error)`."
- § Avoid: the bullet "`console.log`, secrets or mail bodies in logs, paths from mail data in logs." becomes "`console.log`; a template literal, free text or `error.message` in a log call; secrets, mail text, addresses or paths from mail data in logs."
- The file stays at or below 1000 lines (`wc -l`).

`docs/architecture.md` §8: the bullet "**Logging:** `log` util with levels and a `[module]` prefix." becomes: "**Logging (ADR 0024):** one JSON object per line (`LOG_FORMAT=json`, the VPS) with `time`, `level`, `module`, `event`, `msg` and allow-listed fields (`platform/log-fields.ts`); every line of a job tick has `job` and `run_id`, every line of an HTTP request has `request_id` (also the `x-request-id` response header); `LOG_FORMAT=text` in dev. The start lines name each job with `job_scheduled`; the schedules are in this section. Module lines move to the event form in E8a; until then they appear as `event: legacy_text` with their old text in `msg`."

ADR 0024: in point 1 of "Decision", the sentence "Errors reach a log only through `describeError()` (name and code)." becomes "Errors reach a log only through `errorFields()` in an event line, or `describeError()` in an old-form line (name and code)." Then, after the `- Date:` line, add one line: "- Progress: F089 (`spec/features/done/<YYYY-MM>/F089-structured-logs/`) landed point 2 and the base of point 1: the writer with the allow-list and the drop count, the lint in `warn`, `platform/` and `main.ts` converted and held at `error`. The module conversion, the lint in `error` everywhere and points 3–7 are E8a and E8b." Use the month of the land for `<YYYY-MM>`. The status stays "proposed" (it is accepted when E8a lands).

**Decisions.** D9, D18, D19, D21, D22.

**Test.** None (docs).

**Check.**

```
bunx prettier --check docs/code-patterns.md .agents/limen/styleguide.md docs/architecture.md docs/decisions/0024-structured-logs-and-operator-alerts.md
wc -l .agents/limen/styleguide.md
grep -n "logFieldNames\|errorFields\|runJobTick\|withLogContext\|logEventSelectors" docs/code-patterns.md
```

Each name that the last command prints exists in the code (`grep -rn "<name>" apps/server/src eslint.config.js`).

**Done when.** The four files hold the rules above; Prettier passes; the styleguide is at or below 1000 lines.

**Out of scope.** Docs of the log store, rotation and alerts (E8a, E8b).

## Step 2 — Known alerts and the deploy runbook

**Goal.** An operator who sees an event line finds its entry by the event code, and reads the JSON log on the VPS with one command.

**Files.** Change: `docs/known-alerts.md`, `deploy/README.md`.

**Interfaces.**

`docs/known-alerts.md`:

- Under the intro line "When you find the cause of a new alert, add an entry below (newest first).", add: "Since F089, a log line is an event: key a new entry by its `event` code (and the field that tells the cases apart, for example `reason=`). An old heading keeps its old text in parentheses, so a search for an old log line still finds it."
- Change the template heading to ``### `<event code>` (or the exact alert text, or its stable part)``.
- Rename these 16 headings and fix the "Source" line of each when it quotes the old text or `cleanLogText`. Keep the rest of each entry:

| Old heading (stable part)                                                                                         | New heading                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pwned check unavailable: <status\|name\|no range lines in the answer>`                                           | `` `pwned_check_unavailable` (`status=`, `reason=no_range_lines`, `error=`; before F089: `pwned check unavailable: …`) ``                                                                                           |
| `web: lockout: <label>` and `web: terms record failed for user <id>: <label>`                                     | `` `lockout_failed`, `terms_record_failed` (before F089: `web: lockout: …`, `web: terms record failed …`) `` and keep a note that `web.ts` still writes `web: terms record failed for user <id>: <label>` until E8a |
| `web: home path failed: <label>`                                                                                  | `` `home_path_failed` (before F089: `web: home path failed: …`) ``                                                                                                                                                  |
| `mail: MAIL_ALLOW_LOCAL_HOSTS=true: local mail hosts are allowed`                                                 | `` `mail_local_hosts_allowed` (before F089: `mail: MAIL_ALLOW_LOCAL_HOSTS=true: …`) ``                                                                                                                              |
| `web: dist folder missing, pages are off`                                                                         | `` `web_dist_missing` (before F089: `web: dist folder missing, pages are off`) ``                                                                                                                                   |
| `web: reset requested for user <id>`                                                                              | `` `password_reset_requested` (before F089: `web: reset requested for user <id>`) ``                                                                                                                                |
| `better-auth: Invalid password`                                                                                   | `` `better_auth_log reason=invalid_password` (before F089: `better-auth: Invalid password`) ``                                                                                                                      |
| `better-auth: User not found`                                                                                     | `` `better_auth_log reason=user_not_found` (before F089: …) ``                                                                                                                                                      |
| `better-auth: Reset Password: User not found`                                                                     | `` `better_auth_log reason=reset_user_not_found` (before F089: …) ``                                                                                                                                                |
| `better-auth: Invalid callbackURL: <url>`                                                                         | `` `better_auth_log reason=invalid_callback_url` (before F089: …) ``                                                                                                                                                |
| `better-auth: Invalid origin: <url>`                                                                              | `` `better_auth_log reason=invalid_origin` (before F089: …) ``                                                                                                                                                      |
| `better-auth: Database schema mismatch … Missing tables …` and `GET /api/auth/*: BetterAuthError SCHEMA_MISMATCH` | `` `better_auth_log reason=schema_mismatch` and `http_error route=/api/auth/* error=BetterAuthError error_code=SCHEMA_MISMATCH` (before F089: …) ``                                                                 |
| `better-auth: Rate limiting could not determine a client IP …`                                                    | `` `better_auth_log reason=rate_limit_no_ip` (before F089: …) ``                                                                                                                                                    |
| `web: user <id> has <n> memberships; using the oldest`                                                            | `` `tenant_multi_membership` (before F089: `web: user <id> has <n> memberships; …`) ``                                                                                                                              |
| `web: onEvent <kind> failed: <label>`                                                                             | `` `auth_event_failed` (before F089: `web: onEvent <kind> failed: …`) ``                                                                                                                                            |
| `POST /api/… 403` bursts in the debug access log (`bad_origin`)                                                   | `` `http_request method=POST status=403` bursts at level debug (`bad_origin`; before F089: `POST /api/… 403`) ``                                                                                                    |

Write the "before F089" part in full where the table says `…`: copy the old heading text. The entry `# SERVER_ERROR: <message and stack>` stays; in its "Source" and "Fix" lines, `better-auth: <text>` becomes `better_auth_error` or `better_auth_log`. If stages 05 or 06 gave a line another code than this table (their final messages list it), use the code in the code.

`deploy/README.md`:

- In "First install" step 3, after `LOG_LEVEL=info` in the list item, add: "Leave `LOG_FORMAT` unset: Compose pins `json`."
- Replace the body of `## Logs` with:

````md
The server writes one JSON object per line (ADR 0024). Read them as text:

```sh
$C logs --no-log-prefix --since 1h server | jq -rR 'fromjson? | [.time, .level, "[\(.module)]", (if .event == "legacy_text" then .msg else .event end), (del(.time, .level, .module, .event, .msg) | to_entries | map("\(.key)=\(.value)") | join(" "))] | join(" ")'
```

Follow one job run or one request: add `| grep <run_id or request_id>`; the browser shows the request id in the `x-request-id` response header. A CLI prints the text form with `$C exec -e LOG_FORMAT=text server bun run <script> …`.

A good start shows `server_listening port=8080`. Module lines that E8a has not converted yet show their old text (`sync <mailbox id> <mode>: fetched …`).
````

Probe P7 of this plan (jq 1.8.2, 2026-11-13): the jq program prints `2026-11-20T10:00:00.000Z info [mail] sync_done run_id=r1 count=3` for an event line, the old text for a `legacy_text` line, and skips a line that is not JSON.

**Decisions.** D9, D20, D21; ADR 0024 point 7.

**Test.** None (docs).

**Check.**

```
bunx prettier --check docs/known-alerts.md deploy/README.md
grep -c "before F089" docs/known-alerts.md
```

The count is at least 16.

**Done when.** The 16 headings and the runbook section are changed; Prettier passes.

**Out of scope.** `deploy/logs.sh`, log rotation (`logging:` keys in Compose), the log store (E8a, E8b). Entries of module lines (E8a renames them when it converts them).

## Stage done when

- Steps 1 and 2 are done.
- The Proof of `plan.md` for stage 07 ends with `PROOF_OK`, with `<files>` = `docs/code-patterns.md .agents/limen/styleguide.md docs/architecture.md docs/decisions/0024-structured-logs-and-operator-alerts.md docs/known-alerts.md deploy/README.md`.
