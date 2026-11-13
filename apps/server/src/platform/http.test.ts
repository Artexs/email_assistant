import type { BlockList } from "node:net";

import { describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";

import {
  authRequest,
  buildTrustedProxies,
  clientAddress,
  createApp,
  incomingRequestId,
  normalizeAddress,
  originAllowed,
  parseBody,
  PUBLIC_PAGE_PATHS,
  requireOperator,
  requireOwner,
  requireTenant,
  ValidationError,
  type ApiEnv,
  type WebDeps,
} from "./http";
import { setLogFormat, setLogLevel } from "./log";

describe("GET /health", () => {
  test("returns 200 when the DB is up", async () => {
    const res = await createApp({ checkDb: async () => true, web: null }).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "up" });
  });

  test("returns 503 when the DB is down", async () => {
    const res = await createApp({ checkDb: async () => false, web: null }).request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error", db: "down" });
  });

  test("returns 500 with a generic body when the check throws", async () => {
    const res = await createApp({
      checkDb: async () => {
        throw new Error("boom");
      },
      web: null,
    }).request("/health");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });

  test("returns 404 for unknown routes", async () => {
    const res = await createApp({ checkDb: async () => true, web: null }).request("/nope");
    expect(res.status).toBe(404);
  });
});

describe("incomingRequestId", () => {
  const U = "3f2b8c1d-4e5a-4b6c-8d7e-9f0a1b2c3d4e";
  const trusted = buildTrustedProxies(["172.18.0.0/16"]);
  test.each([
    [U, "172.18.0.1", U],
    [U.toUpperCase(), "172.18.0.1", U],
    [U, "::ffff:172.18.0.1", U],
    [U, "203.0.113.9", null],
    [U, undefined, null],
    [undefined, "172.18.0.1", null],
    ["abc", "172.18.0.1", null],
    [`${U},${U}`, "172.18.0.1", null],
    ["x".repeat(36), "172.18.0.1", null],
  ])("header %j from peer %j -> %j", (header, peer, expected) => {
    expect(incomingRequestId(header, peer, trusted)).toBe(expected);
  });
});

describe("x-request-id", () => {
  const U = "3f2b8c1d-4e5a-4b6c-8d7e-9f0a1b2c3d4e";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  test("every response kind has the header, and each request gets its own id", async () => {
    const ok = createApp({ checkDb: async () => true, web: null });
    const broken = createApp({
      checkDb: async () => {
        throw new Error("boom");
      },
      web: null,
    });
    const [health, again, missing, failed, foreign] = await Promise.all([
      ok.request("/health"),
      ok.request("/health"),
      ok.request("/nope"),
      broken.request("/health"),
      ok.request("/health", { headers: { "x-request-id": U } }),
    ]);

    expect([health.status, missing.status, failed.status]).toEqual([200, 404, 500]);
    for (const res of [health, again, missing, failed, foreign]) {
      expect(res.headers.get("x-request-id")).toMatch(UUID);
    }
    expect(health.headers.get("x-request-id")).not.toBe(again.headers.get("x-request-id"));
    expect(foreign.headers.get("x-request-id")).not.toBe(U);
  });

  test("the access line carries the request id of the response header", async () => {
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    let calls: unknown[][] = [];
    let res: Response;
    setLogFormat("json");
    setLogLevel("debug");
    try {
      res = await createApp({ checkDb: async () => true, web: null }).request("/health");
    } finally {
      calls = [...logSpy.mock.calls];
      setLogFormat("text");
      setLogLevel("info");
      logSpy.mockRestore();
    }

    const lines = calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.event).toBe("http_request");
    expect(lines[0]?.request_id).toBe(res.headers.get("x-request-id"));
  });
});

