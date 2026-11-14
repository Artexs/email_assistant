import { randomUUID } from "node:crypto";

import { TERMS_VERSION } from "@ea/core";
import type { Hono } from "hono";

import { createOrganizationWithOwner, listMembershipsOfUser } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import type { Db } from "../../src/platform/db";
import { buildTrustedProxies, createApp, type ApiEnv, type WebDeps } from "../../src/platform/http";

// The body of a password set: every `/reset-password` call carries the current terms (F082 L16).
export function resetBody(
  newPassword: string,
  token: string
): { newPassword: string; token: string; termsVersion: string } {
  return { newPassword, token, termsVersion: TERMS_VERSION };
}

export const TEST_ORIGIN = "http://127.0.0.1:8080";

export interface WebTestOptions {
  db: Db;
  sessions: Record<string, string>; // cookie value -> user id
  routers: WebDeps["routers"];
  dist?: string; // default: a folder that does not exist
  homePath?: WebDeps["homePath"];
  isOrgSuspended?: WebDeps["isOrgSuspended"];
  operatorUserIds?: WebDeps["operatorUserIds"];
  twoFactorOff?: ReadonlySet<string>; // user ids whose fake session has TOTP off; every other user has it on
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
          ? { userId, sessionId: cookieOf(headers), twoFactorEnabled: opts.twoFactorOff?.has(userId) !== true }
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
    ...(opts.isOrgSuspended ? { isOrgSuspended: opts.isOrgSuspended } : {}),
    ...(opts.operatorUserIds ? { operatorUserIds: opts.operatorUserIds } : {}),
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
