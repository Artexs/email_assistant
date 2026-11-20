import { readFile, statfs } from "node:fs/promises";

import {
  checkBackupAge,
  checkDisk,
  checkLlmErrors,
  checkSyncLag,
  checkUrgentLatency,
  createOperatorNotices,
  runSloTick,
  type SloCheckEntry,
} from "../modules/operator";
import { operatorChatId, sloThresholds, testMailRule } from "../platform/config";

import type { StartContext } from "./context";

export interface OperatorStart {
  operator: ReturnType<typeof createOperatorNotices>;
}

// The operator notices and the service-level alerts. Both send through the operator chat; the Telegram runtime is read at send time.
export function startOperator(ctx: StartContext): OperatorStart {
  const { config, db, log, scheduler, runs, startedAt, late } = ctx;
  // Operator notices: the chat id is private data and never reaches a log line.
  const operatorChat = operatorChatId(config);
  const operatorSend =
    operatorChat === null
      ? null
      : async (text: string): Promise<void> => {
          if (late.telegram === null) throw new Error("telegram is off");
          await late.telegram.sendDirect(operatorChat, text);
        };
  const operator = createOperatorNotices({
    db,
    now: () => new Date(),
    send: operatorSend,
    locale: config.OPERATOR_LOCALE,
  });
  // prettier-ignore
  scheduler.add("channels.operator", "0 13 * * * *", runs.track("channels.operator", () => operator.run()));
  log.info("operator_notices_on", { kind: operatorChat === null ? "log" : "telegram" });

  // The service-level alerts. The job runs in every case: with no operator chat the `slo_alert_sent` line is the send.
  // The alert goes only to the operator chat, through the same send as the operator notices. The scheduler runs the tick
  // with no tenant scope, because the checks read every organization.
  const slo = sloThresholds(config);
  const sloChecks: SloCheckEntry[] = [
    { kind: "slo_sync_lag", run: (now) => checkSyncLag(db, now, slo, startedAt) },
    {
      kind: "slo_urgent_latency",
      run: (now) => checkUrgentLatency(db, now, slo, startedAt, testMailRule(config)),
    },
    { kind: "slo_llm_errors", run: (now) => checkLlmErrors(db, now, slo) },
    { kind: "slo_disk", run: () => checkDisk(statfs, slo) },
    // null when BACKUP_STATUS_FILE is empty: the check is off and an open alert of this kind stays as it is.
    { kind: "slo_backup_age", run: (now) => checkBackupAge((path) => readFile(path, "utf8"), now, slo) },
  ];
  // prettier-ignore
  scheduler.add("ops.slo", "30 */5 * * * *", runs.track("ops.slo", () =>
    runSloTick(
      { db, checks: sloChecks, send: operatorSend, cfg: slo, log, locale: config.OPERATOR_LOCALE },
      new Date()
    )
  ));
  return { operator };
}
