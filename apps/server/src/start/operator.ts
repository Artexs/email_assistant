import { readFile, statfs } from "node:fs/promises";

import {
  checkBackupAge,
  checkDisk,
  checkLlmErrors,
  checkSyncLag,
  checkUrgentLatency,
  createOperatorDelivery,
  createOperatorNotices,
  runSloTick,
  type SloCheckEntry,
  type StatFs,
} from "../modules/operator";
import { operatorChatId, sloThresholds, testMailRule } from "../platform/config";

import type { StartContext } from "./context";

export interface OperatorStart {
  operator: ReturnType<typeof createOperatorNotices>;
}

export interface OperatorStartDeps {
  // The disk and backup file reads of the service-level checks.
  io: { statfs: StatFs; readFile: (path: string) => Promise<string> };
  createOperatorNotices: typeof createOperatorNotices;
  runSloTick: typeof runSloTick;
}

const realDeps: OperatorStartDeps = {
  io: { statfs, readFile: (path) => readFile(path, "utf8") },
  createOperatorNotices,
  runSloTick,
};

// The operator notices and the service-level alerts. Both deliver through one delivery to the operator chat; the Telegram runtime is read at send time.
export function startOperator(ctx: StartContext, deps: OperatorStartDeps = realDeps): OperatorStart {
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
  const delivery = createOperatorDelivery({ send: operatorSend, log });
  const operator = deps.createOperatorNotices({
    db,
    now: () => new Date(),
    delivery,
    locale: config.OPERATOR_LOCALE,
  });
  // prettier-ignore
  scheduler.add("channels.operator", "0 13 * * * *", runs.track("channels.operator", () => operator.run()));
  log.info("operator_alerts_on", { kind: operatorChat === null ? "log" : "telegram" });

  // The service-level alerts. The job runs in every case: with no operator chat the `operator_alert_unsent` line stands for the send.
  // The alert goes only to the operator chat, through the same delivery as the operator notices. The scheduler runs the tick
  // with no tenant scope, because the checks read every organization.
  const slo = sloThresholds(config);
  const sloChecks: SloCheckEntry[] = [
    { kind: "slo_sync_lag", run: (now) => checkSyncLag(db, now, slo, startedAt) },
    {
      kind: "slo_urgent_latency",
      run: (now) => checkUrgentLatency(db, now, slo, startedAt, testMailRule(config)),
    },
    { kind: "slo_llm_errors", run: (now) => checkLlmErrors(db, now, slo) },
    { kind: "slo_disk", run: () => checkDisk(deps.io.statfs, slo) },
    // null when BACKUP_STATUS_FILE is empty: the check is off and an open alert of this kind stays as it is.
    { kind: "slo_backup_age", run: (now) => checkBackupAge(deps.io.readFile, now, slo) },
  ];
  // prettier-ignore
  scheduler.add("ops.slo", "30 */5 * * * *", runs.track("ops.slo", () =>
    deps.runSloTick(
      { db, checks: sloChecks, delivery, cfg: slo, log, locale: config.OPERATOR_LOCALE },
      new Date()
    )
  ));
  return { operator };
}
