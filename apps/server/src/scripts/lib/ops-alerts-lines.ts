import type { OpsAlertRow } from "../../modules/operator";

// One line per incident: the kind, the open time, the count of notices, the resolve time (or `open`) and the facts.
// Numbers, kinds and times only.
export function alertLine(row: OpsAlertRow): string {
  const facts = Object.entries(row.facts)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  const resolved = row.resolvedAt === null ? "open" : `resolved=${row.resolvedAt.toISOString()}`;
  return `${row.kind} opened=${row.openedAt.toISOString()} notices=${row.noticeCount} ${resolved}${facts === "" ? "" : ` ${facts}`}`;
}
