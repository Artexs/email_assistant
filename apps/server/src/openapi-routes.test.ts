import { connectMailboxBodySchema } from "@ea/core";
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { loadConfig } from "./platform/config";
import { createSecretBox } from "./platform/crypto";
import type { Db } from "./platform/db";
import { buildTrustedProxies, createApp, type WebDeps } from "./platform/http";
import { apiDoc, openApiSpec } from "./platform/openapi";
import { apiRouters } from "./web";

// Every `/api` route has an `apiDoc` (ADR 0023), or a hidden key with a reason. This test fails for a route that has
// neither, and for a hidden key that no longer holds. A new route is described: there is no list of gaps. The real app is built with fakes: no DB is read.

const HIDDEN_ROUTES: Record<string, string> = {
  "GET /api/auth/*": "Better Auth",
  "POST /api/auth/*": "Better Auth",
  "GET /api/openapi.json": "the OpenAPI file itself",
  "GET /api/operator/flags": "operator only, not public (E10)",
  "GET /api/operator/notices": "operator only, not public (E10)",
  "GET /api/operator/orgs": "operator only, not public (E10)",
  "GET /api/operator/orgs/:orgId": "operator only, not public (E10)",
  "POST /api/operator/orgs/:orgId/flags": "operator only, not public (E10)",
  "POST /api/operator/orgs/:orgId/plan": "operator only, not public (E10)",
};

type Spec = Awaited<ReturnType<typeof openApiSpec>>;
interface RequestBodyJson {
  content?: Record<string, { schema?: unknown } | undefined>;
}
interface ResponseJson {
  content?: Record<string, { schema?: unknown } | undefined>;
}

// The route keys of an app under `/api/`: `"<METHOD> <path with :params>"`. An `ALL` entry with a `*` path is a
// middleware or the 404 catch-all, so it is no route. An `ALL` entry without `*` would hide a real route: it throws.
interface RouteSource {
  routes: readonly { method: string; path: string }[];
}

export function routeKeys(app: RouteSource): Set<string> {
  const keys = new Set<string>();
  for (const { method, path } of app.routes) {
    if (!path.startsWith("/api/")) continue;
    if (method === "ALL") {
      if (!path.endsWith("*")) throw new Error(`ALL route without a wildcard path: ${path}`);
      continue;
    }
    keys.add(`${method} ${path}`);
  }
  return keys;
}

function describedKeys(spec: Spec): Set<string> {
  const keys = new Set<string>();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(item ?? {})) {
      keys.add(`${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":$1")}`);
    }
  }
  return keys;
}

export function routeGaps(
  app: RouteSource,
  spec: Spec,
  hidden: Record<string, string>
): { undescribed: string[]; stale: string[] } {
  const keys = routeKeys(app);
  const described = describedKeys(spec);
  const listed = new Set(Object.keys(hidden));
  const undescribed = [...keys].filter((key) => !described.has(key) && !listed.has(key));
  const stale = [...listed].filter((key) => described.has(key) || !keys.has(key));
  return { undescribed: undescribed.sort(), stale: stale.sort() };
}

// The rules of the file itself: one operationId each, a 2xx JSON schema on each operation, a reason on each hidden key.
export function specProblems(spec: Spec, hidden: Record<string, string>): string[] {
  const problems: string[] = [];
  const ids = new Map<string, string>();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(item ?? {})) {
      const key = `${method.toUpperCase()} ${path}`;
      const op = operation as { operationId?: string; responses?: Record<string, ResponseJson | undefined> };
      if (!op.operationId) problems.push(`no operationId: ${key}`);
      else if (ids.has(op.operationId))
        problems.push(`operationId ${op.operationId}: ${ids.get(op.operationId)}, ${key}`);
      else ids.set(op.operationId, key);
      // 204 is an empty answer: it has no body to describe.
      const ok = Object.entries(op.responses ?? {}).some(
        ([status, response]) =>
          status === "204" || (/^2\d\d$/.test(status) && response?.content?.["application/json"]?.schema !== undefined)
      );
      if (!ok) problems.push(`no 2xx JSON schema: ${key}`);
    }
  }
  for (const [key, reason] of Object.entries(hidden)) {
    if (reason.trim() === "") problems.push(`hidden without a reason: ${key}`);
  }
  return problems;
}

const doc = (operationId: string) =>
  apiDoc({ operationId, summary: "s", tags: ["t"], ok: { status: 200, schema: z.object({ ok: z.boolean() }) } });

