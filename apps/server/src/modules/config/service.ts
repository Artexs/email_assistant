import {
  ASSIST_DEFAULT_SWITCHES,
  autoFor,
  parseCategoryPolicy,
  parseToolSwitches,
  thresholdFor,
  type ActionType,
  type BarCategory,
  type CategoryPolicy,
  type GoDecision,
  type MailboxActionType,
  type MailboxMode,
  type ToolSwitches,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import type { ExpireFilter } from "../actions";
import { auditEvents, recordAudit, type AuditData } from "../audit";

import { getMovesSupported, lockMailboxSettings, updateMailboxSettings, type MailboxSettingsRow } from "./repo";

export interface SettingsDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  // Required, so typecheck stops a caller that forgets it (the CLI now, the S5 page later).
  expireReady(
    trx: Transaction<DB>,
    ctx: TenantContext,
    filter: ExpireFilter,
    opts: { now: Date; reason: "policy_changed" | "undo" | "manual"; actor: string }
  ): Promise<{ id: string; emailId: string; type: ActionType }[]>;
}

export interface SettingsView {
  mode: MailboxMode;
  toolSwitches: ToolSwitches;
  categoryPolicy: CategoryPolicy;
  movesSupported: boolean;
}

export interface SettingsChange {
  changed: boolean;
  before: SettingsView;
  after: SettingsView;
  warnings: string[];
  // Rows that this change expired.
  expired: number;
  // The change closes a gate (it may expire rows).
  closedGate: boolean;
}

type Change =
  | { field: "mode"; to: MailboxMode }
  | { field: "auto"; category: BarCategory; to: boolean; thresholdRaised: boolean }
  | { field: "switch"; name: keyof ToolSwitches; to: boolean };

// Follows `decidePolicy`. null = the change closes no gate.
export function closedBy(
  change: Change
): { types: MailboxActionType[]; category?: { is: string } | { not: string }; sends?: true } | null {
  if (change.field === "mode") {
    return change.to === "shadow" ? { types: ["move", "mark_read", "flag"], sends: true } : null;
  }
  if (change.field === "auto") {
    // A higher threshold with `auto` on: fail-safe, the rows planned under the old threshold expire too.
    return !change.to || change.thresholdRaised
      ? { types: ["move", "mark_read"], category: { is: change.category } }
      : null;
  }
  if (change.to) {
    return null;
  }
  switch (change.name) {
    case "move":
      return { types: ["move"], category: { not: "unsure" } };
    case "move_unsure":
      return { types: ["move"], category: { is: "unsure" } };
    case "mark_read":
      return { types: ["mark_read"] };
    case "flag":
      return { types: ["flag"] };
    case "create_draft":
      return { types: [], sends: true };
  }
}

function toView(row: MailboxSettingsRow, movesSupported: boolean): SettingsView {
  return {
    mode: row.mode as MailboxMode,
    toolSwitches: parseToolSwitches(row.tool_switches),
    categoryPolicy: parseCategoryPolicy(row.category_policy),
    movesSupported,
  };
}

