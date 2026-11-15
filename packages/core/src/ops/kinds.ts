// F114: the five service levels that the operator job checks. The CHECK list of `ops_alerts.kind` holds the same codes.
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

// The thresholds of the service-level checks (F114 stages 02 and 04). Set by the `SLO_*` keys of `platform/config`.
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
