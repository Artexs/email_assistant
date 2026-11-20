// The real app of the server built with fakes: no DB, no network, no env file (`loadConfig` gets an object, not `process.env`).
// The route test (`openapi-routes.test.ts`) and the spec script (`scripts/api-spec.ts`) both build the app here, so the file
// that the docs site reads cannot differ from the app that the test checks.
import { loadConfig } from "./platform/config";
import { createSecretBox } from "./platform/crypto";
import type { Db } from "./platform/db";
import { buildTrustedProxies, createApp, type WebDeps } from "./platform/http";
import { apiPublicRouters, apiRouters } from "./web";

export function buildFakeApp() {
  const config = loadConfig({
    DATABASE_URL: "postgres://app:x@127.0.0.1:1/x",
    CREDENTIALS_KEY: Buffer.alloc(32, 1).toString("base64"),
    WEB_BASE_URL: "http://127.0.0.1:8080",
    WEB_AUTH_SECRET: "x".repeat(32),
  });
  const origin = config.WEB_BASE_URL as string;
  const extras = {
    secrets: createSecretBox(Buffer.alloc(32, 1).toString("base64"), 1),
    actionsScope: { kind: "off" },
    sendScope: { kind: "off" },
    botUsername: null,
  } as const;
  const web = {
    auth: { handler: async () => new Response(null), getSession: async () => null },
    db: {} as Db,
    now: () => new Date("2026-11-20T10:00:00Z"),
    dist: "/nonexistent/dist",
    baseUrl: new URL(origin),
    trustedOrigins: new Set([origin]),
    trustedProxies: buildTrustedProxies([]),
    connInfo: () => undefined,
    listMembershipsOfUser: async () => [],
    publicRouters: apiPublicRouters(config, {} as Db, extras, () => new Date("2026-11-20T10:00:00Z")),
    routers: apiRouters(
      config,
      {} as Db,
      extras,
      () => new Date("2026-11-20T10:00:00Z"),
      async () => [],
      async () => null,
      {
        lockout: {
          isLocked: async () => false,
          recordFailure: async () => null,
          recordSuccess: async () => undefined,
          clear: async () => undefined,
          claimMail: async () => false,
        },
        onEvent: async () => undefined,
        verifyPassword: async () => false,
        expiredSessionCookie: async () => "",
      }
    ),
  } satisfies WebDeps;
  return createApp({ checkDb: async () => true, web });
}
