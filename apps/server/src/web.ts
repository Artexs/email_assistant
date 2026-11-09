import { resolve } from "node:path";

import { scopeInfoOf } from "@ea/core";
import { getConnInfo } from "@hono/bun";
import type { Context } from "hono";

import { auditEvents, recordAudit } from "./modules/audit";
import { listMailboxes } from "./modules/mail";
import { listMembershipsOfUser, tenancyRoutes, type TenancyRouteDeps } from "./modules/tenancy";
import { createAuth, type AuthDeps, type AuthEventKind } from "./platform/auth";
import { webTrustedOrigins, webTrustedProxies, type Config } from "./platform/config";
import type { Db } from "./platform/db";
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

export function countMailboxes(db: Db): TenancyRouteDeps["countMailboxes"] {
  return async (ctx) => {
    const rows = await listMailboxes(db, ctx);
    return { total: rows.length, inAuthError: rows.filter((row) => row.status === "auth_error").length };
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

// null: the web is off.
export function webDeps(config: Config, db: Db): WebRuntime | null {
  if (config.WEB_BASE_URL === undefined) {
    log.info("web is off (WEB_BASE_URL is empty)");
    return null;
  }
  const baseUrl = new URL(config.WEB_BASE_URL);
  if (baseUrl.protocol === "http:" && !LOOPBACK_HOSTS.includes(baseUrl.hostname)) {
    log.warn("WEB_BASE_URL is http:// on a non-loopback host: cookies are not Secure");
  }
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

  const getSession = async (headers: Headers): Promise<WebSession | null> => {
    const response = await handle.auth.api.getSession({ headers, returnHeaders: true });
    if (!response?.response) return null;
    return { userId: response.response.user.id, setCookie: response.headers.getSetCookie() };
  };

  log.info(`web is on: ${baseUrl.origin}, dist ${dist}`);
  return {
    auth: { handler: (req) => handle.auth.handler(req), getSession },
    db,
    now: () => new Date(),
    dist,
    baseUrl,
    trustedOrigins: new Set(origins),
    trustedProxies: buildTrustedProxies(webTrustedProxies(config)),
    connInfo: peerAddress,
    listMembershipsOfUser: (userId) => listMembershipsOfUser(db, userId),
    routers: (api) => api.route("/", tenancyRoutes({ db, scopes, countMailboxes: countMailboxes(db) })),
    close: () => handle.close(),
  };
}
