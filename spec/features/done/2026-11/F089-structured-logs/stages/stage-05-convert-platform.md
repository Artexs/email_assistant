# F089 stage 05 — Convert the log lines of `platform/`

Part of [`../plan.md`](../plan.md). Read D7, D10, D12, D14, D19, D20 and D25 of `plan.md` first. Needs stages 01–04 landed. Two steps. A review job checks it before the land.

File gate (ticket § Sequenced): this stage edits `platform/http.ts` and `platform/llm/client.ts`. It never builds at the same time as F087 stage 4 or 5, or F090 stage 1.

Rule of the stage (D25): convert every `log.*` call in `apps/server/src/platform/**` (not in `*.test.ts`) that exists at your base commit. Start with `bunx eslint apps/server/src/platform 2>&1 | grep -B0 "no-restricted-syntax"` (the file name is on the line above each group) or with `grep -rn "log\.\(debug\|info\|warn\|error\)(" apps/server/src/platform --include=*.ts | grep -v "\.test\.ts"`. The tables hold 25 rows: the 24 calls of 2026-11-13 that the lint finds (the 2 scheduler calls went in stage 03) and the call at `auth.ts:444` that goes through a conditional, which the lint does not see. A call that is not in a table (a later ticket added it) gets an event code by the same rules; list each such call with its new form in the final message.

Event code rules: snake*case, at most 64 characters, `<thing>*<what happened>`; one code for one kind of line, also across files. Fields only from `logFieldNames` (`platform/log-fields.ts`); a field that a line needs and the list lacks is a question, not an addition (report it). Errors only as `...errorFields(error)`.

## Step 1 — `auth.ts` and `auth-mail.ts`

**Goal.** The auth lines are events with ids and codes only; the Better Auth library text becomes a reason code.

**Files.** Change: `apps/server/src/platform/auth.ts`, `auth.test.ts`, `auth-mail.ts`; `apps/server/test/integration/web-auth-logs.test.ts`, `web-auth.test.ts`, `web-reset-request.test.ts`, `web-terms.test.ts`.

**Interfaces.**

| File:line (2026-11-13)                   | Today                                                                                                | New                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `auth-mail.ts:93`                        | ``log.warn(`${label} to user ${mail.userId} failed: TIMEOUT`)``                                      | `log.warn("auth_mail_failed", { kind: mail.kind, user_id: mail.userId, code: "TIMEOUT" })`             |
| `auth-mail.ts:99`                        | ``log.info(`${label} sent to user ${mail.userId}`)``                                                 | `log.info("auth_mail_sent", { kind: mail.kind, user_id: mail.userId })`                                |
| `auth-mail.ts:103`                       | ``log.warn(`${label} to user ${mail.userId} failed: ${code}`)``                                      | `log.warn("auth_mail_failed", { kind: mail.kind, user_id: mail.userId, code })`                        |
| `auth-mail.ts:136`                       | ``log.error(`auth mail ${mail.kind} task for user ${mail.userId} failed: ${describeError(error)}`)`` | `log.error("auth_mail_task_failed", { kind: mail.kind, user_id: mail.userId, ...errorFields(error) })` |
| `auth.ts:128` (`onAuthError`)            | ``log.error(`better-auth: ${cleanLogText(describeError(error))}`)``                                  | `log.error("better_auth_error", { ...errorFields(error) })`                                            |
| `auth.ts:269`                            | ``log.error(`web: onEvent ${kind} failed: ${describeError(error)}`)``                                | `log.error("auth_event_failed", { kind, ...errorFields(error) })`                                      |
| `auth.ts:298`                            | ``log.info(`web: reset requested for user ${user.id}`)``                                             | `log.info("password_reset_requested", { user_id: user.id })`                                           |
| `auth.ts:305`                            | ``log.error(`web: lockout clear failed: ${describeError(error)}`)``                                  | `log.error("lockout_clear_failed", { ...errorFields(error) })`                                         |
| `auth.ts:311`                            | ``log.error(`web: terms record failed for user ${user.id}: ${describeError(error)}`)``               | `log.error("terms_record_failed", { user_id: user.id, ...errorFields(error) })`                        |
| `auth.ts:378`                            | `log.info("web: reset request over the address limit")`                                              | `log.info("reset_request_limited")`                                                                    |
| `auth.ts:397`                            | ``log.error(`web: lockout: ${describeError(error)}`)``                                               | `log.error("lockout_failed", { ...errorFields(error) })`                                               |
| `auth.ts:444` (Better Auth `logger.log`) | ``(level === "error" ? log.error : log.warn)(`better-auth: ${text}`)``                               | see below                                                                                              |

