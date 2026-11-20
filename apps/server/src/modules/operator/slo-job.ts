import {
  HOUR_MS,
  nextAlertStep,
  renderSloAlert,
  SLO_KINDS,
  type SloKind,
  type SloThresholds,
  type UserLocale,
} from "@ea/core";

import type { Db } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import type { Log } from "../../platform/log";

import { getActiveAlert, markAlertSent, openAlert, resolveAlert } from "./alerts-repo";
import type { AlertStatus, OperatorDelivery } from "./deliver";
import type { SloReading } from "./slo-checks";

// One tick of the `ops.slo` job. For each kind it reads the check, asks `nextAlertStep` what to do, sends the
// text and then writes the mark (send first, then mark: a crash repeats one notice, never loses one). The tick keeps no
// memory: the open state lives in `ops_alerts`, so a restart changes nothing. `scheduler.ts` runs the tick without a tenant
// scope; the checks read every organization.

/** A check that is off returns null: an open alert of its kind stays as it is. */
export type SloCheckFn = (now: Date) => Promise<SloReading | null>;

export interface SloCheckEntry {
  kind: SloKind;
  run: SloCheckFn;
}

export interface SloTickDeps {
  db: Db;
  checks: SloCheckEntry[];
  // The one delivery of the operator texts. No operator chat counts as delivered.
  delivery: OperatorDelivery;
  cfg: Pick<SloThresholds, "repeatH">;
  log: Pick<Log, "error">;
  locale: UserLocale;
}

export async function runSloTick(deps: SloTickDeps, now: Date): Promise<void> {
  const order = (kind: SloKind): number => SLO_KINDS.indexOf(kind);
  for (const entry of [...deps.checks].sort((a, b) => order(a.kind) - order(b.kind))) {
    let reading: SloReading | null;
    try {
      reading = await entry.run(now);
    } catch (error) {
      deps.log.error("operator_check_failed", { kind: entry.kind, ...errorFields(error) });
      continue;
    }
    if (reading === null) continue;
    try {
      await applyReading(deps, reading, now);
    } catch (error) {
      // A state read or write failed. The next tick asks again; the other kinds go on.
      deps.log.error("operator_alert_failed", { kind: entry.kind, ...errorFields(error) });
    }
  }
}

// One step for one kind. Each mark is called once per step.
async function applyReading(deps: SloTickDeps, reading: SloReading, now: Date): Promise<void> {
  const { db, cfg } = deps;
  const { check, ids } = reading;
  const row = await getActiveAlert(db, check.kind);
  const step = nextAlertStep(row, check, now, cfg.repeatH * HOUR_MS);
  if (step === "none") return;
  if (step === "silent_close") {
    // `nextAlertStep` returns this only for a row that exists.
    if (row !== null) await resolveAlert(db, row.id, now, check.facts, { silent: true });
    return;
  }
  if (step === "open" || step === "repeat") {
    const active = row ?? (await openAlert(db, { kind: check.kind, at: now, facts: check.facts }));
    const text = renderSloAlert(
      { kind: check.kind, phase: step, facts: check.facts, ids, openedAt: active.openedAt, now },
      deps.locale
    );
    if (await deliver(deps, check.kind, step, active.id, text))
      await markAlertSent(db, active.id, step, now, check.facts);
    return;
  }
  // `resolve`: the row exists, because only a row can be open.
  if (row === null) return;
  const resolvedAt = row.resolvedAt ?? now;
  if (row.resolvedAt === null) await resolveAlert(db, row.id, now, check.facts, { silent: false });
  const text = renderSloAlert(
    { kind: check.kind, phase: "resolved", facts: check.facts, ids, openedAt: row.openedAt, now: resolvedAt },
    deps.locale
  );
  if (await deliver(deps, check.kind, "resolved", row.id, text))
    await markAlertSent(db, row.id, "resolved", now, check.facts);
}

// true = the notice counts as sent. A failed send writes no mark: the next tick tries again.
function deliver(
  deps: SloTickDeps,
  kind: SloKind,
  status: AlertStatus,
  alertId: string,
  text: string
): Promise<boolean> {
  return deps.delivery.deliver({ kind, status, key: `${kind}:${status}:${alertId}` }, text);
}
