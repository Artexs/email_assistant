import { barCategories, GATE_BAR, GATE_MIN_KEPT, type BarCategory, type GateView } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { setCategoryAuto, type SettingsChange, type SettingsDeps } from "../config";

import { buildRealReport } from "./eval-real";
import { listLabeledResults } from "./repo";

// The go/no-go row of each category from the labelled real mail (D10 (b)). One query for all five categories.
export async function goNoGoFor(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  now: Date
): Promise<Record<BarCategory, GateView>> {
  const rows = await listLabeledResults(db, ctx, mailboxId, { mail: "real" });
  const report = buildRealReport(rows, { bar: GATE_BAR, minKept: GATE_MIN_KEPT, mail: "real", now });
  const result = {} as Record<BarCategory, GateView>;
  for (const category of barCategories) {
    const row = report.goNoGo[category];
    const sweep = report.sweep[category];
    let atConfidence: number;
    if (row.decision === "go") {
      atConfidence = row.threshold ?? 0.5;
    } else if (row.decision === "no-go") {
      atConfidence = (sweep.find((point) => point.kept >= GATE_MIN_KEPT) ?? sweep[0])?.threshold ?? 0.5;
    } else {
      atConfidence = sweep[0]?.threshold ?? 0.5;
    }
    result[category] = {
      decision: row.decision,
      precision: row.precision,
      kept: row.kept,
      atConfidence,
      threshold: row.threshold,
    };
  }
  return result;
}

export type AutoGateResult =
  | { kind: "changed"; change: SettingsChange; gate: GateView | null }
  | { kind: "refused"; gate: GateView };

// The gate reads outside the settings lock: a label that arrives meanwhile shows in the next read.
export async function setCategoryAutoWithGate(
  deps: SettingsDeps,
  ctx: TenantContext,
  mailboxId: string,
  input: { category: BarCategory; auto: boolean; force: boolean; threshold?: number; actor: string }
): Promise<AutoGateResult> {
  if (!input.auto) {
    const change = await setCategoryAuto(deps, ctx, mailboxId, {
      category: input.category,
      auto: false,
      ...(input.threshold === undefined ? {} : { threshold: input.threshold }),
      gate: { decision: "skipped", precision: null, kept: 0, forced: false },
      actor: input.actor,
    });
    return { kind: "changed", change, gate: null };
  }
  const gate = (await goNoGoFor(deps.db, ctx, mailboxId, deps.now()))[input.category];
  if (gate.decision !== "go" && !input.force) {
    return { kind: "refused", gate };
  }
  const threshold = input.threshold ?? (gate.decision === "go" ? (gate.threshold ?? undefined) : undefined);
  const change = await setCategoryAuto(deps, ctx, mailboxId, {
    category: input.category,
    auto: true,
    ...(threshold === undefined ? {} : { threshold }),
    gate: {
      decision: gate.decision,
      precision: gate.precision,
      kept: gate.kept,
      forced: input.force && gate.decision !== "go",
    },
    actor: input.actor,
  });
  return { kind: "changed", change, gate };
}
