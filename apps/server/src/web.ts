import { resolve } from "node:path";

import { onboardingOf, scopeInfoOf, type ScopeEnv } from "@ea/core";
import { getConnInfo } from "@hono/bun";
import type { Context } from "hono";

import { settingsDeps } from "./composition";
import { auditEvents, hasAuditEvent, recordAudit, recordAuditOnce } from "./modules/audit";
import { channelRoutes, getChatLinkForUser, queueMailboxRemovedNotices } from "./modules/channels";
import { countSenderRules, rulesRoutes, settingsRoutes, type SettingsRouteDeps } from "./modules/config";
import {
  listMailboxes,
  listSyncFolders,
  mailRoutes,
  openImapProvider,
  setSyncFolderEnabled,
  verifySmtpLogin,
  WEB_MAIL_TIMEOUTS,
} from "./modules/mail";
import { activityRoutes } from "./modules/reports";
import { listMembershipsOfUser, tenancyRoutes, type TenancyRouteDeps } from "./modules/tenancy";
import { goNoGoFor, setCategoryAutoWithGate } from "./modules/triage";
import { createAuth, type AuthDeps, type AuthEventKind } from "./platform/auth";
import { webMailAllowLocal, webTrustedOrigins, webTrustedProxies, type Config } from "./platform/config";
import type { SecretBox } from "./platform/crypto";
import type { Db, TenantContext } from "./platform/db";
import { describeError } from "./platform/errors";
import { buildTrustedProxies, type WebDeps, type WebSession } from "./platform/http";
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

export type WebRuntime = WebDeps & { close(): Promise<void> };

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function scopeInfos(config: Config): TenancyRouteDeps["scopes"] {
  return {
    triage: scopeInfoOf(config.TRIAGE_LLM_SCOPE),
    actions: scopeInfoOf(config.ACTIONS_SCOPE),
    send: scopeInfoOf(config.SEND_SCOPE),
  };
}

export function scopeEnvOf(config: Config): ScopeEnv {
  return {
    triage: config.TRIAGE_LLM_SCOPE,
    actions: config.ACTIONS_SCOPE,
    send: config.SEND_SCOPE,
    testMailboxAddress: config.TEST_MAILBOX_ADDRESS ?? null,
  };
}

export function countMailboxes(db: Db): TenancyRouteDeps["countMailboxes"] {
  return async (ctx) => {
    const rows = await listMailboxes(db, ctx);
    return { total: rows.length, inAuthError: rows.filter((row) => row.status === "auth_error").length };
  };
}

// D15: the Telegram item is per user, the others per organization.
export function onboardingDeps(
  db: Db,
  botUsername: (() => Promise<string>) | null
): Pick<TenancyRouteDeps, "onboarding" | "telegram" | "keepMode"> {
  const linked = async (ctx: TenantContext, userId: string) =>
    (await getChatLinkForUser(db, ctx, userId)) !== undefined;
  return {
    onboarding: async (ctx, userId) =>
      onboardingOf({
        mailboxCount: (await listMailboxes(db, ctx)).length,
        telegramLinked: await linked(ctx, userId),
        telegramAvailable: botUsername !== null,
        modeChosen: await hasAuditEvent(db, ctx, [auditEvents.mailboxModeChanged, auditEvents.onboardingModeKept]),
        ruleCount: await countSenderRules(db, ctx),
      }),
    telegram: async (ctx, userId) => ({
      available: botUsername !== null,
      linked: await linked(ctx, userId),
      botUsername: botUsername ? await botUsername().catch(() => null) : null,
    }),
    keepMode: async (ctx, userId, now) => {
      await recordAuditOnce(db, ctx, {
        actor: userId,
        event: auditEvents.onboardingModeKept,
        data: { via: "web" },
        at: now,
      });
    },
  };
}

// `botUsername` only tells whether Telegram is on: a server without a bot never blocks `done` (B2).
export function homePathOf(
  db: Db,
  botUsername: (() => Promise<string>) | null = null
): NonNullable<WebDeps["homePath"]> {
  return async (userId) => {
    const [membership] = await listMembershipsOfUser(db, userId);
    if (!membership) return "/onboarding";
    const ctx = { orgId: membership.org_id };
    const state = await onboardingDeps(db, botUsername).onboarding(ctx, userId);
    return state.done ? "/activity" : "/onboarding";
  };
}

