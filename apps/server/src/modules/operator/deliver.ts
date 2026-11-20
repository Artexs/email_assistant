import type { OperatorAlertKind } from "@ea/core";

import type { Log } from "../../platform/log";
import { telegramErrorFields } from "../channels";

import type { AlertPhase } from "./alerts-repo";

// The state of the alert a text belongs to. An event is always `open`.
export type AlertStatus = AlertPhase;

export interface OperatorDelivery {
  /**
   * Sends one text to the operator chat. true = the text counts as delivered (sent, or no operator chat);
   * false = the send failed and the caller writes no mark. `key` names the alert: a failed send logs once per key and process.
   * The text never reaches a log line.
   */
  deliver(alert: { kind: OperatorAlertKind; status: AlertStatus; key: string }, text: string): Promise<boolean>;
}

export interface OperatorDeliveryDeps {
  // The Telegram direct send to the operator chat; null = no operator chat.
  send: ((text: string) => Promise<void>) | null;
  log: Pick<Log, "info" | "warn" | "error">;
}

// The one delivery of both lifecycles (incidents and events). The retry rules stay with the callers.
export function createOperatorDelivery(deps: OperatorDeliveryDeps): OperatorDelivery {
  const { send, log } = deps;
  const failedLogged = new Set<string>();
  return {
    async deliver({ kind, status, key }, text) {
      if (send === null) {
        log.warn("operator_alert_unsent", { kind, status });
        return true;
      }
      try {
        await send(text);
      } catch (error) {
        if (!failedLogged.has(key)) {
          failedLogged.add(key);
          log.error("operator_alert_send_failed", { kind, status, ...telegramErrorFields(error) });
        }
        return false;
      }
      log.info("operator_alert_sent", { kind, status });
      return true;
    },
  };
}
