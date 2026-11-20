import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TERMS_VERSION } from "@ea/core";
import type { Hono } from "hono";

import type { PrivacyRouteDeps } from "../../src/modules/privacy";
import { createOrganizationWithOwner, listMembershipsOfUser } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import type { TenancyRouteDeps } from "../../src/modules/tenancy/routes";
import { createSecretBox } from "../../src/platform/crypto";
import type { Db } from "../../src/platform/db";
import { buildTrustedProxies, createApp, type ApiEnv, type WebDeps } from "../../src/platform/http";

// The body of a password set: every `/reset-password` call carries the current terms.
export function resetBody(
  newPassword: string,
  token: string
): { newPassword: string; token: string; termsVersion: string } {
  return { newPassword, token, termsVersion: TERMS_VERSION };
}

// The backup-code count of a test that does not read it.
export const noBackupCodes: TenancyRouteDeps["backupCodesLeft"] = async () => null;

// The privacy wiring of a test that does not call DELETE /api/organization (web.ts builds the real one).
export const noPrivacy: Omit<PrivacyRouteDeps, "db" | "now"> = {
  lockout: {
    isLocked: async () => false,
    recordFailure: async () => null,
    recordSuccess: async () => undefined,
    clear: async () => undefined,
    claimMail: async () => false,
  },
  onEvent: async () => undefined,
  verifyPassword: async () => false,
  expiredSessionCookie: async () => "ea.session_token=; Max-Age=0; Path=/",
};

export const TEST_ORIGIN = "http://127.0.0.1:8080";

export interface WebTestOptions {
  db: Db;
  sessions: Record<string, string>; // cookie value -> user id
  routers: WebDeps["routers"];
  publicRouters?: WebDeps["publicRouters"]; // routes before the session guard (the OAuth callback)
  dist?: string; // default: a folder that does not exist
  homePath?: WebDeps["homePath"];
  isOrgSuspended?: WebDeps["isOrgSuspended"];
  operatorUserIds?: WebDeps["operatorUserIds"];
  twoFactorOff?: ReadonlySet<string>; // user ids whose fake session has TOTP off; every other user has it on
  ssoUsers?: ReadonlySet<string>; // user ids whose fake session is an SSO session; every other session is a password session
  anySsoUsable?: WebDeps["anySsoUsable"]; // the read of GET /api/sign-in-options; absent = the route answers false
}

const cookieOf = (headers: Headers): string => headers.get("cookie")?.replace("ea.session_token=", "") ?? "";

export function webTestApp(opts: WebTestOptions): Hono<ApiEnv> {
  const { db, sessions } = opts;
  const web: WebDeps = {
    auth: {
      handler: async () => new Response(),
      getSession: async (headers) => {
        const userId = sessions[cookieOf(headers)];
        return userId
          ? {
              userId,
              sessionId: cookieOf(headers),
              twoFactorEnabled: opts.twoFactorOff?.has(userId) !== true,
              signInMethod: opts.ssoUsers?.has(userId) === true ? "sso" : "password",
            }
          : null;
      },
    },
    db,
    now: () => new Date(),
    dist: opts.dist ?? "/nonexistent/dist",
    baseUrl: new URL(TEST_ORIGIN),
    trustedOrigins: new Set([TEST_ORIGIN]),
    trustedProxies: buildTrustedProxies([]),
    connInfo: () => undefined,
    listMembershipsOfUser: (userId) => listMembershipsOfUser(db, userId),
    ...(opts.homePath ? { homePath: opts.homePath } : {}),
    routers: opts.routers,
    ...(opts.publicRouters ? { publicRouters: opts.publicRouters } : {}),
    ...(opts.isOrgSuspended ? { isOrgSuspended: opts.isOrgSuspended } : {}),
    ...(opts.operatorUserIds ? { operatorUserIds: opts.operatorUserIds } : {}),
    ...(opts.anySsoUsable ? { anySsoUsable: opts.anySsoUsable } : {}),
  };
  return createApp({ checkDb: async () => true, web });
}

export function as(cookie: string, init?: { method?: string; body?: unknown }): RequestInit {
  const headers: Record<string, string> = { cookie: `ea.session_token=${cookie}`, origin: TEST_ORIGIN };
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  return {
    method: init?.method ?? "GET",
    headers,
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  };
}

export interface WebOrg {
  orgId: string;
  ownerId: string;
  assistantId: string;
  otherOrgId: string;
  otherOwnerId: string;
  cleanup(): Promise<void>;
}