describe("routeGaps", () => {
  test("lists an undescribed route", async () => {
    const app = new Hono();
    app.get("/api/y", (c) => c.json({}));
    const gaps = routeGaps(app, await openApiSpec(app), {});
    expect(gaps).toEqual({ undescribed: ["GET /api/y"], stale: [] });
  });

  test("lists a hidden key whose route is described, or gone", async () => {
    const app = new Hono();
    app.get("/api/z", doc("z"), (c) => c.json({ ok: true }));
    const gaps = routeGaps(app, await openApiSpec(app), { "GET /api/z": "r", "GET /api/gone": "r" });
    expect(gaps).toEqual({ undescribed: [], stale: ["GET /api/gone", "GET /api/z"] });
  });

  test("a hidden route that has no apiDoc is no gap", async () => {
    const app = new Hono();
    app.get("/api/a", (c) => c.json({}));
    const gaps = routeGaps(app, await openApiSpec(app), { "GET /api/a": "r" });
    expect(gaps).toEqual({ undescribed: [], stale: [] });
  });

  test("a middleware entry (ALL, wildcard path) is no route; an ALL entry without a wildcard fails", () => {
    const app = new Hono();
    app.use("/api/*", async (_c, next) => next());
    app.get("/api/y", (c) => c.json({}));
    expect([...routeKeys(app)]).toEqual(["GET /api/y"]);
    app.all("/api/open", (c) => c.json({}));
    expect(() => routeKeys(app)).toThrow("ALL route without a wildcard path: /api/open");
  });
});

describe("specProblems", () => {
  test("reports two routes with one operationId", async () => {
    const app = new Hono();
    app.get("/api/a", doc("same"), (c) => c.json({ ok: true }));
    app.get("/api/b", doc("same"), (c) => c.json({ ok: true }));
    expect(specProblems(await openApiSpec(app), {})).toEqual(["operationId same: GET /api/a, GET /api/b"]);
  });

  test("reports a route without a 2xx JSON schema", async () => {
    const app = new Hono();
    app.get("/api/a", describeWithoutSchema(), (c) => c.json({}));
    expect(specProblems(await openApiSpec(app), {})).toEqual(["no 2xx JSON schema: GET /api/a"]);
  });

  test("reports a hidden key with an empty reason", async () => {
    expect(specProblems(await openApiSpec(new Hono()), { "GET /api/a": " " })).toEqual([
      "hidden without a reason: GET /api/a",
    ]);
  });
});

// Written with `describeRoute` on purpose: `apiDoc` always gives a 2xx JSON schema.
function describeWithoutSchema() {
  return describeRoute({ operationId: "bare", summary: "s", tags: ["t"], responses: { 200: { description: "OK" } } });
}

