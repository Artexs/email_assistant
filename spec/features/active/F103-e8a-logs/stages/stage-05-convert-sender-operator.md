# F103 stage 05 — `telegramErrorFields`; convert the outbox sender and operator notices

Part of [`../plan.md`](../plan.md). Review job before the land (Telegram errors can hold the bot token). Needs stage 01 landed.

Three steps.

## Step 1 — `telegramErrorFields`

**Goal.** Telegram errors reach an event line as fields, never as text (D7).

**Interfaces** (`apps/server/src/modules/channels/telegram/errors.ts`, test `errors.test.ts`, new):

```ts
/** Event fields of a Telegram client error: never the description, the payload or an inner error (they can hold the token). */
export function telegramErrorFields(error: unknown): { error: string; error_code?: string | number; method?: string };
```

- `GrammyError` → `{ error: "GrammyError", error_code: error.error_code, method: error.method }`.
- `HttpError` → `{ error: "HttpError", method }`, `method` from the same regex as `telegramErrorLabel`, or `{ error: "HttpError" }` without a match.
- Else `errorFields(error)`.

**Test.**

1. A `GrammyError` for `sendMessage`, code 403, description `"Forbidden: bot was blocked by MARKER-DESC"` → `{ error: "GrammyError", error_code: 403, method: "sendMessage" }`; `JSON.stringify` of it has no `MARKER`.
2. An `HttpError` with message `"Network request for 'getUpdates' failed!"` and an inner error with `https://api.telegram.org/bot123:MARKER/getUpdates` → `{ error: "HttpError", method: "getUpdates" }`; no `MARKER`.
3. `new Error("MARKER")` → `{ error: "Error" }`.

**Done when.** The three cases pass.

## Step 2 — Convert 26 calls in `channels/sender.ts` and `channels/operator.ts`

**Goal.** Every log call in these two files is an event (D5, D6, D7).

**New field name:** number `wait_ms` (the wait in milliseconds; the old text printed seconds).

**Child.** `outboxLog = log.with({ outbox_id: row.id })`, once per row in the send loop.

Old text (start) → event: fields. Levels stay.

- `outbox ${id}: database call failed` → `outbox_db_failed`: `outbox_id`, `...errorFields`
- `outbox claim failed` → `outbox_claim_failed`: `...errorFields`
- `sent again after a stale send` → `outbox_resent_after_stale`: (outboxLog)
- `: expired` → `outbox_expired`: (outboxLog)
- `bad view (${row.kind})` → `outbox_bad_view`: `kind`
- `the member has no chat` → `outbox_no_chat`: (outboxLog)
- `lost the claim after the send` → `outbox_claim_lost`: (outboxLog)
- `sent ${row.kind}` → `outbox_sent`: `kind`
- `rate limited; sending paused` → `outbox_rate_limited`: `wait_ms`
- `${error.code}; sending paused` → `outbox_paused`: `code`, `wait_ms`
- `telegram token rejected (401)` → `outbox_token_rejected`: —
- `the user blocked the bot (403)` → `outbox_bot_blocked`: (outboxLog)
- `Telegram refused the message` → `outbox_refused`: `code`
- `outbox ${row.id}: ${error.code}` → `outbox_failed`: `code`
- `outbox ${row.id}: ${describeError}` → `outbox_failed`: `...errorFields`
- `operator notice ${kind}: ${text}` → `operator_notice_unsent`: `kind` (text dropped; the audit row keeps it)
- `operator notice ${kind}: ${describeError}` (×2) → `operator_notice_failed`: `kind`, `...errorFields`
- `operator notice ${kind} failed: ${telegramErrorLabel}` → `operator_notice_send_failed`: `kind`, `...telegramErrorFields`
- `operator notice <kind>: ${describeError}` (`trial_ending`, `auth_error_24h`, `send_limit` ×2, `llm_cap`, `auth_mail_failed`) → `operator_notice_failed`: `kind: "<kind>"`, `...errorFields`
- `operator notice run:` → `operator_notices_failed`: `...errorFields`

Levels stay. `sendOrLog` keeps its behaviour: no chat → one warn line, no send.

**Decisions.** D2, D5, D6, D7, D16, D17.

**Test.**

1. Every test that matched an old text matches the event text (at least `channels-sender.test.ts`, `channels-operator.test.ts`, `telegram-logs.test.ts` may).
2. `channels-operator.test.ts`: with no operator chat, a notice whose text holds `MARKER-NOTICE-TEXT` writes one `operator_notice_unsent kind=<kind>` line, and no captured line holds `MARKER`.
3. `channels-sender.test.ts`: the existing 429 case writes `outbox_rate_limited outbox_id=<id> wait_ms=<n>` with the test's fixed `now`.

**Done when.** No `no-restricted-syntax` message in the two files; the tests pass.

## Step 3 — Lint level and known alerts

- `eslint.config.js`: add `channels/sender.ts` and `channels/operator.ts` to the `error` block (stage 07 replaces them with the folder).
- `log-lint.test.ts`: an old-form line at `apps/server/src/modules/channels/sender.ts` gives `[2]`.
- `docs/known-alerts.md` and `deploy/README.md` by D17. Known quotes: `lost the claim after the send`, `operator notice auth_mail_failed`, `telegram token rejected`.

**Done when.** No old text of the table in either doc; the Proof (`/tmp/f103-s05`) prints `PROOF_OK`; the final message gives the warning count, new field names and calls not in the table.

**Out of scope.** The other files of `modules/channels/` (stages 06, 07).
