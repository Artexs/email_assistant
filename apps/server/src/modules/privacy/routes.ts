import { orgDeleteRequestSchema, orgNameMatches, type OrgDeleteResponse } from "@ea/core";
import { Hono } from "hono";

import type { AuthDeps } from "../../platform/auth";
import { recordPasswordFailure, type LockoutStore } from "../../platform/auth-lockout";
import type { Db } from "../../platform/db";
import { parseBody, requireOwner, type ApiEnv } from "../../platform/http";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";
import { getMembership, getOrganization, isFeatureOn } from "../tenancy";

import { deleteOrganization } from "./delete";

const log = createLog("privacy");

export interface PrivacyRouteDeps {
  db: Db;
  now(): Date;
  lockout: LockoutStore;
  // The lock event and the lock mail of a wrong password (the same rule as sign-in).
  onEvent: AuthDeps["onEvent"];
  sendLockoutMail?: AuthDeps["sendLockoutMail"];
  // web.ts: `auth.api.verifyPassword` for the session of `headers`. A wrong password is `false`; any other error throws (500).
  verifyPassword(headers: Headers, password: string): Promise<boolean>;
  // web.ts: the `Set-Cookie` line that ends the Better Auth session cookie (name and attributes come from Better Auth).
  expiredSessionCookie(): Promise<string>;
}

// DELETE /api/organization, behind the flag `org_delete` (spec/features/active/F106-e7-t3-account-data-delete-export-dsr).
// Each answer below is final; the order is the rule:
// owner, flag, body, typed name, lock, password, delete. The password, the typed name and the organization name never reach
// a log line, an error text or an audit row. A right password does not reset the lockout count (only a sign-in does).
export function privacyRoutes(deps: PrivacyRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.delete("/organization", requireOwner, async (c) => {
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    if (!(await isFeatureOn(deps.db, ctx, "org_delete"))) return c.json({ error: "not_found" }, 404);
    const body = await parseBody(c, orgDeleteRequestSchema);

    const organization = await getOrganization(deps.db, ctx);
    if (!organization) return c.json({ error: "not_found" }, 404);
    // A wrong name is not a password guess: no audit row and no lockout count.
    if (!orgNameMatches(organization.name, body.confirmName)) return c.json({ error: "wrong_name" }, 400);

    if (await deps.lockout.isLocked(userId, deps.now())) return c.json({ error: "locked" }, 429);

    if (!(await deps.verifyPassword(c.req.raw.headers, body.password))) {
      const member = await getMembership(deps.db, ctx, userId);
      if (member) {
        await recordPasswordFailure(
          {
            lockout: deps.lockout,
            now: deps.now,
            onEvent: deps.onEvent,
            sendLockoutMail: deps.sendLockoutMail,
          },
          { id: userId, email: member.email }
        );
      }
      await recordAudit(deps.db, ctx, {
        actor: userId,
        event: auditEvents.orgDeleteRefused,
        data: { reason: "wrong_password", via: "web" },
      });
      return c.json({ error: "wrong_password" }, 400);
    }

    // Read before the delete: after it, an error here would answer 500 for an organization that is gone.
    const expiredCookie = await deps.expiredSessionCookie();
    const result = await deleteOrganization(deps.db, { orgId: ctx.orgId, confirmName: body.confirmName, via: "web" });
    switch (result.kind) {
      case "not_found":
        return c.json({ error: "not_found" }, 404);
      case "name_mismatch":
        // The organization was renamed between the check above and the delete.
        return c.json({ error: "wrong_name" }, 400);
      case "busy":
        // Nothing changed (a lock wait ran out). The owner may try again.
        log.warn("org_delete_busy", { org_id: ctx.orgId });
        return c.json({ error: "internal" }, 503);
      case "deleted": {
        c.header("set-cookie", expiredCookie, { append: true });
        return c.json({ mailboxAddresses: result.mailboxAddresses } satisfies OrgDeleteResponse);
      }
    }
  });

  return app;
}