function inTransaction<T>(db: SettingsDeps["db"], run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

export async function getSettingsView(
  deps: SettingsDeps,
  ctx: TenantContext,
  mailboxId: string
): Promise<SettingsView> {
  const row = await deps.db
    .selectFrom("mailbox_settings")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirst();
  if (!row) {
    throw new HardError("no mailbox_settings row");
  }
  return toView(row, await getMovesSupported(deps.db, ctx, mailboxId));
}

interface Computed {
  patch: { mode?: MailboxMode; toolSwitches?: ToolSwitches; categoryPolicy?: CategoryPolicy };
  changed: boolean;
  event: string;
  data: AuditData;
  close: Change | null;
  // More gates that the change closes, for example a switch that `mode assist` turns off.
  alsoClose?: Change[];
  warnings: string[];
}

// One transaction: lock, compute, update, audit, expire the rows that the change closes.
async function applyChange(
  deps: SettingsDeps,
  ctx: TenantContext,
  mailboxId: string,
  actor: string,
  compute: (before: SettingsView) => Computed
): Promise<SettingsChange> {
  return inTransaction(deps.db, async (trx) => {
    const row = await lockMailboxSettings(trx, ctx, mailboxId);
    if (!row) {
      throw new HardError("no mailbox_settings row");
    }
    const before = toView(row, await getMovesSupported(trx, ctx, mailboxId));
    const result = compute(before);
    if (!result.changed) {
      return { changed: false, before, after: before, warnings: result.warnings, expired: 0, closedGate: false };
    }
    await updateMailboxSettings(trx, ctx, mailboxId, result.patch);
    await recordAudit(trx, ctx, {
      actor,
      event: result.event,
      data: { mailbox_id: mailboxId, ...result.data },
    });
    const after: SettingsView = { ...before, ...result.patch };
    let expired = 0;
    let closedGate = false;
    for (const change of [...(result.close ? [result.close] : []), ...(result.alsoClose ?? [])]) {
      const filter = closedBy(change);
      if (!filter) continue;
      closedGate = true;
      const rows = await deps.expireReady(
        trx,
        ctx,
        { mailboxId, ...filter },
        { now: deps.now(), reason: "policy_changed", actor }
      );
      expired += rows.length;
    }
    return { changed: true, before, after, warnings: result.warnings, expired, closedGate };
  });
}

export async function setMode(
  deps: SettingsDeps,
  ctx: TenantContext,
  mailboxId: string,
  input: { mode: MailboxMode; keepSwitches: boolean; actor: string }
): Promise<SettingsChange> {
  return applyChange(deps, ctx, mailboxId, input.actor, (before) => {
    const setSwitches = input.mode === "assist" && !input.keepSwitches;
    const toolSwitches: ToolSwitches = setSwitches
      ? { ...before.toolSwitches, ...ASSIST_DEFAULT_SWITCHES }
      : before.toolSwitches;
    const switchesChanged = JSON.stringify(toolSwitches) !== JSON.stringify(before.toolSwitches);
    const switchesOff = (Object.keys(before.toolSwitches) as (keyof ToolSwitches)[]).filter(
      (name) => before.toolSwitches[name] && !toolSwitches[name]
    );
    const warnings =
      input.mode === "assist" && !before.movesSupported ? ["moves not supported: moves stay log only"] : [];
    return {
      patch: { mode: input.mode, ...(switchesChanged ? { toolSwitches } : {}) },
      changed: input.mode !== before.mode || switchesChanged,
      event: auditEvents.mailboxModeChanged,
      data: {
        field: "mode",
        from: before.mode,
        to: input.mode,
        ...(setSwitches ? { switches_set: true } : {}),
      },
      close: { field: "mode", to: input.mode },
      alsoClose: switchesOff.map((name) => ({ field: "switch", name, to: false })),
      warnings,
    };
  });
}

export async function setCategoryAuto(
  deps: SettingsDeps,
  ctx: TenantContext,
  mailboxId: string,
  input: {
    category: BarCategory;
    auto: boolean;
    threshold?: number;
    gate: { decision: GoDecision | "skipped"; precision: number | null; kept: number; forced: boolean };
    actor: string;
  }
): Promise<SettingsChange> {
  if (input.auto && input.gate.decision !== "go" && !input.gate.forced) {
    throw new HardError("category did not pass go/no-go");
  }
  return applyChange(deps, ctx, mailboxId, input.actor, (before) => {
    const wasAuto = autoFor(before.categoryPolicy, input.category);
    const oldThreshold = thresholdFor(before.categoryPolicy, input.category);
    const threshold = input.threshold ?? oldThreshold;
    const categoryPolicy: CategoryPolicy = {
      ...before.categoryPolicy,
      [input.category]: { auto: input.auto, threshold },
    };
    return {
      patch: { categoryPolicy },
      changed: wasAuto !== input.auto || oldThreshold !== threshold,
      event: auditEvents.mailboxPolicyChanged,
      data: {
        field: `auto.${input.category}`,
        from: wasAuto,
        to: input.auto,
        threshold_from: oldThreshold,
        threshold_to: threshold,
        forced: input.gate.forced,
      },
      close: {
        field: "auto",
        category: input.category,
        to: input.auto,
        thresholdRaised: wasAuto && input.auto && threshold > oldThreshold,
      },
      warnings: [],
    };
  });
}

export async function setToolSwitch(
  deps: SettingsDeps,
  ctx: TenantContext,
  mailboxId: string,
  input: { name: keyof ToolSwitches; value: boolean; actor: string }
): Promise<SettingsChange> {
  return applyChange(deps, ctx, mailboxId, input.actor, (before) => ({
    patch: { toolSwitches: { ...before.toolSwitches, [input.name]: input.value } },
    changed: before.toolSwitches[input.name] !== input.value,
    event: auditEvents.mailboxSwitchChanged,
    data: { field: `switch.${input.name}`, from: before.toolSwitches[input.name], to: input.value },
    close: { field: "switch", name: input.name, to: input.value },
    warnings: input.name === "create_draft" ? ["create_draft: S4, no effect yet"] : [],
  }));
}