describe("clientAddress", () => {
  const t = buildTrustedProxies(["172.18.0.0/16"]);
  test.each([
    ["172.18.0.1", "203.0.113.9", "203.0.113.9"],
    ["172.18.0.1", "203.0.113.9, 172.18.0.5", "203.0.113.9"],
    ["172.18.0.1", "203.0.113.9, 10.0.0.1", "10.0.0.1"],
    ["203.0.113.9", "1.2.3.4", "203.0.113.9"],
    ["::ffff:172.18.0.1", "203.0.113.9", "203.0.113.9"],
    ["172.18.0.1", "garbage, 203.0.113.9", "203.0.113.9"],
    ["172.18.0.1", "1.2.3.4, 203.0.113.9:5123", "172.18.0.1"],
    ["172.18.0.1", "172.18.0.9", "172.18.0.1"],
  ])("peer %s, forwarded %s -> %s", (peer, forwarded, expected) => {
    expect(clientAddress(peer, forwarded, t)).toBe(expected);
  });

  test("an unknown peer gives null", () => {
    expect(clientAddress(undefined, "1.2.3.4", t)).toBeNull();
  });

  test("a trusted peer without a forwarded header gives the peer", () => {
    expect(clientAddress("127.0.0.1", undefined, buildTrustedProxies(["127.0.0.1"]))).toBe("127.0.0.1");
  });
});

describe("buildTrustedProxies and normalizeAddress", () => {
  test("matches subnets and single addresses for both families", () => {
    const t: BlockList = buildTrustedProxies(["10.0.0.0/8", "fd00::/8", "172.18.0.1"]);
    expect(t.check("10.1.2.3", "ipv4")).toBe(true);
    expect(t.check("11.0.0.1", "ipv4")).toBe(false);
    expect(t.check("fd00::1", "ipv6")).toBe(true);
    expect(t.check("172.18.0.1", "ipv4")).toBe(true);
    expect(t.check("172.18.0.2", "ipv4")).toBe(false);
  });

  test("an invalid entry throws", () => {
    expect(() => buildTrustedProxies(["nope"])).toThrow();
  });

  test.each(["10.0.0.0/", "10.0.0.0/8/9", "10.0.0.0/ 8"])("a malformed prefix %j throws", (entry) => {
    expect(() => buildTrustedProxies([entry])).toThrow();
  });

  test("normalizeAddress unwraps IPv4-mapped addresses only", () => {
    expect(normalizeAddress("::ffff:10.0.0.1")).toBe("10.0.0.1");
    expect(normalizeAddress("2001:db8::1")).toBe("2001:db8::1");
  });
});

describe("originAllowed", () => {
  const origins = new Set(["https://ea.test"]);
  const req = (method: string, headers: Record<string, string> = {}) => ({ method, headers: new Headers(headers) });
  test("safe methods pass", () => expect(originAllowed(req("GET"), origins)).toBe(true));
  test("a trusted Origin passes", () =>
    expect(originAllowed(req("POST", { origin: "https://ea.test" }), origins)).toBe(true));
  test("Sec-Fetch-Site same-origin passes without Origin", () =>
    expect(originAllowed(req("POST", { "sec-fetch-site": "same-origin" }), origins)).toBe(true));
  test("Sec-Fetch-Site same-origin passes with Origin null", () =>
    expect(originAllowed(req("POST", { origin: "null", "sec-fetch-site": "same-origin" }), origins)).toBe(true));
  test("a foreign Origin fails also with Sec-Fetch-Site same-origin", () =>
    expect(originAllowed(req("POST", { origin: "https://evil.test", "sec-fetch-site": "same-origin" }), origins)).toBe(
      false
    ));
  test("a foreign Origin fails", () =>
    expect(originAllowed(req("POST", { origin: "https://evil.test" }), origins)).toBe(false));
  test("Origin null fails", () => expect(originAllowed(req("POST", { origin: "null" }), origins)).toBe(false));
  test("no headers fail", () => expect(originAllowed(req("POST"), origins)).toBe(false));
});

describe("authRequest", () => {
  test("drops an incoming x-client-ip and sets the address", () => {
    const req = new Request("http://x.test/a", { headers: { "x-client-ip": "9.9.9.9", cookie: "a=b" } });
    const out = authRequest(req, "203.0.113.9");
    expect(out.headers.get("x-client-ip")).toBe("203.0.113.9");
    expect(out.headers.get("cookie")).toBe("a=b");
    expect(out.method).toBe("GET");
    expect(out.body).toBeNull();
  });

  test("null address leaves no header", () => {
    const req = new Request("http://x.test/a", { headers: { "x-client-ip": "9.9.9.9" } });
    expect(authRequest(req, null).headers.has("x-client-ip")).toBe(false);
  });

  test("the method and body survive", async () => {
    const body = JSON.stringify({ a: 1 });
    const req = new Request("http://x.test/a", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });
    const out = authRequest(req, null);
    expect(out.method).toBe("POST");
    expect(await out.text()).toBe(body);
  });
});

