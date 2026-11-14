# F103 stage 05 — `telegramErrorFields`; convert the outbox sender and operator notices

Part of [`../plan.md`](../plan.md). Review job before the land (Telegram errors can hold the bot token). Needs stage 01 landed.

Three steps.

## Step 1 — `telegramErrorFields`

**Goal.** Telegram errors reach an event line as fields, never as text (D7).

**Files.** `apps/server/src/modules/channels/telegram/errors.ts`, its test `apps/server/src/modules/channels/telegram/errors.test.ts` (new at `0a5c2ee`; add cases if it exists by then).

**Interfaces.**

```ts
/** Event fields of a Telegram client error: never the description, the payload or an inner error (they can hold the token). */
export function telegramErrorFields(error: unknown): { error: string; error_code?: string | number; method?: string };
```

- `GrammyError` → `{ error: "GrammyError", error_code: error.error_code, method: error.method }`.
- `HttpError` → `{ error: "HttpError", method }` with `method` from the same regex as `telegramErrorLabel`, or `{ error: "HttpError" }` when it does not match.
- Else `errorFields(error)` from `platform/errors.ts`.

**Test.**

1. A `GrammyError` for `sendMessage` with code 403 and description `"Forbidden: bot was blocked by MARKER-DESC"` → `{ error: "GrammyError", error_code: 403, method: "sendMessage" }`; `JSON.stringify` of the result has no `MARKER`.
2. An `HttpError` with message `"Network request for 'getUpdates' failed!"` and an inner error whose message holds `https://api.telegram.org/bot123:MARKER/getUpdates` → `{ error: "HttpError", method: "getUpdates" }`; no `MARKER` in the result.
3. `new Error("MARKER")` → `{ error: "Error" }`.

(Build the grammY errors the way `telegram-logs.test.ts` or the tests of `api.ts` build them.)

**Check.** `bun test apps/server/src/modules/channels/telegram/`.

**Done when.** The three cases pass.

## Step 2 — Convert 24 calls in `sender.ts` and `operator.ts`

**Goal.** Every log call in `modules/channels/sender.ts` and `modules/channels/operator.ts` is an event (D5, D6, D7).

**New field names** (`platform/log-fields.ts`, each only if it is not there yet): number `wait_ms`.

