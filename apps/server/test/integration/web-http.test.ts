import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";

import { createOrganizationWithOwner, tenancyRoutes } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { buildTrustedProxies, createApp, parseBody, type WebDeps } from "../../src/platform/http";
import { setLogLevel } from "../../src/platform/log";
import { onboardingDeps, webDeps } from "../../src/web";

import { testDb } from "./helpers";

const db = testDb();
const checkDb = async () => true;
const extras = {
  secrets: createSecretBox(randomBytes(32).toString("base64"), 1),
  actionsScope: { kind: "off" } as const,
  botUsername: null,
};

let dist = "";

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), "ea-web-dist-"));
  for (const dir of ["login", "setup", "forgot", "mailboxes", "_astro"]) mkdirSync(join(dist, dir));
  writeFileSync(join(dist, "login/index.html"), "login page");
  writeFileSync(join(dist, "setup/index.html"), "setup page");
  writeFileSync(join(dist, "forgot/index.html"), "forgot page");
  writeFileSync(join(dist, "mailboxes/index.html"), "mailboxes page");
  writeFileSync(join(dist, "404.html"), "not found page");
  writeFileSync(join(dist, "_astro/x.js"), "console.log(1)");
  writeFileSync(join(dist, "favicon.png"), "png");
});

afterAll(async () => {
  rmSync(dist, { recursive: true, force: true });
  await db.destroy();
});

afterEach(() => {
  setLogLevel("info");
});

const offScope = { kind: "off", reason: "env_off" } as const;
const GOOD = { cookie: "ea.session_token=good" };
const REFRESH = { cookie: "ea.session_token=refresh" };
const ORIGIN = { origin: "http://127.0.0.1:8080" };

