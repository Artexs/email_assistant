# F103 stage 05 — Convert channels (without Telegram)

Part of [`../plan.md`](../plan.md). Review job before the land (Telegram errors can hold the bot token). Needs stage 01 landed.

Three steps.

## Step 1 — `telegramErrorFields`

**Goal.** Telegram errors reach an event line as fields, never as text (D7).

**Files.** `apps/server/src/modules/channels/telegram/errors.ts`, its test `errors.test.ts` (create it if it does not exist; else add cases), `apps/server/src/modules/channels/index.ts` only if a caller outside `channels/` needs it (none at `0a5c2ee`).

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

(Build the grammY errors the way the existing tests of `errors.ts` or `telegram-logs.test.ts` build them.)

**Check.** `bun test apps/server/src/modules/channels/telegram/`.

**Done when.** The three cases pass.

## Step 2 — Convert 36 calls

**Goal.** Every log call in `modules/channels/` outside `telegram/` is an event (D5, D6, D7).

**New field names** (add to `platform/log-fields.ts`): number `wait_ms`; uuid `item_id`, `approval_set_id`; code `slot`, `command`.

**Table** (file, line at `0a5c2ee`, old text start → level, event, fields). `outboxLog` = `log.with({ outbox_id: row.id })`, made once per row in the send loop of `sender.ts`.

| File:line | Old text | Level | Event | Fields |
| --- | --- | --- | --- | --- |
| sender.ts:60 | `outbox ${id}: database call failed` | error | `outbox_db_failed` | `outbox_id`, `...errorFields` |
| sender.ts:91 | `outbox claim failed` | error | `outbox_claim_failed` | `...errorFields` |
| sender.ts:113 | `sent again after a stale send` | warn | `outbox_resent_after_stale` | (outboxLog) |
| sender.ts:117 | `: expired` | warn | `outbox_expired` | (outboxLog) |
| sender.ts:133 | `bad view (${row.kind})` | error | `outbox_bad_view` | `kind` |
| sender.ts:152 | `the member has no chat` | warn | `outbox_no_chat` | (outboxLog) |
| sender.ts:169 | `lost the claim after the send` | warn | `outbox_claim_lost` | (outboxLog) |
| sender.ts:171 | `sent ${row.kind}` | info | `outbox_sent` | `kind` |
| sender.ts:180 | `rate limited; sending paused` | warn | `outbox_rate_limited` | `wait_ms` |
| sender.ts:191 | `${error.code}; sending paused` | warn | `outbox_paused` | `code`, `wait_ms` |
| sender.ts:199 | `telegram token rejected (401)` | error | `outbox_token_rejected` | — |
| sender.ts:204 | `the user blocked the bot (403)` | warn | `outbox_bot_blocked` | (outboxLog) |
| sender.ts:208 | `Telegram refused the message` | error | `outbox_refused` | `code` |
| sender.ts:216 | `outbox ${row.id}: ${error.code}` | error | `outbox_failed` | `code` |
| sender.ts:224 | `outbox ${row.id}: ${describeError}` | error | `outbox_failed` | `...errorFields` |
| operator.ts:62 | `operator notice ${kind}: ${text}` | warn | `operator_notice_unsent` | `kind` (the text is dropped; the audit row keeps it) |
| operator.ts:79, :102 | `operator notice ${kind}: ${describeError}` | error | `operator_notice_failed` | `kind`, `...errorFields` |
| operator.ts:88 | `operator notice ${kind} failed: ${telegramErrorLabel}` | error | `operator_notice_send_failed` | `kind`, `...telegramErrorFields` |
| operator.ts:132, :148, :185, :199 | `operator notice <kind>: ${describeError}` | error | `operator_notice_failed` | `kind: "<kind>"`, `...errorFields` |
| operator.ts:168 | `operator notice run:` | error | `operator_notices_failed` | `...errorFields` |
| notices/index.ts:75 | `notices for org ${orgId} failed` | error | `notices_org_failed` | `org_id`, `...errorFields` |
| notices/index.ts:79 | `notices failed` | error | `notices_failed` | `...errorFields` |
| notices/run.ts:52 | `notice ${kind} ${id}: skipped` | warn | `notice_skipped` | `kind`, `item_id: id`, `...errorFields` |
| notices/run.ts:66 | `notice ${kind} queued: outbox ${id}` | info | `notice_queued` | `kind`, `outbox_id` |
| digest-job.ts:67 | `digest ${slot.key} queued for user` | info | `digest_queued` | `slot: slot.key`, `user_id`, `outbox_id` |
| digest-job.ts:78 | `digest for org … user … failed` | error | `digest_member_failed` | `org_id`, `user_id`, `...errorFields` |
| digest-job.ts:82 | `digests failed` | error | `digests_failed` | `...errorFields` |
| callbacks.ts:186 | `tap ${callback.kind} ${id} by user` | info | `tap_received` | `kind`, `user_id`, and `action_id`, `approval_set_id` or `delegation_id` by the callback's variant |
| commands.ts:275 | `telegram: org … suspended: ${name} refused` | info | `command_refused_suspended` | `org_id`, `command: name` |
| commands.ts:282 | `telegram: org … suspended: tap refused` | info | `tap_refused_suspended` | `org_id` |
| routes.ts:46 | `web: telegram getMe failed` | warn | `telegram_get_me_failed` | `...telegramErrorFields` |
| routes.ts:50 | `web: telegram link made for user` | info | `telegram_link_made` | `user_id` |