**Table** (line of the call's first line at `0a5c2ee`; match by text, D16). `outboxLog` = `log.with({ outbox_id: row.id })`, made once per row in the send loop.

| File:line                         | Old text                                                | Level | Event                         | Fields                                               |
| --------------------------------- | ------------------------------------------------------- | ----- | ----------------------------- | ---------------------------------------------------- |
| sender.ts:60                      | `outbox ${id}: database call failed`                    | error | `outbox_db_failed`            | `outbox_id`, `...errorFields`                        |
| sender.ts:91                      | `outbox claim failed`                                   | error | `outbox_claim_failed`         | `...errorFields`                                     |
| sender.ts:113                     | `sent again after a stale send`                         | warn  | `outbox_resent_after_stale`   | (outboxLog)                                          |
| sender.ts:117                     | `: expired`                                             | warn  | `outbox_expired`              | (outboxLog)                                          |
| sender.ts:133                     | `bad view (${row.kind})`                                | error | `outbox_bad_view`             | `kind`                                               |
| sender.ts:152                     | `the member has no chat`                                | warn  | `outbox_no_chat`              | (outboxLog)                                          |
| sender.ts:169                     | `lost the claim after the send`                         | warn  | `outbox_claim_lost`           | (outboxLog)                                          |
| sender.ts:171                     | `sent ${row.kind}`                                      | info  | `outbox_sent`                 | `kind`                                               |
| sender.ts:180                     | `rate limited; sending paused`                          | warn  | `outbox_rate_limited`         | `wait_ms`                                            |
| sender.ts:191                     | `${error.code}; sending paused`                         | warn  | `outbox_paused`               | `code`, `wait_ms`                                    |
| sender.ts:199                     | `telegram token rejected (401)`                         | error | `outbox_token_rejected`       | —                                                    |
| sender.ts:204                     | `the user blocked the bot (403)`                        | warn  | `outbox_bot_blocked`          | (outboxLog)                                          |
| sender.ts:208                     | `Telegram refused the message`                          | error | `outbox_refused`              | `code`                                               |
| sender.ts:216                     | `outbox ${row.id}: ${error.code}`                       | error | `outbox_failed`               | `code`                                               |
| sender.ts:224                     | `outbox ${row.id}: ${describeError}`                    | error | `outbox_failed`               | `...errorFields`                                     |
| operator.ts:62                    | `operator notice ${kind}: ${text}`                      | warn  | `operator_notice_unsent`      | `kind` (the text is dropped; the audit row keeps it) |
| operator.ts:79, :102              | `operator notice ${kind}: ${describeError}`             | error | `operator_notice_failed`      | `kind`, `...errorFields`                             |
| operator.ts:88                    | `operator notice ${kind} failed: ${telegramErrorLabel}` | error | `operator_notice_send_failed` | `kind`, `...telegramErrorFields`                     |
| operator.ts:132, :148, :185, :199 | `operator notice <kind>: ${describeError}`              | error | `operator_notice_failed`      | `kind: "<kind>"`, `...errorFields`                   |
| operator.ts:168                   | `operator notice run:`                                  | error | `operator_notices_failed`     | `...errorFields`                                     |

- `sender.ts:180` starts a two-line call (`log.warn(` on 180, the text on 181).
- `wait_ms` is the wait in milliseconds (the old text printed seconds).
- `sendOrLog` in `operator.ts` keeps its behaviour: no chat → one warn line, no send.

**Decisions.** D2, D5, D6, D7, D16, D17.

**Test.**

1. Every test that matched an old text above now matches the event text: `grep -rn "outbox \|operator notice\|token rejected\|blocked the bot\|refused the message" apps/server/test apps/server/src --include=*.test.ts`. At least `channels-sender.test.ts`, `channels-operator.test.ts`, `telegram-logs.test.ts` may match.
2. New case in `channels-operator.test.ts`: with no operator chat, a notice whose text holds `MARKER-NOTICE-TEXT` writes one `operator_notice_unsent kind=<kind>` line, and no captured line holds `MARKER`.
3. New case in `channels-sender.test.ts`: a rate-limited send (the existing 429 case) writes `outbox_rate_limited outbox_id=<id> wait_ms=<n>` with the fixed `now` of the test.

**Check.** `bun test apps/server/src/modules/channels apps/server/test/integration/channels-sender.test.ts apps/server/test/integration/channels-operator.test.ts apps/server/test/integration/telegram-logs.test.ts`.

**Done when.** `bun run lint` shows no `no-restricted-syntax` message for `sender.ts` and `operator.ts`; the tests pass.

## Step 3 — Lint level and known alerts

**Files.**

- `eslint.config.js`: add `"apps/server/src/modules/channels/sender.ts"` and `"apps/server/src/modules/channels/operator.ts"` to the `files` of the `error` block (stage 07 replaces them with `channels/*.ts`).
- `log-lint.test.ts`: one case: ``log.info(`x ${y}`);`` with `filePath` `apps/server/src/modules/channels/sender.ts` (import path `"../../platform/log"`) gives `[2]`.
- `docs/known-alerts.md` and `deploy/README.md` by D17. Known matches at `0a5c2ee`: `known-alerts.md:135` and `:606` (`outbox <id>: lost the claim after the send`), `:215` (`operator notice auth_mail_failed`), `:646` (`telegram token rejected`). Run the per-row grep for the rest.

**Check.** The per-row grep of D17 finds no old text of this table in either file.

**Done when.** The lint case passes; the Proof of `plan.md` (`/tmp/f103-s05`) prints `PROOF_OK`; the final message gives the `no-restricted-syntax` warning count and lists each new field name and each call that was not in the table.

**Out of scope.** The other files of `modules/channels/` (stages 06, 07).
