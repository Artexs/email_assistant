// The evidence gate behind the flag `trust_ladder` (ADR 0028): turning `auto` on follows the three evidence sources
// (global holdout of the running setup, history check, tripwire) and the real labels, not the real labels alone.
import {
  autoEvidence,
  type AutoEvidenceResult,
  type BarCategory,
  type GateEvidenceDeps,
  type GateView,
  type GlobalEvidence,
  type TripState,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { setCategoryAuto, type SettingsChange, type SettingsDeps } from "../config";
import type { TestMailRule } from "../mail";
import { globalEvidenceFor, goNoGoFor } from "../triage";

import { activeTripsOf, historyResultFor, type HistoryCategoryResult } from "./repo";

export interface EvidenceGateDeps {
  settings: SettingsDeps;
  testMail: TestMailRule;
}

// What the gate judged: the `autoEvidence` result and the global row it read.
export interface CategoryEvidence extends AutoEvidenceResult {
  global: GlobalEvidence;
}

export interface EvidenceGateInput {
  category: BarCategory;
  auto: boolean;
  force: boolean;
  threshold?: number;
  actor: string;
}

export type EvidenceGateResult =
  // `evidence` is null for `auto: false`: turning it off never reads evidence.
  | { kind: "changed"; change: SettingsChange; gate: GateView | null; evidence: CategoryEvidence | null }
  // `gate` is the real-label view the Settings dialog shows; `evidence.blocks` says why the gate refused.
  | { kind: "refused"; gate: GateView; evidence: CategoryEvidence };

const NO_TRIP: TripState = { tripped: false, reason: null, at: null };

// What the gate reads of one mailbox: the real labels and the global evidence of every bar category, the newest history result
// and the active trips.
export interface EvidenceInputs {
  gates: Record<BarCategory, GateView>;
  globals: Record<BarCategory, GlobalEvidence>;
  // Only the moving categories have a history result; the others read `undefined`.
  history: Partial<Record<BarCategory, HistoryCategoryResult | null>>;
  trips: ReadonlyMap<BarCategory, TripState>;
}

export async function readEvidenceInputs(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: { gate: GateEvidenceDeps; testMail: TestMailRule; now: Date }
): Promise<EvidenceInputs> {
  return {
    gates: await goNoGoFor(db, ctx, mailboxId, opts.now, opts.testMail),
    globals: globalEvidenceFor(opts.gate.index, opts.gate.runningKey),
    history: await historyResultFor(db, ctx, mailboxId),
    trips: await activeTripsOf(db, ctx, mailboxId),
  };
}

// The one rule that turns the reads of a mailbox into the `autoEvidence` verdict of one category: the gate, the history notice, the
// "turn on recommended" write and the trust view all call it.
export function judgeCategory(inputs: EvidenceInputs, category: BarCategory): AutoEvidenceResult {
  const gate = inputs.gates[category];
  return autoEvidence({
    category,
    global: inputs.globals[category],
    history: inputs.history[category] ?? null,
    trip: inputs.trips.get(category) ?? NO_TRIP,
    realLabels: { kept: gate.kept, decision: gate.decision === "no-go: too few" ? "too-few" : gate.decision },
  });
}

// The three evidence sources and the real labels for one category: the one reader of the gate and of the history check's notice.
export async function readCategoryEvidence(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  category: BarCategory,
  opts: { gate: GateEvidenceDeps; testMail: TestMailRule; now: Date }
): Promise<{ gate: GateView; result: AutoEvidenceResult; global: GlobalEvidence }> {
  const inputs = await readEvidenceInputs(db, ctx, mailboxId, opts);
  return { gate: inputs.gates[category], result: judgeCategory(inputs, category), global: inputs.globals[category] };
}

// The reads happen outside the settings lock, as in `setCategoryAutoWithGate`: a label, a check or a trip that lands
// meanwhile shows in the next read. The write is one transaction: the policy row, its audit row and the clear of the trips.
export async function setCategoryAutoWithEvidence(
  deps: EvidenceGateDeps,
  ctx: TenantContext,
  mailboxId: string,
  input: EvidenceGateInput
): Promise<EvidenceGateResult> {
  const { settings } = deps;
  if (!input.auto) {
    const change = await setCategoryAuto(settings, ctx, mailboxId, {
      category: input.category,
      auto: false,
      ...(input.threshold === undefined ? {} : { threshold: input.threshold }),
      gate: { decision: "skipped", precision: null, kept: 0, forced: false },
      grantBy: "evidence",
      actor: input.actor,
    });
    return { kind: "changed", change, gate: null, evidence: null };
  }
  const { gate, result, global } = await readCategoryEvidence(settings.db, ctx, mailboxId, input.category, {
    gate: settings.gate,
    testMail: deps.testMail,
    now: settings.now(),
  });
  const evidence: CategoryEvidence = { ...result, global };
  if (!result.eligible && !input.force) {
    return { kind: "refused", gate, evidence };
  }
  const forced = !result.eligible;
  // The threshold of the gate file for the category when it has one, else the current threshold (a caller's value wins).
  const threshold = input.threshold ?? global.threshold ?? undefined;
  const change = await setCategoryAuto(settings, ctx, mailboxId, {
    category: input.category,
    auto: true,
    ...(threshold === undefined ? {} : { threshold }),
    gate: { decision: "evidence", precision: gate.precision, kept: gate.kept, forced },
    grantBy: forced ? "forced" : "evidence",
    ...(forced ? { auditData: { blocks: result.blocks.join(",") } } : {}),
    inTransaction: async (trx) => {
      await settings.clearTrips(trx, ctx, mailboxId, input.category, settings.now());
    },
    actor: input.actor,
  });
  return { kind: "changed", change, gate, evidence };
}