- `wait_ms` is the wait in milliseconds (the old text printed seconds).
- `notices/run.ts` keeps its once-per-process guard (`warnedRows`).
- `sendOrLog` in `operator.ts` keeps its behaviour: no chat → one warn line, no send.

**Decisions.** D2, D5, D6, D7, D16, D17.

**Test.**
1. Every test that matched an old text above now matches the event text. Find them: `grep -rn "outbox \|operator notice\|notice .* queued\|digest .* queued\|tap \|getMe failed\|link made\|suspended:" apps/server/test apps/server/src --include=*.test.ts`. At least `channels-sender.test.ts`, `channels-operator.test.ts`, `channels-notices.test.ts`, `channels-digest-job.test.ts`, `channels-callbacks.test.ts`, `telegram-logs.test.ts`, `web-telegram.test.ts` may match.
2. New case in `channels-operator.test.ts`: with no operator chat, a notice whose text holds `MARKER-NOTICE-TEXT` writes one `operator_notice_unsent kind=<kind>` line, and no captured line holds `MARKER`.
3. New case in `channels-sender.test.ts`: a rate-limited send (the existing 429 case) writes `outbox_rate_limited outbox_id=<id> wait_ms=<n>` with the fixed `now` of the test.

**Check.** `bun test apps/server/src/modules/channels apps/server/test/integration/channels-*.test.ts apps/server/test/integration/telegram-logs.test.ts apps/server/test/integration/web-telegram.test.ts`.

**Done when.** `bun run lint` shows no `no-restricted-syntax` message for `modules/channels/` outside `telegram/`; the tests pass.

## Step 3 — Lint level and known alerts

**Files.**
- `eslint.config.js`: add `"apps/server/src/modules/channels/*.ts"` and `"apps/server/src/modules/channels/notices/**/*.ts"` to the `files` of the `error` block. If `modules/channels/` has other subfolders besides `telegram/`, `notices/` and `fake/` at your base commit, add them too (`fake/` has no log call at `0a5c2ee`; add it).
- `log-lint.test.ts`: one case: `log.info(\`x ${y}\`);` in `apps/server/src/modules/channels/__log-fixture.ts` (import path `"../../platform/log"`) gives `[2]`.
- `docs/known-alerts.md`: every entry that quotes a converted line gets the event code in its heading (D17), for example `### \`outbox <id>: lost the claim after the send\`` → `### \`outbox_claim_lost\``. The entry text keeps its meaning; a sentence that quotes the old text quotes the event and its fields.

**Check.** `grep -n "outbox <id>\|operator notice \|notice .* queued\|digest for org\|getMe failed" docs/known-alerts.md` shows no heading with an old text.

**Done when.** The lint case passes; the Proof of `plan.md` (`/tmp/f103-s05`) prints `PROOF_OK`; the final message gives the `no-restricted-syntax` warning count and lists each new field name and each call that was not in the table.

**Out of scope.** `modules/channels/telegram/` (stage 06).
