import { parseDigestTimes, type Me, type Onboarding, type ScopeInfo } from "@ea/core";
import { Hono } from "hono";

import type { Db, TenantContext } from "../../platform/db";
import { requireOwner, type ApiEnv } from "../../platform/http";

import { getMembership, getOrganization } from "./repo";

export interface TenancyRouteDeps {
  db: Db;
  now(): Date;
  scopes: { triage: ScopeInfo; actions: ScopeInfo; send: ScopeInfo };
  countMailboxes: (ctx: TenantContext) => Promise<{ total: number; inAuthError: number }>; // web.ts implements it with the mail index
  onboarding: (ctx: TenantContext, userId: string) => Promise<Onboarding>;
  telegram: (
    ctx: TenantContext,
    userId: string
  ) => Promise<{ available: boolean; linked: boolean; botUsername: string | null }>;
  keepMode: (ctx: TenantContext, userId: string, now: Date) => Promise<void>;
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
    const [onboarding, telegram] = await Promise.all([deps.onboarding(ctx, userId), deps.telegram(ctx, userId)]);
    const me: Me = {
      user: { id: userId, email: member.email, displayName: member.display_name },
      organization: { id: organization.id, name: organization.name, timezone: organization.timezone },
      role: c.get("role"),
      telegram,
      onboarding,
      scopes: deps.scopes,
      mailboxCount: mailboxes.total,
      mailboxesInAuthError: mailboxes.inAuthError,
      digestTimes: parseDigestTimes(member.digest_times),
    };
    return c.json(me);
  });

  // D15: keep shadow mode once; a second call writes nothing and answers 204 too.
  app.post("/onboarding/keep-mode", requireOwner, async (c) => {
    await deps.keepMode(c.get("ctx"), c.get("session").userId, deps.now());
    return c.body(null, 204);
  });

  return app;
}
