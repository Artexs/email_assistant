import { costPerMail, DEFAULT_MAILS_PER_DAY, type LlmEndpointKind, llmPrices, monthlyCost } from "@ea/core";

import type { UsageRow } from "../modules/triage";

// The pure part of `triage:cost`: the report lines of one (model, endpoint) group. No I/O.

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1] ?? null;
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function num(value: number | null): string {
  return value === null ? "n/a" : String(Math.round(value));
}

function usd(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(6)}`;
}

function nonNull(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null);
}

/** Groups rows by model and endpoint, in the order of first sight. */
export function groupUsage(
  rows: readonly UsageRow[]
): { model: string; endpoint: LlmEndpointKind; rows: UsageRow[] }[] {
  const groups = new Map<string, { model: string; endpoint: LlmEndpointKind; rows: UsageRow[] }>();
  for (const row of rows) {
    const key = `${row.endpoint}\u0000${row.model}`;
    const group = groups.get(key) ?? { model: row.model, endpoint: row.endpoint, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Each row is priced at the rate of its own endpoint: an EU row at the EU rate, an own row at 0. */
export function modelReportLines(
  model: string,
  endpoint: LlmEndpointKind,
  rows: readonly UsageRow[],
  days: number
): string[] {
  // Latency comes from stored results only: the latency of an error `llm.call` row includes the rate-limiter wait.
  const latencies = nonNull(rows.map((r) => r.latency_ms)).sort((a, b) => a - b);
  const costs = nonNull(
    rows.map((r) => costPerMail(model, r.tokens_in ?? 0, r.tokens_out ?? 0, r.created_at, endpoint))
  );
  const avgCost = average(costs);
  const perDay = rows.length / days;

  const lines = [
    "",
    `model ${model} endpoint ${endpoint}`,
    `  LLM results: ${rows.length}`,
    `  LLM results per day (observed, over ${days} days): ${perDay.toFixed(2)}`,
    `  average tokens in / out: ${num(average(nonNull(rows.map((r) => r.tokens_in))))} / ${num(average(nonNull(rows.map((r) => r.tokens_out))))}`,
    `  latency p50 / p95: ${num(percentile(latencies, 0.5))} ms / ${num(percentile(latencies, 0.95))} ms`,
    `  average cost per mail: ${usd(avgCost)}`,
    `  cost per mailbox per month at ${perDay.toFixed(2)} mails per day: ${usd(avgCost === null ? null : monthlyCost(avgCost, perDay))}`,
    `  cost per mailbox per month at ${DEFAULT_MAILS_PER_DAY} mails per day: ${usd(avgCost === null ? null : monthlyCost(avgCost, DEFAULT_MAILS_PER_DAY))}`,
  ];

  if (endpoint === "own") {
    lines.push("  price: own endpoint: cost 0");
    return lines;
  }
  const prices = Object.hasOwn(llmPrices, model) ? llmPrices[model] : undefined;
  const rowsOfEndpoint = (prices ?? []).filter((price) => (price.endpoint ?? "standard") === endpoint);
  if (rowsOfEndpoint.length === 0) lines.push(`  ${endpoint} price: none for ${model}`);
  for (const price of rowsOfEndpoint) {
    const note = price.unverified ? " (UNVERIFIED: secondary source)" : "";
    lines.push(`  ${endpoint} price, source ${price.source}, read ${price.checked}${note}`);
  }
  return lines;
}
