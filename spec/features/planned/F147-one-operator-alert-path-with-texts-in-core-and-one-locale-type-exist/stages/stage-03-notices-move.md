# F147 stage 03 — event notices in the operator module [risky]

Needs stage 01: `OperatorEvent`, `operatorEventKey`, `renderOperatorEvent`, `OperatorEventKind` in `@ea/core` (`packages/core/src/ops/`). May run next to 02.
Part of [`../plan.md`](../plan.md). Review: Opus, before the land (dedup keys of sent notices).

## Goal

The five event notices live in the operator module and build each notice from a core `OperatorEvent`: the key from `operatorEventKey`, the text from `renderOperatorEvent`. `apps/server/src/modules/channels/operator.ts` is gone. Behaviour, keys, texts, log lines and the audit row stay exactly as at `HEAD` (D1, D3, D4, D8). Stage 04 changes the delivery and the log names.

## Step 1 — the move

- **File** `apps/server/src/modules/operator/notices.ts` (new; move the code with `git mv` so the history follows, then edit):
  ```ts
  export interface OperatorNoticeDeps {
    db: Db | Transaction<DB>;
    now: () => Date;
    send: ((text: string) => Promise<void>) | null;
    locale: UserLocale; // required (D13)
  }
  export interface OperatorNoticeHooks { /* the HEAD OperatorNotices methods, same signatures: run, capReached, authMailFailed, sendLimitReached, idle */ }
  export function createOperatorNotices(deps: OperatorNoticeDeps): OperatorNoticeHooks;
  ```
  The interface is renamed from `OperatorNotices` because `@ea/core` exports a console type of that name, which `operator/service.ts` already uses. `OperatorNoticeKind` goes; use `OperatorEventKind`.
- Each detector and hook builds an `OperatorEvent`, its key (`operatorEventKey`) and its text (`renderOperatorEvent`) inside its own synchronous `try`, as at `HEAD`, so an invalid date logs `operator_notice_failed` and never rejects a promise. `notify` takes the context, kind, key and text, as at `HEAD`. The retry map keeps the `HEAD` shape.
- The dedup stays: in-memory `doneKeys` and `inFlight`, then `hasAuditKey(…, auditEvents.operatorNotice, key)`, then the send, then `recordAudit` with `data: { kind, key }` in the organization of the event. Send first, row second.
- `operator/index.ts` exports `createOperatorNotices`, `OperatorNoticeDeps`, `OperatorNoticeHooks`. The `channels` index drops the old names and exports `telegramErrorFields` (the notices log Telegram errors with it).
- Wiring: the composition root that builds the notices (`main.ts`, or `start/operator.ts` if the start-up split of F143 stage 12 has landed) imports from `./modules/operator`. Update the source pin in `main.test.ts` (or the `startSource()` test) to the new import; the pinned shape stays.
- Run `bun run graph:modules` (the edge `operator → channels` stays; check `layers.json` needs no change) and commit its output.

## Test

Fixed values as in stage 01 (`ORG`, `BOX`, `USER`, `AT`).

1. Move `apps/server/test/integration/channels-operator.test.ts` to `apps/server/test/integration/operator-notices.test.ts` (`git mv`). Only the import path, the renamed types and `locale: "en"` in the deps (D13) change. Every expected key, text, audit row and log event stays. All cases pass: the hourly run (trial before and after the end, `pl`, auth error 25 h vs 23 h, new episode, suspended organization, failed send then retry, send null), `capReached`, `sendLimitReached` (per-day dedup, a send that never resolves, retry, hourly catch-up, no `@` in the text), `authMailFailed`, log events.
2. New case, old rows: insert by hand, before the hook runs, an audit row `operator.notice` with `data.key` = the literal string `llm_cap:22222222-2222-4222-8222-222222222222:2026-11-18T10:00:00.000Z` (written as a string in the test, not by `operatorEventKey`) in the organization of the mailbox; `capReached(ctx, BOX, new Date(AT), 300)`; after `idle()` the send was called 0 times and the audit table holds exactly one `operator.notice` row of that key.
3. New case, the same for `auth_error_24h`: a mailbox in `auth_error` since `AT`, now `AT + 25 h`, and a hand-written row with key `auth_error_24h:<mailbox id>:1794996000000`; `run()` sends 0 texts.
4. The invalid-date cases of `capReached`, `authMailFailed` and `sendLimitReached` pass unchanged: one `operator_notice_failed` error line each and no unhandled rejection.
5. Mutation: change the `llm_cap` key in `operatorEventKey` (for example `:` → `|`); cases 2 and the stage 01 key table fail. Revert; write it in the final message.
6. Existing guards, unchanged: `operator-reads.test.ts`, `web-operator-detail.test.ts` (they read `operator.notice` rows), `ops-slo-job.test.ts`.

## Docs

`digest-and-notices.md` rule 11 and its code table, `docs/modules.md` (operator owns the notices) and the `Source:` paths in `docs/known-alerts.md` name `operator/notices.ts` and `packages/core/src/ops/events.ts`.

## Done when

- `channels/operator.ts` does not exist; no file imports `createOperatorNotices` from `modules/channels`.
- Cases 1–6 hold.
- Proof: `plan.md` § Proof with `NN=03`.

## Out of scope

A change of a key, a text, a retry rule, a log name (stage 04) or the schedule (D5); the console notice list.
