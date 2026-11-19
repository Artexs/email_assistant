import { actionTypes, type ActionType } from "@ea/core";
import { sql, type Expression, type ExpressionBuilder, type SqlBool } from "kysely";

import type { DB } from "../../../platform/db";
import { WRITER_GUARDS, type ActionStatus, type ActionWriter, type WriterGuard } from "../transitions";

// The type and status part of the `WHERE` of every status writer comes from a `WRITER_GUARDS` row (rule: the guard
// is part of the single `UPDATE`, so the check is atomic with the write). Other conditions stay in the writer.

// The one row of (writer, variant). A writer resolves its rows at module load: an unknown row throws at import.
export function writerGuard(writer: ActionWriter, variant: string): WriterGuard {
  const rows = WRITER_GUARDS.filter((row) => row.writer === writer && row.variant === variant);
  if (rows.length === 0) {
    throw new Error(`WRITER_GUARDS has no row for ${writer} / ${variant}`);
  }
  if (rows.length > 1) {
    throw new Error(`WRITER_GUARDS has ${rows.length} rows for ${writer} / ${variant}`);
  }
  return rows[0] as WriterGuard;
}

// Pure. Types grouped by an equal from-list after the narrowing, in `actionTypes` order; empty lists dropped.
export function guardGroups(
  guard: WriterGuard,
  narrow?: readonly ActionStatus[]
): { types: ActionType[]; statuses: ActionStatus[] }[] {
  const groups = new Map<string, { types: ActionType[]; statuses: ActionStatus[] }>();
  for (const type of actionTypes) {
    const from = guard.from[type] ?? [];
    const statuses = narrow === undefined ? [...from] : from.filter((status) => narrow.includes(status));
    if (statuses.length === 0) {
      continue;
    }
    const groupKey = statuses.join(",");
    const group = groups.get(groupKey);
    if (group) {
      group.types.push(type);
    } else {
      groups.set(groupKey, { types: [type], statuses });
    }
  }
  return [...groups.values()];
}

// OR over the groups of (type IN types AND status IN statuses); no group is a false literal (nothing is admitted).
export function statusGuard(
  eb: ExpressionBuilder<DB, "actions">,
  guard: WriterGuard,
  narrow?: readonly ActionStatus[]
): Expression<SqlBool> {
  const groups = guardGroups(guard, narrow);
  if (groups.length === 0) {
    return sql<SqlBool>`false`;
  }
  return eb.or(groups.map((group) => eb.and([eb("type", "in", group.types), eb("status", "in", group.statuses)])));
}
