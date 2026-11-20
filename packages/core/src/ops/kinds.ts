// The five service levels that the operator job checks. The CHECK list of `ops_alerts.kind` holds the same codes.
export const SLO_KINDS = [
  "slo_sync_lag",
  "slo_urgent_latency",
  "slo_llm_errors",
  "slo_disk",
  "slo_backup_age",
] as const;

export type SloKind = (typeof SLO_KINDS)[number];

// `firing`: the fire rule holds. `clear`: the clear rule holds. `between`: neither holds (hysteresis); an open alert
// stays open. `firing` wins over `between`. `facts` holds numbers only.
export interface SloCheck {
  kind: SloKind;
  state: "firing" | "between" | "clear";
  facts: Record<string, number>;
}

// The thresholds of the service-level checks. Set by the `SLO_*` keys of `platform/config`.
export interface SloThresholds {
  syncLagMin: number;
  urgentLatencyMin: number;
  llmWindowMin: number;
  llmMinCalls: number;
  llmFailPct: number;
  llmClearPct: number;
  repeatH: number;
  // Disk: the volume path, the free percent and the free gigabytes that open the alert.
  diskPath: string;
  diskFreePct: number;
  diskFreeGb: number;
  // Backup: hours since the last good backup, and the status file path (null = the backup check is off).
  backupMaxAgeH: number;
  backupStatusFile: string | null;
}

// The five events that send one operator text each. The state of an event is its dedup key (`operatorEventKey`).
export const OPERATOR_EVENT_KINDS = [
  "trial_ending",
  "llm_cap",
  "auth_error_24h",
  "auth_mail_failed",
  "send_limit",
] as const;

export type OperatorEventKind = (typeof OPERATOR_EVENT_KINDS)[number];

// Every kind of text that reaches the operator chat.
export const OPERATOR_ALERT_KINDS = [...SLO_KINDS, ...OPERATOR_EVENT_KINDS] as const;

export type OperatorAlertKind = (typeof OPERATOR_ALERT_KINDS)[number];

// `incident`: opens, repeats and resolves (state in `ops_alerts`). `once`: one text per event key.
export const ALERT_LIFECYCLE: Record<OperatorAlertKind, "incident" | "once"> = {
  slo_sync_lag: "incident",
  slo_urgent_latency: "incident",
  slo_llm_errors: "incident",
  slo_disk: "incident",
  slo_backup_age: "incident",
  trial_ending: "once",
  llm_cap: "once",
  auth_error_24h: "once",
  auth_mail_failed: "once",
  send_limit: "once",
};
