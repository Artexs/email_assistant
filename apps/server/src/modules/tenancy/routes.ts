import {
  digestTimesBodySchema,
  orgPlanSchema,
  organizationPatchSchema,
  parseDigestTimes,
  type Me,
  type Onboarding,
  type OrganizationSettings,
  type ScopeInfo,
} from "@ea/core";
import { Hono } from "hono";

import type { Db, TenantContext } from "../../platform/db";
import { parseBody, requireOwner, ValidationError, type ApiEnv } from "../../platform/http";

import { getMembership, getOrganization, setDigestTimes } from "./repo";
import { organizationView, updateOrganizationSettings } from "./service";

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
  operatorContact: string | null; // the public OPERATOR_CONTACT value (D29), not a secret
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
    const organizationPlan = orgPlanSchema.parse(organization.plan);
    const me: Me = {
      user: { id: userId, email: member.email, displayName: member.display_name },
      organization: {
        id: organization.id,
        name: organization.name,
        timezone: organization.timezone,
        plan: organizationPlan,
        trialEndsAt: organization.trial_ends_at?.toISOString() ?? null,
        maxMailboxes: organization.max_mailboxes,
      },
      operatorContact: deps.operatorContact,
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

  app.get("/organization", async (c) => {
    const row = await getOrganization(deps.db, c.get("ctx"));
    if (!row) return c.json({ error: "not_found" }, 404);
    const settings: OrganizationSettings = { ...organizationView(row), timezones: Intl.supportedValuesOf("timeZone") };
    return c.json(settings);
  });

  app.patch("/organization", requireOwner, async (c) => {
    const patch = await parseBody(c, organizationPatchSchema);
    const result = await updateOrganizationSettings(deps.db, c.get("ctx"), patch, {
      actor: c.get("session").userId,
      now: deps.now(),
    });
    if (result.kind === "bad_timezone") {
      throw new ValidationError([{ path: "timezone", code: "custom", message: "timezone_invalid" }]);
    }
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    return c.json(organizationView(result.organization));
  });

  // No audit row: the CLI writes none either.
  app.patch("/me/digest-times", async (c) => {
    const body = await parseBody(c, digestTimesBodySchema);
    const times = parseDigestTimes(body.times);
    if (!(await setDigestTimes(deps.db, c.get("ctx"), c.get("session").userId, times))) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ times });
  });

  // D15: keep shadow mode once; a second call writes nothing and answers 204 too.
  app.post("/onboarding/keep-mode", requireOwner, async (c) => {
    await deps.keepMode(c.get("ctx"), c.get("session").userId, deps.now());
    return c.body(null, 204);
  });

  return app;
}
