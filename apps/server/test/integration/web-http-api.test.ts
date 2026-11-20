import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";

import { createOrganizationWithOwner, tenancyRoutes } from "../../src/modules/tenancy";
import { createApp, parseBody, type WebDeps } from "../../src/platform/http";
import { setLogLevel } from "../../src/platform/log";
import { onboardingDeps } from "../../src/web";

import { testDb } from "./helpers";
import { GOOD, REFRESH, ORIGIN, checkDb, makeWebHttpKit } from "./web-helpers";

const offScope = { kind: "off", reason: "env_off" } as const;

const db = testDb();
const kit = makeWebHttpKit(db);
const { appWith } = kit;

beforeAll(kit.createDist);
afterAll(kit.close);
afterEach(() => {
  setLogLevel("info");
});

describe("api", () => {
  test("answers 401 without a session and 404 JSON for an unknown path", async () => {
    const app = appWith();
    const anonymous = await app.request("/api/me");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthorized" });
    const { orgId, userId } = await createOrganizationWithOwner(db, {
      orgName: "Web http",
      timezone: "Europe/Warsaw",
      email: `web-http-${randomUUID()}@x.test`,
      displayName: "Owner",
    });
    try {
      const mounted = appWith({
        auth: {
          handler: async () => new Response(),
          getSession: async () => ({ userId, sessionId: "s-test", twoFactorEnabled: true, signInMethod: "password" }),
        },
        listMembershipsOfUser: async () => [{ org_id: orgId, role: "owner" }],
        routers: (api) =>
          api.route(
            "/",
            tenancyRoutes({
              db,
              now: () => new Date(),
              scopes: { triage: offScope, actions: offScope, send: offScope },
              countMailboxes: async () => ({ total: 0, inAuthError: 0 }),
              approvalsWaiting: async () => 0,
              operatorContact: null,
              sessions: async () => [],
              backupCodesLeft: async () => null,
              ...onboardingDeps(db, null),
            })
          ),
      });
      const me = await mounted.request("/api/me", { headers: GOOD });
      expect(me.status).toBe(200);
      const known = await mounted.request("/api/nope", { headers: GOOD });
      expect(known.status).toBe(404);
      expect(known.headers.get("content-type")).toContain("application/json");
      expect(await known.json()).toEqual({ error: "not_found" });
    } finally {
      await db.deleteFrom("organizations").where("id", "=", orgId).execute();
      await db.deleteFrom("users").where("id", "=", userId).execute();
    }
  });

  test("checks the origin of a non-safe request", async () => {
    const app = appWith();
    const post = (headers: Record<string, string>) => app.request("/api/anything", { method: "POST", headers });
    const noOrigin = await post({});
    expect(noOrigin.status).toBe(403);
    expect(await noOrigin.json()).toEqual({ error: "bad_origin" });
    expect((await post({ origin: "https://evil.test" })).status).toBe(403);
    expect((await post({ origin: "null" })).status).toBe(403);
    expect((await post({ origin: "https://evil.test", "sec-fetch-site": "same-origin" })).status).toBe(403);
    expect((await post({ "sec-fetch-site": "same-origin" })).status).toBe(401);
    expect((await post({ origin: "http://localhost:4321" })).status).toBe(401);
  });

  test("limits the body size", async () => {
    const res = await appWith().request("/api/anything", {
      method: "POST",
      headers: { ...ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(70 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
  });
});

describe("auth mount", () => {
  const signIn = (app: ReturnType<typeof appWith>, headers: Record<string, string> = {}) =>
    app.request("/api/auth/sign-in/email", { method: "POST", headers: { ...ORIGIN, ...headers } });

  test("passes the path and the resolved client address", async () => {
    const res = await signIn(appWith());
    expect(res.status).toBe(299);
    expect(await res.json()).toEqual({ path: "/api/auth/sign-in/email", ip: "203.0.113.9" });
  });

  test("trusts x-forwarded-for only from a trusted proxy", async () => {
    const forwarded = { "x-forwarded-for": "198.51.100.7" };
    expect(await (await signIn(appWith(), forwarded)).json()).toMatchObject({ ip: "203.0.113.9" });
    const behindProxy = appWith({ connInfo: () => "172.18.0.1" });
    expect(await (await signIn(behindProxy, forwarded)).json()).toMatchObject({ ip: "198.51.100.7" });
    const unknown = appWith({ connInfo: () => undefined });
    expect(await (await signIn(unknown)).json()).toMatchObject({ ip: null });
  });

  test("never passes an incoming x-client-ip", async () => {
    const body = await (await signIn(appWith(), { "x-client-ip": "9.9.9.9" })).json();
    expect(body).toMatchObject({ ip: "203.0.113.9" });
  });

  test("lets the allowed paths through and hides the rest", async () => {
    const app = appWith();
    expect((await app.request("/api/auth/reset-password/abc?callbackURL=/setup")).status).toBe(299);
    expect((await app.request("/api/auth/get-session")).status).toBe(299);
    const reset = await app.request("/api/auth/request-password-reset", { method: "POST", headers: ORIGIN });
    expect(reset.status).toBe(404);
    expect(await reset.json()).toEqual({ error: "not_found" });
    expect((await app.request("/api/auth/ok")).status).toBe(404);
    expect((await app.request("/api/auth/sign-up/email", { method: "POST", headers: ORIGIN })).status).toBe(404);
    expect((await app.request("/api/auth/update-user", { method: "POST", headers: ORIGIN })).status).toBe(404);
  });

  test("checks the origin before the mount", async () => {
    const res = await appWith().request("/api/auth/sign-out", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin" });
  });
});

describe("HSTS", () => {
  test("is on for an https base URL", async () => {
    const res = await appWith({ baseUrl: new URL("https://ea.example.ts.net") }).request("/login");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=15552000; includeSubDomains");
  });
});

describe("x-request-id", () => {
  test("every response kind has an x-request-id header", async () => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const app = appWith();
    const post = { method: "POST", headers: { ...GOOD, ...ORIGIN, "content-type": "application/json" } };
    const responses: [number, Response][] = [
      [200, await app.request("/login")],
      [200, await app.request("/_astro/x.js")],
      [403, await app.request("/api/me", { method: "POST", headers: GOOD })],
      [404, await app.request("/api/nope", { headers: GOOD })],
      [401, await app.request("/api/me")],
      [413, await app.request("/api/me", { ...post, body: JSON.stringify({ text: "x".repeat(70 * 1024) }) })],
      [299, await app.request("/api/auth/get-session")],
      [302, await app.request("/", { headers: GOOD })],
      [503, await appWith({ dist: "/nonexistent/dist" }).request("/login")],
    ];

    for (const [status, res] of responses) {
      expect(res.status).toBe(status);
      expect(res.headers.get("x-request-id")).toMatch(UUID);
    }
  });
});

const errorRouters: WebDeps["routers"] = (api) => {
  api.get("/boom", () => {
    throw new Error("secret text");
  });
  api.post("/zod", async (c) => c.json(await parseBody(c, z.object({ n: z.number() }))));
  api.get("/shape", (c) => {
    z.object({ a: z.string() }).parse({ a: 1 });
    return c.json({});
  });
};

describe("errors", () => {
  const post = (app: ReturnType<typeof appWith>, body: string) =>
    app.request("/api/zod", {
      method: "POST",
      headers: { ...GOOD, ...ORIGIN, "content-type": "application/json" },
      body,
    });

  test("hides the message of an unexpected error", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const res = await appWith({ routers: errorRouters }).request("/api/boom", { headers: GOOD });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal" });
      const lines = errorSpy.mock.calls.map((call) => call.join(" "));
      expect(lines.some((line) => line.includes("Error"))).toBe(true);
      expect(
        lines.some((line) => line.includes("http_error") && line.includes("method=GET route=/api/boom error=Error"))
      ).toBe(true);
      expect(lines.some((line) => line.includes("secret text"))).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("keeps the refreshed session cookie on a 400", async () => {
    const res = await appWith({ routers: errorRouters }).request("/api/zod", {
      method: "POST",
      headers: { ...ORIGIN, ...REFRESH, "content-type": "application/json" },
      body: JSON.stringify({ n: "x" }),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie")).toStartWith("ea.session_token=new;");
    expect(((await res.json()) as { error: string }).error).toBe("validation");
  });

  test("answers 400 with details and without the input", async () => {
    const res = await post(appWith({ routers: errorRouters }), JSON.stringify({ n: "x" }));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain('"x"');
    const body = JSON.parse(text) as { error: string; details: Record<string, unknown>[] };
    expect(body.error).toBe("validation");
    expect(body.details).toHaveLength(1);
    expect(Object.keys(body.details[0] as object).sort()).toEqual(["code", "message", "path"]);
    expect(body.details[0]).toMatchObject({ path: "n", code: "invalid_type" });
  });

  test("reports invalid JSON", async () => {
    const res = await post(appWith({ routers: errorRouters }), "{not json");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: { code: string }[] };
    expect(body.details[0]?.code).toBe("invalid_json");
  });

  test("answers 500 for a response-shape bug", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const res = await appWith({ routers: errorRouters }).request("/api/shape", { headers: GOOD });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal" });
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("web off", () => {
  test("mounts only /health", async () => {
    const app = createApp({ checkDb, web: null });
    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/login")).status).toBe(404);
    expect((await app.request("/api/me")).status).toBe(404);
  });
});

describe("dist missing", () => {
  test("answers 503 for pages and keeps the API", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const app = appWith({ dist: "/nonexistent/dist" });
      const login = await app.request("/login");
      expect(login.status).toBe(503);
      expect(await login.text()).toBe("The web build is missing. Run bun run web:build.");
      expect((await app.request("/mailboxes")).status).toBe(503);
      expect((await app.request("/api/me")).status).toBe(401);
      const lines = errorSpy.mock.calls.map((call) => call.join(" "));
      expect(lines.some((line) => line.includes("web_dist_missing"))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("http logs", () => {
  test("no log line holds a token, a cookie or a raw path; the route patterns appear", async () => {
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    setLogLevel("debug");
    const run = randomUUID();
    const token = `MARKER-TOKEN-${run}`;
    const cookie = `MARKER-COOKIE-${run}`;
    try {
      const app = appWith({ routers: errorRouters });
      await app.request(`/api/auth/reset-password/${token}?callbackURL=/setup`);
      await app.request(`/setup?token=${token}`);
      await app.request(`/login?next=${token}`);
      const gated = await app.request(`/mailboxes?q=${token}`, { headers: { cookie: `ea.session_token=${cookie}` } });
      expect(gated.status).toBe(302);
      await app.request("/api/boom", { headers: GOOD });
      const lines = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => call.join(" "));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).not.toContain(token);
        expect(line).not.toContain(cookie);
      }
      expect(lines.some((line) => line.includes("method=GET route=/api/auth/* status=299"))).toBe(true);
      expect(lines.some((line) => line.includes("method=GET route=/* status=200"))).toBe(true);
      expect(lines.some((line) => line.includes("method=GET route=/* status=302"))).toBe(true);
      expect(lines.some((line) => line.includes("method=GET route=/api/boom status=500"))).toBe(true);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
