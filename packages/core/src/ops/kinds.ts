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
