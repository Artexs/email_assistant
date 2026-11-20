# F147 stage 04 — one delivery, one log vocabulary, one test command

Needs stage 03: `operator/notices.ts` (`OperatorNoticeDeps`), `operator-notices.test.ts`. Needs stage 01: `renderOperatorEvent`, `OPERATOR_ALERT_KINDS` in `@ea/core`.
Part of [`../plan.md`](../plan.md). Review: Sonnet, before the land (runbook names).

## Goal

One delivery and one set of log lines for both lifecycles (D6, D7); `ops:alert-test` shows all ten kinds (D9).

## Step 1 — the delivery

- **File** `apps/server/src/modules/operator/deliver.ts` (new):
  ```ts
  export type AlertStatus = "open" | "repeat" | "resolved";
  export interface OperatorDelivery {
    deliver(alert: { kind: OperatorAlertKind; status: AlertStatus; key: string }, text: string): Promise<boolean>;
  }
  export function createOperatorDelivery(deps: {
    send: ((text: string) => Promise<void>) | null;
    log: Pick<Log, "info" | "warn" | "error">;
  }): OperatorDelivery;
  ```
  - Lines and levels: D7. Send null counts as delivered (true); a throw returns false and logs only the first time per `key` in this process.
- `key`: the event key, or `<kind>:<status>:<ops_alerts id>` for an incident. An event delivers with `status: "open"`.
- `OperatorNoticeDeps` and `SloTickDeps` take `delivery` instead of `send`. The composition root builds one delivery from `operatorSend` for both.

## Step 2 — the log vocabulary (D7)

- Check and detector failures: `operator_check_failed`; state failures and hook input failures: `operator_alert_failed`; the start-up line: `operator_alerts_on`. Names, levels and fields exactly as D7; the old names go, also from comments.

## Step 3 — test command (D9)

- `scripts/ops-alerts-args.ts`: `--kind` takes any `OPERATOR_ALERT_KINDS` value; `--all` gives the ten kinds, `SLO_KINDS` first, then `OPERATOR_EVENT_KINDS`, each in its list order. Usage line lists them.
- Core, `packages/core/src/ops/alert-text.ts`: `operatorEventSample(kind: OperatorEventKind, now: Date): OperatorEvent` with org `00000000-0000-4000-8000-000000000006`, mailbox `…0007`, user `…0008`; `trial_ending` ends `now + 3 days`, `ended` false; `auth_error_24h` since `now − 1 day`; `llm_cap` cap 300, day start `now`; `auth_mail_failed` mail `reset`, code `EAUTH`, at `now`; `send_limit` limit `mailbox_hour`, at `now`, until `now + 1 hour`. And `renderTestAlert(kind: OperatorAlertKind, now: Date, locale: UserLocale): string`: an incident kind gives the `HEAD` test text; an event kind gives `TEST <kind>`, a newline, then `renderOperatorEvent(operatorEventSample(kind, now), locale)`. Use `DAY_MS`, `HOUR_MS`.
- `sendTestAlerts` uses `renderTestAlert` for every kind. It writes no `ops_alerts` row and no audit row.

## Test

`AT` = `2026-11-18T10:00:00.000Z`.

1. `operator/deliver.test.ts` (unit, fake send, captured log):
   - a. send resolves → `true`; the log is exactly `[info operator_alert_sent { kind: "slo_disk", status: "open" }]`.
   - b. send null → `true`; exactly `[warn operator_alert_unsent { kind: "llm_cap", status: "open" }]`.
   - c. send throws twice for key `K` → `false`, `false`; exactly one `operator_alert_send_failed` line.
   - d. throws for `K`, then for `K2` → two `operator_alert_send_failed` lines.
   - e. text `SECRET-TEXT-1` appears in no logged field.
2. `ops-slo-job.test.ts` and `operator-notices.test.ts`: the cases keep their counts, rows and sends; only the names and levels change, each to its D7 line. Each log assert names its level: a failed check, state write or send is `error` in both files. The notices send-null case still writes one `operator.notice` row.
3. CLI, no chat: `OPERATOR_TELEGRAM_CHAT_ID= bun run ops:alert-test --all` exits 0 and prints exactly ten lines `unsent <kind> no_chat`, in the `--all` order (ticket acceptance 4).
4. Wiring pin (`main.test.ts` or the `startSource()` test): one `createOperatorDelivery(` call, and both `createOperatorNotices` and the `ops.slo` tick get that delivery.
5. `ops-alerts-args.test.ts`: `--kind llm_cap` → `["llm_cap"]`; `--all` → the ten kinds in the order above; `--kind nope` → null; `--all --kind slo_disk` → null.
6. `renderTestAlert` with `AT`:
   - `send_limit`, en → `TEST send_limit\nMailbox 00000000-0000-4000-8000-000000000007 of org 00000000-0000-4000-8000-000000000006 hit the send limit mailbox_hour at 2026-11-18T10:00:00.000Z; its sends wait until 2026-11-18T11:00:00.000Z.`
   - `trial_ending`, pl → `TEST trial_ending\nOkres próbny organizacji 00000000-0000-4000-8000-000000000006 kończy się 2026-11-21T10:00:00.000Z.`
   - `slo_disk`, en → its `HEAD` test text.
7. `ops-slo-job.test.ts` case 11: `sendTestAlerts` with all ten kinds sends ten texts; the `ops_alerts` and `operator.notice` row counts do not change.
8. Mutation: log every failure; case 1c fails. Revert; name it in the final message.

## Docs

`docs/known-alerts.md`: one entry per D7 name, replacing the old ones. `operations.md` § Alerts and `digest-and-notices.md` rule 11: log lines, ten-kind test command.

## Done when

- Search for `operator_notice`, `slo_alert_` and `slo_check_failed` in `apps/server/src` finds nothing.
- Cases 1–8 hold.
- Proof: `plan.md` § Proof with `NN=04`.

## Out of scope

Schedules, keys, real alert texts, retry rules (D5, D8); the console notice list.