The label variable `label` of `auth-mail.ts` goes away if nothing else uses it. `kind` values are `invite`, `reset`, `lockout` (codes, allowed).

The Better Auth logger (D20). Replace `cleanLogText` with:

```ts
// D20: Better Auth logs library text; only a fixed code reaches our log. Message starts from docs/known-alerts.md.
const BETTER_AUTH_REASONS: readonly (readonly [string, string])[] = [
  ["Reset Password: User not found", "reset_user_not_found"],
  ["Invalid password", "invalid_password"],
  ["User not found", "user_not_found"],
  ["Invalid callbackURL", "invalid_callback_url"],
  ["Invalid origin", "invalid_origin"],
  ["Database schema mismatch", "schema_mismatch"],
  ["Rate limiting could not determine a client IP", "rate_limit_no_ip"],
];

export function betterAuthLogReason(message: unknown): string {
  if (typeof message !== "string") return "other";
  return BETTER_AUTH_REASONS.find(([start]) => message.startsWith(start))?.[1] ?? "other";
}
```

and the hook body:

```ts
      log: (level, message, ...args) => {
        const fields = { reason: betterAuthLogReason(message), ...(args[0] instanceof Error ? errorFields(args[0]) : {}) };
        if (level === "error") log.error("better_auth_log", fields);
        else log.warn("better_auth_log", fields);
      },
```

Remove `cleanLogText`, its `CONTROL_CHARACTERS` and `URL_RUN` constants (check with `grep -rn cleanLogText apps/` that no other file uses them) and its 4 tests.

**Decisions.** D14, D20, D25.

**Test.**

1. `auth.test.ts`: replace `describe("cleanLogText", …)` with `describe("betterAuthLogReason", …)`, a `test.each`: `"Invalid password"` → `invalid_password`; `"User not found"` → `user_not_found`; `"Reset Password: User not found"` → `reset_user_not_found`; `"Invalid callbackURL: https://evil.test/a?b=c"` → `invalid_callback_url`; `"Invalid origin: https://evil.test"` → `invalid_origin`; `"Database schema mismatch. Missing tables: x"` → `schema_mismatch`; `"Rate limiting could not determine a client IP address"` → `rate_limit_no_ip`; `"Something new for x@y.test"` → `other`; `new Error("e")` → `other`.
2. `auth.test.ts` `onAuthError`: the two tests that read `lines[0]` now expect `better_auth_error` and `error=APIError` (and `error=TypeError`), and still not `MARKER-DETAIL`. The "logs nothing" tests stay.
3. `web-auth-logs.test.ts:164–166`: expect a line with `password_reset_requested user_id=${userId}` and a line with `better_auth_log reason=invalid_password`. The loop at line 168 that checks every `user (\S+)` match becomes `user_id=(\S+)` with the same UUID check, and it must find at least one match (add `expect(found).toBeGreaterThan(0)`).
4. `web-auth.test.ts:279`: expect a line with `auth_event_failed kind=login error=Error`; `boom` is still absent.
5. `web-reset-request.test.ts:219`: expect a line with `reset_request_limited`; the address is still absent.
   5a. `web-terms.test.ts:225`: the filter `line.includes("terms record")` becomes `line.includes("terms_record_failed")`; still exactly 1 line, with the user id, without the address and without `@` (review 1 M4).

**Check.**