/** Committed rows: an organization with an owner and an assistant, and a second organization with its owner. */
export async function webOrg(db: Db): Promise<WebOrg> {
  const run = randomUUID();
  const first = await createOrganizationWithOwner(db, {
    orgName: "Web org",
    timezone: "Europe/Warsaw",
    email: `web-owner-${run}@x.test`,
    displayName: "Owner",
  });
  const second = await createOrganizationWithOwner(db, {
    orgName: "Web other org",
    timezone: "Europe/Warsaw",
    email: `web-other-${run}@x.test`,
    displayName: "Other owner",
  });
  const { id: assistantId } = await insertUser(db, {
    email: `web-assistant-${run}@x.test`,
    displayName: "Assistant",
  });
  await insertMembership(db, { orgId: first.orgId }, { userId: assistantId, role: "assistant" });
  const userIds = [first.userId, second.userId, assistantId];
  return {
    orgId: first.orgId,
    ownerId: first.userId,
    assistantId,
    otherOrgId: second.orgId,
    otherOwnerId: second.userId,
    async cleanup() {
      for (const orgId of [first.orgId, second.orgId]) {
        await db.deleteFrom("organizations").where("id", "=", orgId).execute();
      }
      await db.deleteFrom("users").where("id", "in", userIds).execute();
    },
  };
}

export const checkDb = async () => true;
export const extras = {
  secrets: createSecretBox(randomBytes(32).toString("base64"), 1),
  actionsScope: { kind: "off" } as const,
  sendScope: { kind: "off" } as const,
  botUsername: null,
};

export const GOOD = { cookie: "ea.session_token=good" };
export const REFRESH = { cookie: "ea.session_token=refresh" };
export const ORIGIN = { origin: "http://127.0.0.1:8080" };

export const AUTH_MAIL_OFF = {
  AUTH_SMTP_HOST: "",
  AUTH_SMTP_PORT: "",
  AUTH_SMTP_SECURITY: "",
  AUTH_SMTP_USER: "",
  AUTH_SMTP_PASSWORD: "",
  AUTH_MAIL_FROM: "",
};

// The temp `dist` folder and the web deps of the web-http test files. Each test file builds its own kit and registers
// its hooks: `createDist` before all, `close` after all. `dist` reads the folder that `createDist` made.
export function makeWebHttpKit(db: Db) {
  let dist = "";

  const createDist = (): void => {
    dist = mkdtempSync(join(tmpdir(), "ea-web-dist-"));
    for (const dir of ["login", "setup", "forgot", "mailboxes", "_astro", "icons", "offline.html"]) {
      mkdirSync(join(dist, dir));
    }
    writeFileSync(join(dist, "login/index.html"), "login page");
    writeFileSync(join(dist, "setup/index.html"), "setup page");
    writeFileSync(join(dist, "forgot/index.html"), "forgot page");
    writeFileSync(join(dist, "mailboxes/index.html"), "mailboxes page");
    writeFileSync(join(dist, "404.html"), "not found page");
    writeFileSync(join(dist, "_astro/x.js"), "console.log(1)");
    writeFileSync(join(dist, "favicon.png"), "png");
    // The installable shell. Astro writes the offline page as `offline.html/index.html`.
    writeFileSync(join(dist, "sw.js"), "self.addEventListener('fetch',()=>{})");
    writeFileSync(join(dist, "manifest.webmanifest"), '{"start_url":"/activity"}');
    writeFileSync(join(dist, "offline.html/index.html"), "offline page");
    writeFileSync(join(dist, "icons/icon-192.png"), "png");
  };

  const close = async (): Promise<void> => {
    rmSync(dist, { recursive: true, force: true });
    await db.destroy();
  };

  function makeWeb(overrides: Partial<WebDeps> = {}): WebDeps {
    return {
      auth: {
        handler: async (req) =>
          new Response(JSON.stringify({ path: new URL(req.url).pathname, ip: req.headers.get("x-client-ip") }), {
            status: 299,
          }),
        getSession: async (h) =>
          h.get("cookie") === "ea.session_token=good"
            ? { userId: "u1", sessionId: "s1", twoFactorEnabled: true, signInMethod: "password" }
            : h.get("cookie") === "ea.session_token=refresh"
              ? {
                  userId: "u1",
                  sessionId: "s1",
                  twoFactorEnabled: true,
                  signInMethod: "password",
                  setCookie: ["ea.session_token=new; Path=/; HttpOnly"],
                }
              : null,
      },
      db,
      now: () => new Date("2026-11-09T12:00:00Z"),
      dist,
      baseUrl: new URL("http://127.0.0.1:8080"),
      trustedOrigins: new Set(["http://127.0.0.1:8080", "http://localhost:4321"]),
      trustedProxies: buildTrustedProxies(["172.18.0.0/16"]),
      connInfo: () => "203.0.113.9",
      listMembershipsOfUser: async () => [{ org_id: randomUUID(), role: "owner" }],
      ...overrides,
    };
  }

  const appWith = (overrides: Partial<WebDeps> = {}) => createApp({ checkDb, web: makeWeb(overrides) });

  return {
    get dist() {
      return dist;
    },
    createDist,
    close,
    makeWeb,
    appWith,
  };
}
