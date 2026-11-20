import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { loadConfig } from "../../src/platform/config";
import { createApp } from "../../src/platform/http";
import { setLogLevel } from "../../src/platform/log";
import { auditWebEvent, authMailFailedHandler, webDeps } from "../../src/web";

import { testDb } from "./helpers";
import { ORIGIN, AUTH_MAIL_OFF, checkDb, extras, makeWebHttpKit } from "./web-helpers";

const db = testDb();
const kit = makeWebHttpKit(db);

beforeAll(kit.createDist);
afterAll(kit.close);
afterEach(() => {
  setLogLevel("info");
});

describe("real webDeps", () => {
  test("the reset request is open only with the auth-mail sender on", async () => {
    const base = {
      ...process.env,
      WEB_BASE_URL: "http://127.0.0.1:8080",
      WEB_AUTH_SECRET: "x".repeat(40),
      WEB_DIST: kit.dist,
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
          WEB_DIST: kit.dist,
          ...AUTH_MAIL_OFF,
          OPERATOR_USER_IDS: operatorId,
        }),
        db,
        extras
      );
      if (web === null) throw new Error("webDeps returned null");
      expect([...(web.operatorUserIds ?? [])]).toEqual([operatorId]);
      expect(lines.some((line) => line.includes("web_operators") && line.includes("count=1"))).toBe(true);
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
      WEB_DIST: kit.dist,
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
      expect(web.dist).toBe(kit.dist);
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

  test("the OAuth callback sits before the session guard: no session is a 303 to /login, and only GET is public", async () => {
    const web = webDeps(
      loadConfig({
        ...process.env,
        WEB_BASE_URL: "http://127.0.0.1:8080",
        WEB_AUTH_SECRET: "x".repeat(40),
        WEB_DIST: kit.dist,
        ...AUTH_MAIL_OFF,
      }),
      db,
      extras
    );
    if (web === null) throw new Error("webDeps returned null");
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    try {
      const app = createApp({ checkDb, web });
      const res = await app.request("/api/mailboxes/oauth/google/callback?code=c&state=s");
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/login");
      const post = await app.request("/api/mailboxes/oauth/google/callback", { method: "POST", headers: ORIGIN });
      expect(post.status).toBe(401);
    } finally {
      logSpy.mockRestore();
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
    expect(lines.some((line) => line.includes("web_off") && line.includes("config_key=WEB_BASE_URL"))).toBe(true);
  });
});

describe("web root events", () => {
  const CANARY = "canary-web-failure@x.test";

  /** Every line the three console channels get while `run` runs. The writer has already dropped a bad field, so each test also checks that `dropped_fields` is absent. */
  async function captureLines(run: () => Promise<void> | void): Promise<string[]> {
    const lines: string[] = [];
    const spies = (["log", "warn", "error"] as const).map((method) =>
      spyOn(console, method).mockImplementation((...args: unknown[]): void => {
        lines.push(args.join(" "));
      })
    );
    try {
      await run();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    return lines;
  }

  const failingSelect = new Proxy(db, {
    get(target, property) {
      if (property === "selectFrom") {
        return () => {
          throw new Error(CANARY);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });

  test("an http base URL on another host writes events with the config key; no host, port or path in any line", async () => {
    let web: ReturnType<typeof webDeps> = null;
    const lines = await captureLines(() => {
      web = webDeps(
        loadConfig({
          ...process.env,
          WEB_BASE_URL: "http://panel.x.test:4321",
          WEB_AUTH_SECRET: "x".repeat(40),
          WEB_DIST: kit.dist,
          ...AUTH_MAIL_OFF,
          AUTH_PWNED_CHECK: "off",
        }),
        db,
        extras
      );
    });
    try {
      for (const event of ["web_cookies_not_secure", "auth_mail_off", "pwned_check_off", "web_operators", "web_on"]) {
        expect(lines.filter((line) => line.includes(event))).toHaveLength(1);
      }
      expect(lines.filter((line) => line.includes("web_cookies_not_secure"))[0]).toContain("config_key=WEB_BASE_URL");
      expect(lines.filter((line) => line.includes("pwned_check_off"))[0]).toContain("config_key=AUTH_PWNED_CHECK");
      const all = lines.join("\n");
      expect(all).not.toContain("panel.x.test");
      expect(all).not.toContain("4321");
      expect(all).not.toContain("ea-web-dist-");
      expect(all).not.toContain("dropped_fields");
    } finally {
      await (web as ReturnType<typeof webDeps>)?.close();
    }
  });

  test("a user with no organization writes web_no_organization with the user id", async () => {
    const userId = randomUUID();
    const lines = await captureLines(() => auditWebEvent(db)("login", userId));
    const found = lines.filter((line) => line.includes("web_no_organization"));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`user_id=${userId}`);
    expect(lines.join("\n")).not.toContain("dropped_fields");
  });

  test("a failed audit writes web_audit_failed with the kind and the error name only", async () => {
    const lines = await captureLines(() => auditWebEvent(failingSelect)("login", randomUUID()));
    const found = lines.filter((line) => line.includes("web_audit_failed"));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("kind=login");
    expect(found[0]).toContain("error=Error");
    expect(lines.join("\n")).not.toContain(CANARY);
    expect(lines.join("\n")).not.toContain("dropped_fields");
  });

  test("a failed notice lookup writes web_auth_mail_notice_failed with the user id and the error name only", async () => {
    const userId = randomUUID();
    const lines = await captureLines(async () => {
      authMailFailedHandler(failingSelect, () => undefined)(userId, "reset", "smtp_failed");
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const found = lines.filter((line) => line.includes("web_auth_mail_notice_failed"));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`user_id=${userId}`);
    expect(found[0]).toContain("error=Error");
    expect(lines.join("\n")).not.toContain(CANARY);
    expect(lines.join("\n")).not.toContain("dropped_fields");
  });
});