describe("parseBody", () => {
  const schema = z.object({ n: z.number() });
  const run = async (body: string): Promise<unknown> => {
    const app = new Hono();
    let result: unknown;
    app.post("/", async (c) => {
      try {
        result = await parseBody(c, schema);
      } catch (error) {
        result = error;
      }
      return c.text("ok");
    });
    await app.request("/", { method: "POST", body, headers: { "content-type": "application/json" } });
    return result;
  };

  test("a good body returns the parsed value", async () => {
    expect(await run('{"n":1}')).toEqual({ n: 1 });
  });

  test("a schema error gives a 400 with details and without the input", async () => {
    const error = (await run('{"n":"x"}')) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.status).toBe(400);
    expect(error.details).toEqual([{ path: "n", code: "invalid_type", message: expect.any(String) }]);
    expect(JSON.stringify(error.details)).not.toContain('"x"');
  });

  test("bad JSON gives invalid_json", async () => {
    const error = (await run("{not json")) as ValidationError;
    expect(error.details[0]?.code).toBe("invalid_json");
  });
});

describe("requireTenant", () => {
  type Rows = Awaited<ReturnType<Parameters<typeof requireTenant>[0]["listMembershipsOfUser"]>>;

  const appFor = (rows: Rows) => {
    const app = new Hono<ApiEnv>();
    app.use("*", async (c, next) => {
      c.set("session", { userId: c.req.header("x-user") ?? "u-none", sessionId: "s-test" });
      await next();
    });
    app.use("*", requireTenant({ listMembershipsOfUser: async () => rows }));
    app.get("/who", (c) => c.json({ ctx: c.get("ctx"), role: c.get("role") }));
    return app;
  };

  test("answers 403 no_organization without a membership", async () => {
    const res = await appFor([]).request("/who");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "no_organization" });
  });

  test("uses the first membership and warns once per user", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const app = appFor([
        { org_id: "org-1", role: "assistant" },
        { org_id: "org-2", role: "owner" },
      ]);
      const headers = { "x-user": "u-multi" };
      const first = await app.request("/who", { headers });
      expect(await first.json()).toEqual({ ctx: { orgId: "org-1", userId: "u-multi" }, role: "assistant" });
      await app.request("/who", { headers });
      const lines = errorSpy.mock.calls.map((call) => call.join(" "));
      expect(lines.filter((line) => line.includes("tenant_multi_membership user_id=u-multi count=2"))).toHaveLength(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("requireOwner", () => {
  const appWithRole = (role: "owner" | "assistant") => {
    const app = new Hono<ApiEnv>();
    app.use("*", async (c, next) => {
      c.set("role", role);
      await next();
    });
    app.use("*", requireOwner);
    app.get("/x", (c) => c.json({ ok: true }));
    return app;
  };

  test("answers 403 owner_only for an assistant", async () => {
    const res = await appWithRole("assistant").request("/x");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_only" });
  });

  test("lets an owner through", async () => {
    const res = await appWithRole("owner").request("/x");
    expect(res.status).toBe(200);
  });
});

describe("requireOperator", () => {
  // requireOperator reads only operatorUserIds from web: the test app sets a partial WebDeps.
  const appFor = (operatorUserIds?: ReadonlySet<string>) => {
    const app = new Hono<ApiEnv>();
    app.use("*", async (c, next) => {
      c.set("session", { userId: c.req.header("x-user") ?? "u-none", sessionId: "s-test" });
      c.set("web", (operatorUserIds === undefined ? {} : { operatorUserIds }) as WebDeps);
      await next();
    });
    app.use("*", requireOperator);
    app.get("/x", (c) => c.json({ ok: true }));
    return app;
  };

  test("lets an operator through", async () => {
    const res = await appFor(new Set(["u-op"])).request("/x", { headers: { "x-user": "u-op" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("answers 404 not_found to another user and logs the user id only", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const res = await appFor(new Set(["u-op"])).request("/x", { headers: { "x-user": "u-other" } });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
      const lines = errorSpy.mock.calls.map((call) => call.join(" "));
      expect(lines.filter((line) => line.includes("operator_route_refused user_id=u-other"))).toHaveLength(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("fails closed when the web has no operator list", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const res = await appFor().request("/x", { headers: { "x-user": "u-op" } });
      expect(res.status).toBe(404);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("createApp guards the /api/operator prefix after the tenant check and nothing else", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const web = {
        auth: {
          handler: async () => new Response(null),
          getSession: async () => ({ userId: "u-owner", sessionId: "s1" }),
        },
        db: {} as WebDeps["db"],
        now: () => new Date("2026-11-20T10:00:00Z"),
        dist: "/nonexistent/dist",
        baseUrl: new URL("http://127.0.0.1:8080"),
        trustedOrigins: new Set(["http://127.0.0.1:8080"]),
        trustedProxies: buildTrustedProxies([]),
        connInfo: () => undefined,
        listMembershipsOfUser: async () => [{ org_id: "org-1", role: "owner" as const }],
        operatorUserIds: new Set(["u-op"]),
        routers: (api) => {
          api.get("/operator/x", (c) => c.json({ ok: true }));
          api.get("/me-x", (c) => c.json({ ok: true }));
        },
      } satisfies WebDeps;
      const app = createApp({ checkDb: async () => true, web });
      const operator = await app.request("/api/operator/x");
      expect(operator.status).toBe(404);
      expect(await operator.json()).toEqual({ error: "not_found" });
      expect((await app.request("/api/me-x")).status).toBe(200);
    } finally {
      errorSpy.mockRestore();
    }
  });

  // The guard order of createApp: requireTenant, then requireOperator, then refuseSuspendedWrites (D15, D17).
  const orderApp = (extra: Partial<WebDeps>) => {
    const web = {
      auth: {
        handler: async () => new Response(null),
        getSession: async () => ({ userId: "u-owner", sessionId: "s1" }),
      },
      db: {} as WebDeps["db"],
      now: () => new Date("2026-11-20T10:00:00Z"),
      dist: "/nonexistent/dist",
      baseUrl: new URL("http://127.0.0.1:8080"),
      trustedOrigins: new Set(["http://127.0.0.1:8080"]),
      trustedProxies: buildTrustedProxies([]),
      connInfo: () => undefined,
      listMembershipsOfUser: async () => [{ org_id: "org-1", role: "owner" as const }],
      operatorUserIds: new Set(["u-op"]),
      routers: (api) => {
        api.get("/operator/x", (c) => c.json({ ok: true }));
        api.post("/operator/x", (c) => c.json({ ok: true }));
      },
      ...extra,
    } satisfies WebDeps;
    return createApp({ checkDb: async () => true, web });
  };

  test("a non-operator with no membership gets 403 no_organization: the tenant check runs first", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const app = orderApp({ listMembershipsOfUser: async () => [] });
      const res = await app.request("/api/operator/x");
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "no_organization" });
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("a non-operator in a suspended organization gets 404 not_found on a write: the operator guard runs before the suspend check", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const app = orderApp({ isOrgSuspended: async () => true });
      const res = await app.request("/api/operator/x", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:8080", "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("PUBLIC_PAGE_PATHS", () => {
  const isPublic = (path: string) => PUBLIC_PAGE_PATHS.some((pattern) => pattern.test(path));

  test("the forgot page is public, with or without a trailing slash", () => {
    expect(isPublic("/forgot")).toBe(true);
    expect(isPublic("/forgot/")).toBe(true);
    expect(isPublic("/forgotten")).toBe(false);
    expect(isPublic("/forgot/x")).toBe(false);
  });

  test("the six legal pages are public, with or without a trailing slash", () => {
    expect(isPublic("/legal/pl/privacy")).toBe(true);
    expect(isPublic("/legal/en/dpa/")).toBe(true);
    expect(isPublic("/legal/en/terms")).toBe(true);
  });

  test("other legal paths are not public", () => {
    expect(isPublic("/legal/de/privacy")).toBe(false);
    expect(isPublic("/legal/pl/cookies")).toBe(false);
    expect(isPublic("/legal/pl/privacy/x")).toBe(false);
    expect(isPublic("/legal/pl")).toBe(false);
  });
});
