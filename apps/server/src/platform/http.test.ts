import type { BlockList } from "node:net";

import { describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";

import {
  authRequest,
  buildTrustedProxies,
  clientAddress,
  createApp,
  normalizeAddress,
  originAllowed,
  parseBody,
  requireOwner,
  requireTenant,
  ValidationError,
  type ApiEnv,
} from "./http";

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
      c.set("session", { userId: c.req.header("x-user") ?? "u-none" });
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
      expect(
        lines.filter((line) => line.includes("web: user u-multi has 2 memberships; using the oldest"))
      ).toHaveLength(1);
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
