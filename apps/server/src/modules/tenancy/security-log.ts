import {
  SECURITY_LOG_DAYS,
  SECURITY_LOG_LIMIT,
  securityEventCodes,
  securityKindOf,
  type SecurityLog,
  type SecurityLogActor,
  type SecurityLogEntry,
} from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import { listAuditEvents } from "../audit";

import { listMemberships } from "./repo";

const DAY_MS = 24 * 60 * 60 * 1000;

function lockedUntilOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const value = (data as Record<string, unknown>).locked_until;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// The newest security events of the organization (plan D27): names of members only, no address, no id, no IP.
export async function listSecurityLog(db: Db, ctx: TenantContext, now: Date): Promise<SecurityLog> {
  const rows = await listAuditEvents(db, ctx, {
    events: securityEventCodes,
    since: new Date(now.getTime() - SECURITY_LOG_DAYS * DAY_MS),
    limit: SECURITY_LOG_LIMIT,
  });
  const names = new Map((await listMemberships(db, ctx)).map((member) => [member.user_id, member.display_name]));
  const entries: SecurityLogEntry[] = [];
  for (const row of rows) {
    const kind = securityKindOf(row.event);
    if (kind === null) continue;
    entries.push({
      at: row.at.toISOString(),
      kind,
      actor: actorOf(row.actor, names),
      lockedUntil: lockedUntilOf(row.data),
    });
  }
  return { entries };
}

function actorOf(actor: string, names: ReadonlyMap<string, string>): SecurityLogActor {
  const name = names.get(actor);
  if (name !== undefined) return { kind: "member", name };
  if (actor === "cli") return { kind: "operator" };
  if (actor === "system") return { kind: "system" };
  return { kind: "former_member" };
}
