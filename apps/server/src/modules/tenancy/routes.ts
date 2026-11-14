import {
  deviceOf,
  digestTimesBodySchema,
  localeBodySchema,
  orgPlanSchema,
  organizationPatchSchema,
  parseDigestTimes,
  TERMS_VERSION,
  termsAcceptBodySchema,
  type Me,
  type Onboarding,
  type OrganizationSettings,
  type ScopeInfo,
  type SecurityLog,
  type Sessions,
  type TwoFactorStatus,
} from "@ea/core";
import { Hono } from "hono";

import type { AuthSessionRow } from "../../platform/auth";
import type { Db, TenantContext } from "../../platform/db";
import { parseBody, requireOwner, ValidationError, type ApiEnv } from "../../platform/http";
import { auditEvents, recordAudit } from "../audit";

import { featureStates, isFeatureOn } from "./features";
import {
  getMembership,
  getOrganization,
  getUserAuthProfile,
  setDigestTimes,
  setUserLocale,
  setUserTerms,
} from "./repo";
import { listSecurityLog } from "./security-log";
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
  sessions: (userId: string) => Promise<AuthSessionRow[]>; // web.ts: listUserSessions of the auth handle (L21)
  operatorContact: string | null; // the public OPERATOR_CONTACT value (D29), not a secret
  backupCodesLeft: (userId: string) => Promise<number | null>; // web.ts: backupCodesLeft of the auth handle
  keepMode: (ctx: TenantContext, userId: string, now: Date) => Promise<void>;
}

export function tenancyRoutes(deps: TenancyRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // The own TOTP state. A read, so a suspended organization works. The body holds a count, never a code.
  app.get("/me/two-factor", async (c) => {
    const ctx = c.get("ctx");
    const { userId, twoFactorEnabled } = c.get("session");
    const member = await getMembership(deps.db, ctx, userId);
    const requiredBy: TwoFactorStatus["requiredBy"] = [];
    if (c.get("web").operatorUserIds?.has(userId) === true) requiredBy.push("operator");
    if (member?.break_glass === true) requiredBy.push("break_glass");
    const body: TwoFactorStatus = {
      enabled: twoFactorEnabled,
      backupCodesLeft: twoFactorEnabled ? await deps.backupCodesLeft(userId) : null,
      requiredBy,
    };
    return c.json(body);
  });

  app.get("/me", async (c) => {
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    const organization = await getOrganization(deps.db, ctx);
    const member = await getMembership(deps.db, ctx, userId);
    if (!organization || !member) return c.json({ error: "not_found" }, 404);
    const mailboxes = await deps.countMailboxes(ctx);
    const [onboarding, telegram] = await Promise.all([deps.onboarding(ctx, userId), deps.telegram(ctx, userId)]);
    const profile = await getUserAuthProfile(deps.db, userId);
    const organizationPlan = orgPlanSchema.parse(organization.plan);
    const me: Me = {
      user: { id: userId, email: member.email, displayName: member.display_name, locale: profile?.locale ?? null },
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
      terms: { accepted: profile?.termsVersion === TERMS_VERSION, current: TERMS_VERSION },
      // The same set that requireOperator reads (plan D23). The body never lists the operator ids.
      operator: c.get("web").operatorUserIds?.has(userId) === true,
      features: (await featureStates(deps.db, ctx)).filter((state) => state.enabled).map((state) => state.flag),
    };
    return c.json(me);
  });

  app.get("/organization", async (c) => {
    const row = await getOrganization(deps.db, c.get("ctx"));
    if (!row) return c.json({ error: "not_found" }, 404);
    const settings: OrganizationSettings = { ...organizationView(row), timezones: Intl.supportedValuesOf("timeZone") };
    return c.json(settings);
  });

  // Owner only first, then the flag: an assistant gets 403 whatever the flag says (plan D26).
  app.get("/security-log", requireOwner, async (c) => {
    const ctx = c.get("ctx");
    if (!(await isFeatureOn(deps.db, ctx, "security_log"))) return c.json({ error: "not_found" }, 404);
    return c.json((await listSecurityLog(deps.db, ctx, deps.now())) satisfies SecurityLog);
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

  // The language of the panel, Telegram and the account e-mails. Any member, own user only; no audit row (a display setting).
  app.patch("/me/locale", async (c) => {
    const body = await parseBody(c, localeBodySchema);
    if (!(await setUserLocale(deps.db, c.get("session").userId, body.locale)))
      return c.json({ error: "not_found" }, 404);
    return c.body(null, 204);
  });

  // L17: any member accepts the current terms; an old version answers 409 so the dialog reloads.
  // A repeat call answers 204 and writes nothing.
  app.post("/me/terms", async (c) => {
    const body = await parseBody(c, termsAcceptBodySchema);
    if (body.version !== TERMS_VERSION) return c.json({ error: "terms_outdated" }, 409);
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    const at = deps.now();
    await deps.db.transaction().execute(async (trx) => {
      // A repeat call changes nothing and writes no audit row.
      if (!(await setUserTerms(trx, userId, TERMS_VERSION, at))) return;
      await recordAudit(trx, ctx, {
        event: auditEvents.webTermsAccepted,
        actor: userId,
        data: { via: "web", version: TERMS_VERSION },
      });
    });
    return c.body(null, 204);
  });

  // L21: the member's own live sessions, newest first, never the token.
  app.get("/me/sessions", async (c) => {
    const { userId, sessionId } = c.get("session");
    const now = deps.now();
    const rows = (await deps.sessions(userId))
      .filter((row) => row.expiresAt > now)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const body: Sessions = {
      sessions: rows.map((row) => ({
        id: row.id,
        current: row.id === sessionId,
        device: deviceOf(row.userAgent),
        address: row.ipAddress,
        lastUsedAt: row.updatedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
    };
    return c.json(body);
  });

  // D15: keep shadow mode once; a second call writes nothing and answers 204 too.
  app.post("/onboarding/keep-mode", requireOwner, async (c) => {
    await deps.keepMode(c.get("ctx"), c.get("session").userId, deps.now());
    return c.body(null, 204);
  });

  return app;
}