```
bun test apps/server/src/platform/auth.test.ts apps/server/src/platform/auth-mail.test.ts
bun test apps/server/test/integration/web-auth-logs.test.ts apps/server/test/integration/web-auth.test.ts apps/server/test/integration/web-reset-request.test.ts apps/server/test/integration/web-terms.test.ts apps/server/test/integration/web-lockout.test.ts apps/server/test/integration/auth-mail.test.ts
```

**Done when.** Tests 1–5a pass; `grep -rn "cleanLogText" apps/` prints nothing. Before the commit, grep the test folders for the other old texts of the step 1 table (`grep -rn "web: lockout\|sent to user\|task for user\|terms record\|reset requested\|onEvent\|better-auth:" apps/server/test apps/server/src --include=*.test.ts`) and fix any hit that the list above lacks.

**Out of scope.** `web.ts` lines (`web: audit … failed`, `web: terms record failed` in `web.ts:91`): a root, E8a.

## Step 2 — `http.ts`, `heartbeat.ts`, `pwned.ts`, `llm/client.ts`

**Goal.** The other platform lines are events; the two lines that printed `error.message` or a status text print codes only.

**Files.** Change: `apps/server/src/platform/http.ts`, `heartbeat.ts`, `pwned.ts`, `llm/client.ts`; `http.test.ts`, `pwned.test.ts`; `apps/server/test/integration/web-http.test.ts`, `web-onboarding.test.ts`. Check `llm/client.test.ts`, `heartbeat.test.ts` and `test/integration/triage-logs.test.ts` (they should pass unchanged).

**Interfaces.**

| File:line (2026-11-13) | Today                                                                                                       | New                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `http.ts:211`          | ``log.warn(`web: user ${userId} has ${rows.length} memberships; using the oldest`)``                        | `log.warn("tenant_multi_membership", { user_id: userId, count: rows.length })`                                                              |
| `http.ts:253`          | ``log.warn(`web: home path failed: ${describeError(error)}`)``                                              | `log.warn("home_path_failed", { ...errorFields(error) })`                                                                                   |
| `http.ts:267`          | ``log.debug(`${c.req.method} ${routePath(c)} ${c.res.status} ${Math.round(performance.now() - start)}ms`)`` | `log.debug("http_request", { method: c.req.method, route: routePath(c), status: c.res.status, ms: Math.round(performance.now() - start) })` |
| `http.ts:293`          | ``log.error(`${c.req.method} ${routePath(c)}: ${describeError(error)}`)``                                   | `log.error("http_error", { method: c.req.method, route: routePath(c), ...errorFields(error) })`                                             |
| `http.ts:329`          | `log.warn("web: dist folder missing, pages are off")`                                                       | `log.warn("web_dist_missing")`                                                                                                              |
| `heartbeat.ts:25`      | `log.warn("no ping: the DB does not answer")`                                                               | `log.warn("heartbeat_db_down")`                                                                                                             |
| `heartbeat.ts:29`      | ``log.warn(`ping failed: status ${response.status}`)``                                                      | `log.warn("heartbeat_ping_failed", { status: response.status })`                                                                            |
| `heartbeat.ts:31`      | `log.warn("ping failed:", error instanceof Error ? error.message : String(error))`                          | `log.warn("heartbeat_ping_failed", { ...errorFields(error) })` (a fetch error message can hold the secret URL)                              |
| `pwned.ts:32`          | ``log.warn(`pwned check unavailable: status ${response.status}`)``                                          | `log.warn("pwned_check_unavailable", { status: response.status })`                                                                          |
| `pwned.ts:47`          | `log.warn("pwned check unavailable: no range lines in the answer")`                                         | `log.warn("pwned_check_unavailable", { reason: "no_range_lines" })`                                                                         |
| `pwned.ts:53`          | ``log.warn(`pwned check unavailable: ${code}`)``                                                            | `log.warn("pwned_check_unavailable", { ...errorFields(error) })` (the local `code` variable goes away)                                      |
| `llm/client.ts:134`    | ``log.debug(`ok model=${model} latencyMs=… tokensIn=… tokensOut=…`)``                                       | `log.debug("llm_call_ok", { model, ms: usage.latencyMs, tokens_in: usage.tokensIn, tokens_out: usage.tokensOut })`                          |
| `llm/client.ts:140`    | ``log.debug(`failed model=${model} code=${llmError.code}`)``                                                | `log.debug("llm_call_failed", { model, code: llmError.code })`                                                                              |