// D8, D16: the web calls the same setters as the CLI, with the one `settingsDeps` builder.
export function settingsRouteDeps(db: Db, now: () => Date): SettingsRouteDeps {
  const settings = settingsDeps(db, now);
  return {
    db,
    now,
    settings,
    goNoGo: (ctx, id, at) => goNoGoFor(db, ctx, id, at),
    setAuto: async (ctx, id, input) => {
      const result = await setCategoryAutoWithGate(settings, ctx, id, input);
      return result.kind === "refused" ? result : { kind: "changed", change: result.change };
    },
    listSyncFolders: async (ctx, id) =>
      (await listSyncFolders(db, ctx, id, { enabledOnly: false })).map(({ key, role, path, enabled }) => ({
        key,
        role,
        path,
        enabled,
      })),
    setSyncFolder: (ctx, id, input) =>
      setSyncFolderEnabled(db, ctx, id, input.key, input.enabled, input.actor, input.now),
  };
}

export function distPath(config: Config, cwd = process.cwd()): string {
  return resolve(cwd, config.WEB_DIST);
}

// @hono/bun throws without the Bun server (app.request in tests).
export function peerAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

export interface WebExtras {
  secrets: SecretBox;
  botUsername: (() => Promise<string>) | null; // null: Telegram is off
}

// null: the web is off.
export function webDeps(config: Config, db: Db, extras: WebExtras): WebRuntime | null {
  if (config.WEB_BASE_URL === undefined) {
    log.info("web is off (WEB_BASE_URL is empty)");
    return null;
  }
  const baseUrl = new URL(config.WEB_BASE_URL);
  if (baseUrl.protocol === "http:" && !LOOPBACK_HOSTS.includes(baseUrl.hostname)) {
    log.warn("WEB_BASE_URL is http:// on a non-loopback host: cookies are not Secure");
  }
  const allowLocalHosts = webMailAllowLocal(config);
  if (allowLocalHosts) log.warn("web: WEB_MAIL_ALLOW_LOCAL=true: the connect form accepts local hosts");
  const origins = [baseUrl.origin, ...webTrustedOrigins(config)];
  const handle = createAuth({
    databaseUrl: config.DATABASE_URL,
    baseUrl: config.WEB_BASE_URL,
    secret: config.WEB_AUTH_SECRET ?? "", // the config check guarantees it
    trustedOrigins: origins,
    onEvent: auditWebEvent(db),
  });
  const dist = distPath(config);
  const scopes = scopeInfos(config);
  const now = () => new Date();

  const getSession = async (headers: Headers): Promise<WebSession | null> => {
    const response = await handle.auth.api.getSession({ headers, returnHeaders: true });
    if (!response?.response) return null;
    return { userId: response.response.user.id, setCookie: response.headers.getSetCookie() };
  };

  log.info(`web is on: ${baseUrl.origin}, dist ${dist}`);
  return {
    auth: { handler: (req) => handle.auth.handler(req), getSession },
    db,
    now,
    dist,
    baseUrl,
    trustedOrigins: new Set(origins),
    trustedProxies: buildTrustedProxies(webTrustedProxies(config)),
    connInfo: peerAddress,
    listMembershipsOfUser: (userId) => listMembershipsOfUser(db, userId),
    homePath: homePathOf(db, extras.botUsername),
    routers: (api) => {
      api.route(
        "/",
        tenancyRoutes({
          db,
          now,
          scopes,
          countMailboxes: countMailboxes(db),
          ...onboardingDeps(db, extras.botUsername),
        })
      );
      api.route(
        "/",
        mailRoutes({
          db,
          now,
          scopeEnv: scopeEnvOf(config),
          connect: {
            db,
            secrets: extras.secrets,
            openProvider: openImapProvider,
            verifySmtp: verifySmtpLogin,
            timeouts: WEB_MAIL_TIMEOUTS,
          },
          allowLocalHosts,
          onRemoved: async (trx, ctx, input) => {
            await queueMailboxRemovedNotices(trx, ctx, input);
          },
        })
      );
      api.route("/", settingsRoutes(settingsRouteDeps(db, now)));
      api.route("/", rulesRoutes({ db, now }));
      api.route("/", activityRoutes({ db, now }));
      api.route("/", channelRoutes({ db, now, botUsername: extras.botUsername }));
    },
    close: () => handle.close(),
  };
}
