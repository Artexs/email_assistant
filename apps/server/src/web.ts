import { auditEvents, recordAudit } from "./modules/audit";
import { listMembershipsOfUser } from "./modules/tenancy";
import type { AuthDeps, AuthEventKind } from "./platform/auth";
import type { Db } from "./platform/db";
import { describeError } from "./platform/errors";
import { createLog } from "./platform/log";

// The composition root of the web: the parts that need more than one module.
const log = createLog("web");

const eventNames = {
  login: auditEvents.webLogin,
  password_set: auditEvents.webPasswordSet,
  password_changed: auditEvents.webPasswordChanged,
} satisfies Record<AuthEventKind, string>;

// D4: a login or a password change is a row in the audit log of the user's oldest organization. It never throws.
export function auditWebEvent(db: Db): AuthDeps["onEvent"] {
  return async (kind, userId) => {
    try {
      const [membership] = await listMembershipsOfUser(db, userId);
      if (!membership) {
        log.warn(`web: no organization for user ${userId}`);
        return;
      }
      await recordAudit(
        db,
        { orgId: membership.org_id },
        { event: eventNames[kind], actor: userId, data: { via: "web" } }
      );
    } catch (error) {
      log.error(`web: audit ${kind} failed: ${describeError(error)}`);
    }
  };
}