function realApp() {
  const config = loadConfig({
    DATABASE_URL: "postgres://app:x@127.0.0.1:1/x",
    CREDENTIALS_KEY: Buffer.alloc(32, 1).toString("base64"),
    WEB_BASE_URL: "http://127.0.0.1:8080",
    WEB_AUTH_SECRET: "x".repeat(32),
  });
  const origin = config.WEB_BASE_URL as string;
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
    routers: apiRouters(
      config,
      {} as Db,
      {
        secrets: createSecretBox(Buffer.alloc(32, 1).toString("base64"), 1),
        actionsScope: { kind: "off" },
        botUsername: null,
      },
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

describe("the real app", () => {
  test("every /api route is described or hidden, and no hidden key is stale", async () => {
    const app = realApp();
    const spec = await openApiSpec(app);
    expect(routeGaps(app, spec, HIDDEN_ROUTES)).toEqual({ undescribed: [], stale: [] });
    expect(specProblems(spec, HIDDEN_ROUTES)).toEqual([]);
  });

  test("the operations of the file plus the hidden keys are the route keys of the app", async () => {
    const app = realApp();
    const keys = routeKeys(app);
    const operations = describedKeys(await openApiSpec(app));
    expect(keys.size).toBe(operations.size + Object.keys(HIDDEN_ROUTES).length);
    expect(new Set([...operations, ...Object.keys(HIDDEN_ROUTES)])).toEqual(keys);
  });

  test("POST /api/mailboxes has the connect body: its required list is that of the connect body schema", async () => {
    const spec = await openApiSpec(realApp());
    const body = spec.paths?.["/api/mailboxes"]?.post?.requestBody as RequestBodyJson | undefined;
    const schema = body?.content?.["application/json"]?.schema as { required?: string[] } | undefined;
    const expected = z.toJSONSchema(connectMailboxBodySchema, { io: "input", unrepresentable: "any" }) as {
      required?: string[];
    };
    expect(expected.required).toEqual(["address", "password", "secretKind"]);
    expect(schema?.required).toEqual(expected.required);
  });

  test("PATCH /api/settings/{mailboxId}/mode has the path parameter mailboxId and a request body", async () => {
    const operation = (await openApiSpec(realApp())).paths?.["/api/settings/{mailboxId}/mode"]?.patch;
    // One entry, typed as a UUID (hono-openapi alone would list a plain string).
    expect(operation?.parameters).toMatchObject([
      { name: "mailboxId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    ]);
    expect(operation?.requestBody).toBeDefined();
  });

  test("PUT /api/settings/{mailboxId}/urgency is described: uuid path parameter, body, settings view answer, owner_only", async () => {
    const operation = (await openApiSpec(realApp())).paths?.["/api/settings/{mailboxId}/urgency"]?.put as {
      parameters?: unknown;
      requestBody?: unknown;
      responses?: Record<string, { description?: string } | undefined>;
    };
    expect(operation?.parameters).toMatchObject([
      { name: "mailboxId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    ]);
    expect(operation.requestBody).toBeDefined();
    expect(operation.responses?.["200"]).toBeDefined();
    expect(operation.responses?.["403"]?.description).toContain("owner_only");
  });

  test("an empty answer is described as 204 with no body, and the shared guard codes are listed", async () => {
    const operation = (await openApiSpec(realApp())).paths?.["/api/me/locale"]?.patch as {
      responses?: Record<string, { description?: string } | undefined>;
    };
    expect(Object.keys(operation.responses ?? {}).sort()).toEqual(["204", "400", "401", "403", "404", "413"]);
    expect(operation.responses?.["403"]?.description).toBe("Error codes: no_organization, org_suspended, bad_origin");
  });

  test("GET /api/activity has the query parameters before and limit", async () => {
    const operation = (await openApiSpec(realApp())).paths?.["/api/activity"]?.get;
    const names = (operation?.parameters as { name: string; in: string }[] | undefined)?.map(
      (p) => `${p.in}:${p.name}`
    );
    expect(names).toContain("query:before");
    expect(names).toContain("query:limit");
  });

  test("POST /api/actions/{id}/reject-reason lists the codes not_found and not_rejected", async () => {
    const operation = (await openApiSpec(realApp())).paths?.["/api/actions/{id}/reject-reason"]?.post as {
      responses?: Record<string, { description?: string } | undefined>;
    };
    expect(operation.responses?.["404"]?.description).toContain("not_found");
    expect(operation.responses?.["409"]?.description).toContain("not_rejected");
  });

  test("the middleware entries are no route keys", () => {
    const app = realApp();
    // The app has middleware entries under /api (the guards, the 404 catch-all); none of them is a key.
    expect(
      app.routes.filter((route) => route.method === "ALL" && route.path.startsWith("/api/")).length
    ).toBeGreaterThan(3);
    expect([...routeKeys(app)].filter((key) => key.startsWith("ALL "))).toEqual([]);
  });
});

describe("a route before the session guard", () => {
  test("is in the file with security [], and a guarded route keeps the default", async () => {
    const root = new Hono();
    root.get("/api/pub", apiDoc({ ...baseDoc("pub"), public: true }), (c) => c.json({ ok: true }));
    const guarded = new Hono();
    guarded.get("/priv", doc("priv"), (c) => c.json({ ok: true }));
    root.route("/api", guarded);
    const spec = await openApiSpec(root);
    expect(spec.paths?.["/api/pub"]?.get?.security).toEqual([]);
    expect(spec.paths?.["/api/priv"]?.get?.security).toBeUndefined();
    expect(spec.security).toEqual([{ session: [] }]);
  });

  test("the file that createApp serves equals openApiSpec of its app", async () => {
    const origin = "http://127.0.0.1:8080";
    const web = {
      auth: {
        handler: async () => new Response(null),
        getSession: async () => ({
          userId: "u",
          sessionId: "s",
          twoFactorEnabled: true,
          signInMethod: "password" as const,
        }),
      },
      db: {} as Db,
      now: () => new Date("2026-11-20T10:00:00Z"),
      dist: "/nonexistent/dist",
      baseUrl: new URL(origin),
      trustedOrigins: new Set([origin]),
      trustedProxies: buildTrustedProxies([]),
      connInfo: () => undefined,
      listMembershipsOfUser: async () => [{ org_id: "org-1", role: "owner" as const }],
      routers: (api) => {
        api.get("/one", doc("one"), (c) => c.json({ ok: true }));
      },
    } satisfies WebDeps;
    const app = createApp({ checkDb: async () => true, web });
    const served = await (await app.request("/api/openapi.json")).json();
    expect(Object.keys((served as Spec).paths ?? {})).toEqual(["/api/one"]);
    expect(served).toEqual(JSON.parse(JSON.stringify(await openApiSpec(app))));
  });
});

function baseDoc(operationId: string) {
  return {
    operationId,
    summary: "s",
    tags: ["t"],
    ok: { status: 200 as const, schema: z.object({ ok: z.boolean() }) },
  };
}