A route path like `/api/mailboxes/:id` or `/api/auth/*` and a model name like `gemini-3.5-flash-lite` pass D7 (`*` is in the set for `routePath`, P8). A model name with a character outside D7 would be dropped and counted; that is the intended guard, not a bug.

Remove `describeError` from the imports of a file when no line uses it.

**Decisions.** D7, D14, D25.

**Test.**

6. `http.test.ts:216`: the line filter becomes `line.includes("tenant_multi_membership user_id=u-multi count=2")`, still exactly 1 line for two requests.
7. `pwned.test.ts:102–104`: expect a line with `pwned_check_unavailable`, a line with `status=503`, and a line with `error=TimeoutError`; the loop that checks for no password, prefix or hash stays.
8. `web-http.test.ts:148`: expect `home_path_failed`; `web-http.test.ts:393`: expect `web_dist_missing`; `web-onboarding.test.ts:284–286`: filter on `home_path_failed`, still 1 line.
9. `llm/client.test.ts` "a 503 writes one debug line …" passes unchanged (the joined line starts with `[llm]` and has `code=http_503` and the model). "a good call writes one debug line with model, latency and tokens" (`client.test.ts:247–255`) now expects `tokens_in=7` and `tokens_out=3` instead of `tokensIn=7` and `tokensOut=3`. If any other `client.test.ts` or `openai.test.ts` assertion reads the old text (`latencyMs=`, `ok model=`), change it to the new keys (`ms=`, `llm_call_ok`).
10. `triage-logs.test.ts` passes unchanged: its `call[0] === "[llm]"` filter still finds the debug lines (D12), and no marker is in the output.
11. A new test in `heartbeat.test.ts`: a `fetch` that throws `new TypeError("MARKER-URL https://hc.test/secret")` → one `console.error` line that contains `heartbeat_ping_failed` and `error=TypeError` and not `MARKER-URL` and not `hc.test`.

**Check.**

```
bun test apps/server/src/platform
bun test apps/server/test/integration/web-http.test.ts apps/server/test/integration/web-onboarding.test.ts apps/server/test/integration/triage-logs.test.ts
mkdir -p /tmp/f089-s05 && bunx eslint apps/server/src/platform > /tmp/f089-s05/lint-platform.log 2>&1; grep -c "no-restricted-syntax" /tmp/f089-s05/lint-platform.log
```

The last count is `0`: no old-form line is left in `platform/`.

**Done when.** Tests 6–11 pass; the last count is `0`. Before the commit, grep the test folders for the old texts of the step 2 table (`grep -rn "memberships; using\|home path failed\|dist folder missing\|ping failed\|no ping\|pwned check unavailable\|latencyMs=\|tokensIn=\|ok model=" apps/server/test apps/server/src --include=*.test.ts`) and fix any hit that the list above lacks.

**Out of scope.** `main.ts` and the `error` level (stage 06). Module code, `web.ts`, `composition.ts`, `retention.ts`, scripts (E8a). Docs and `docs/known-alerts.md` (stage 07).

## Stage done when

- Steps 1 and 2 are done; the final message lists any call that was not in the tables, with its new form.
- The Proof of `plan.md` ends with `PROOF_OK` (`NN` = `05`).
- A review job checks the stage before the land (plan § Review): no free text, no `error.message`, no URL in a converted line; each changed test still checks for the absence of its markers.

## Decision recorded (2026-11-13, coordinator)

`role` joins `logFieldNames` (values are the closed set of LLM roles, D7 holds). `llm_call_ok` and `llm_call_failed` carry `role: call.role`; F090 stage 3 had put `role=` in those lines and `client-roles.test.ts` checks `role=judge`.
