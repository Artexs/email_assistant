import type { GateView } from "@ea/core/web";

import type { TextKey } from "../i18n";

export function formatPercent(ratio: number): string {
  return Number((ratio * 100).toFixed(1)).toString();
}

// Rounded down, so a failing precision never shows the bar's number. The inner round removes float noise.
export function formatPrecision(ratio: number): string {
  return String(Math.floor(Math.round(ratio * 1e6) / 1e3) / 10);
}

export function formatConfidence(value: number): string {
  return String(value);
}

export function gateText(
  gate: GateView,
  bar: number,
  minKept: number
): { key: TextKey; vars: Record<string, string | number> } {
  const at = formatConfidence(gate.atConfidence);
  if (gate.decision === "no-go: too few") {
    return { key: "gate_too_few", vars: { kept: gate.kept, minKept, at } };
  }
  return {
    key: gate.decision === "go" ? "gate_go" : "gate_no_go",
    vars: { precision: formatPrecision(gate.precision ?? 0), kept: gate.kept, at, bar: formatPercent(bar) },
  };
}