function makeWeb(overrides: Partial<WebDeps> = {}): WebDeps {
  return {
    auth: {
      handler: async (req) =>
        new Response(JSON.stringify({ path: new URL(req.url).pathname, ip: req.headers.get("x-client-ip") }), {
          status: 299,
        }),
      getSession: async (h) =>
        h.get("cookie") === "ea.session_token=good"
          ? { userId: "u1", sessionId: "s1", twoFactorEnabled: true }
          : h.get("cookie") === "ea.session_token=refresh"
            ? {
                userId: "u1",
                sessionId: "s1",
                twoFactorEnabled: true,
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

describe("static pages", () => {
  test("serves a public page with the security headers", async () => {
    const res = await appWith().request("/login");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });

  test("serves the other public files", async () => {
    const app = appWith();
    expect((await app.request("/login/")).status).toBe(200);
    const asset = await app.request("/_astro/x.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await app.request("/favicon.png")).status).toBe(200);
    expect((await app.request("/404.html")).status).toBe(200);
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", db: "up" });
  });
});

describe("page gate", () => {
  test("redirects a visitor without a session to the login page", async () => {
    const app = appWith();
    const mailboxes = await app.request("/mailboxes");
    expect(mailboxes.status).toBe(302);
    expect(mailboxes.headers.get("location")).toBe("/login?next=%2Fmailboxes");
    const root = await app.request("/");
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/login?next=%2F");
    const evil = await app.request("//evil.test");
    expect(evil.status).toBe(302);
    expect(evil.headers.get("location")).toBe("/login?next=%2F");
    expect((await app.request("/login?next=x")).status).toBe(200);
  });

  test("serves the forgot page without a session", async () => {
    const app = appWith();
    const res = await app.request("/forgot");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("forgot page");
    expect((await app.request("/forgot/")).status).toBe(200);
  });

  test("sends the root to the path that homePath gives", async () => {
    const done = await appWith({ homePath: async () => "/activity" }).request("/", { headers: GOOD });
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe("/activity");
  });

  test("sends the root to /onboarding and warns when homePath throws", async () => {
    const warnSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const app = appWith({
        homePath: async () => {
          throw new Error("db down");
        },
      });
      const root = await app.request("/", { headers: GOOD });
      expect(root.status).toBe(302);
      expect(root.headers.get("location")).toBe("/onboarding");
      expect(warnSpy.mock.calls.flat().join(" ")).toContain("home_path_failed");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("serves pages to a visitor with a session", async () => {
    const app = appWith();
    const post = await app.request("/mailboxes", { method: "POST", headers: GOOD });
    expect(post.status).toBe(404);
    expect(await post.text()).toBe("not found");
    const root = await app.request("/", { headers: GOOD });
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/onboarding");
    const page = await app.request("/mailboxes", { headers: GOOD });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("mailboxes page");
    expect((await app.request("/mailboxes/", { headers: GOOD })).status).toBe(200);
    expect((await app.request("/mailboxes", { method: "HEAD", headers: GOOD })).status).toBe(200);
    const missing = await app.request("/nope", { headers: GOOD });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("text/html");
    expect(missing.headers.get("cache-control")).toBe("private, no-store");
    expect(await missing.text()).toContain("not found page");
  });

  test("sets the refreshed cookie on the response", async () => {
    const res = await appWith().request("/mailboxes", { headers: REFRESH });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toStartWith("ea.session_token=new;");
  });
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
          getSession: async () => ({ userId, sessionId: "s-test", twoFactorEnabled: true }),
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
              operatorContact: null,
              sessions: async () => [],
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

const AUTH_MAIL_OFF = {
  AUTH_SMTP_HOST: "",
  AUTH_SMTP_PORT: "",
  AUTH_SMTP_SECURITY: "",
  AUTH_SMTP_USER: "",
  AUTH_SMTP_PASSWORD: "",
  AUTH_MAIL_FROM: "",
};

describe("real webDeps", () => {
  test("the reset request is open only with the auth-mail sender on", async () => {
    const base = {
      ...process.env,
      WEB_BASE_URL: "http://127.0.0.1:8080",
      WEB_AUTH_SECRET: "x".repeat(40),
      WEB_DIST: dist,
    };
    const post = (app: ReturnType<typeof createApp>) =>
      app.request("/api/auth/request-password-reset", {
        method: "POST",
        headers: { ...ORIGIN, "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
        body: JSON.stringify({ email: `nobody-${randomUUID()}@x.test` }),
      });
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    const off = webDeps(loadConfig({ ...base, ...AUTH_MAIL_OFF }), db, extras);
    const on = webDeps(
      loadConfig({
        ...base,
        ...AUTH_MAIL_OFF,
        AUTH_SMTP_HOST: "127.0.0.1",
        AUTH_SMTP_PORT: "1",
        AUTH_SMTP_USER: "u",
        AUTH_SMTP_PASSWORD: "p",
        AUTH_MAIL_FROM: "noreply@x.test",
      }),
      db,
      extras
    );
    logSpy.mockRestore();
    if (off === null || on === null) throw new Error("webDeps returned null");
    try {
      expect(off.resetRequestOpen).toBe(false);
      const closed = await post(createApp({ checkDb, web: off }));
      expect(closed.status).toBe(404);
      expect(await closed.json()).toEqual({ error: "not_found" });
      expect(on.resetRequestOpen).toBe(true);
      const open = await post(createApp({ checkDb, web: on }));
      expect(open.status).toBe(200);
      expect(await open.text()).toBe(
        JSON.stringify({
          status: true,
          message: "If this email exists in our system, check your email for the reset link",
        })
      );
    } finally {
      await off.close();
      await on.close();
    }
  });

  test("the operator ids come from OPERATOR_USER_IDS and the start log holds the count only", async () => {
    const operatorId = "0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11";
    const lines: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]): void => {
      lines.push(args.join(" "));
    });
    const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]): void => {
      lines.push(args.join(" "));
    });
    let web: ReturnType<typeof webDeps> = null;
    try {
      web = webDeps(
        loadConfig({
          ...process.env,
          WEB_BASE_URL: "http://127.0.0.1:8080",
          WEB_AUTH_SECRET: "x".repeat(40),
          WEB_DIST: dist,
          ...AUTH_MAIL_OFF,
          OPERATOR_USER_IDS: operatorId,
        }),
        db,
        extras
      );
      if (web === null) throw new Error("webDeps returned null");
      expect([...(web.operatorUserIds ?? [])]).toEqual([operatorId]);
      expect(lines.some((line) => line.includes("operator ids: 1"))).toBe(true);
      expect(lines.filter((line) => line.includes(operatorId))).toEqual([]);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await web?.close();
    }
  });

  test("serves the real Better Auth instance and keeps the markers out of the logs", async () => {
    const env = {
      ...process.env,
      WEB_BASE_URL: "http://127.0.0.1:8080",
      WEB_AUTH_SECRET: "x".repeat(40),
      WEB_DIST: dist,
      ...AUTH_MAIL_OFF,
    };
    const web = webDeps(loadConfig(env), db, extras);
    if (web === null) throw new Error("webDeps returned null");
    const lines: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]): void => {
      lines.push(args.join(" "));
    });
    const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]): void => {
      lines.push(args.join(" "));
    });
    try {
      expect(web.baseUrl.origin).toBe("http://127.0.0.1:8080");
      expect(web.trustedOrigins.has("http://127.0.0.1:8080")).toBe(true);
      expect(web.dist).toBe(dist);
      const app = createApp({ checkDb, web });

      const session = await app.request("/api/auth/get-session");
      expect(session.status).toBe(200);
      expect(await session.json()).toBeNull();

      const signIn = await app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { ...ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ email: `nobody-${randomUUID()}@x.test`, password: "wrong-password-1" }),
      });
      expect(signIn.status).toBe(401);
      expect(((await signIn.json()) as { code?: string }).code).toBe("INVALID_EMAIL_OR_PASSWORD");

      const reset = await app.request("/api/auth/request-password-reset", {
        method: "POST",
        headers: { ...ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@x.test" }),
      });
      expect(reset.status).toBe(404);
      expect(await reset.json()).toEqual({ error: "not_found" });

      expect((await app.request("/api/me")).status).toBe(401);

      const tokenMarker = `MARKER-TOKEN-${randomUUID()}`;
      const urlMarker = `MARKER-URL-${randomUUID()}`;
      const callback = await app.request(
        `/api/auth/reset-password/${tokenMarker}?callbackURL=https://evil.test/${urlMarker}`
      );
      expect(callback.status).toBe(403);
      expect(lines.some((line) => line.includes(tokenMarker) || line.includes(urlMarker))).toBe(false);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await web.close();
    }
  });

  test("returns null when WEB_BASE_URL is empty", () => {
    const lines: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]): void => {
      lines.push(args.join(" "));
    });
    try {
      expect(webDeps(loadConfig({ ...process.env, WEB_BASE_URL: "" }), db, extras)).toBeNull();
    } finally {
      logSpy.mockRestore();
    }
    expect(lines.some((line) => line.includes("web is off (WEB_BASE_URL is empty)"))).toBe(true);
  });
});
