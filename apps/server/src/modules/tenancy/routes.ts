import type { Me, ScopeInfo } from "@ea/core";
import { Hono } from "hono";

import type { Db, TenantContext } from "../../platform/db";
import type { ApiEnv } from "../../platform/http";

import { getMembership, getOrganization } from "./repo";

export interface TenancyRouteDeps {
  db: Db;
  scopes: { triage: ScopeInfo; actions: ScopeInfo; send: ScopeInfo };
  countMailboxes: (ctx: TenantContext) => Promise<{ total: number; inAuthError: number }>; // web.ts implements it with the mail index
}

export function tenancyRoutes(deps: TenancyRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.get("/me", async (c) => {
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    const organization = await getOrganization(deps.db, ctx);
    const member = await getMembership(deps.db, ctx, userId);
    if (!organization || !member) return c.json({ error: "not_found" }, 404);
    const mailboxes = await deps.countMailboxes(ctx);
    const me: Me = {
      user: { id: userId, email: member.email, displayName: member.display_name },
      organization: { id: organization.id, name: organization.name, timezone: organization.timezone },
      role: c.get("role"),
      telegram: null,
      onboarding: null,
      scopes: deps.scopes,
      mailboxCount: mailboxes.total,
      mailboxesInAuthError: mailboxes.inAuthError,
    };
    return c.json(me);
  });

  return app;
}
