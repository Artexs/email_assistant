import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { setLogLevel } from "../../src/platform/log";

import { testDb } from "./helpers";
import { GOOD, REFRESH, makeWebHttpKit } from "./web-helpers";

const db = testDb();
const kit = makeWebHttpKit(db);
const { appWith } = kit;

beforeAll(kit.createDist);
afterAll(kit.close);
afterEach(() => {
  setLogLevel("info");
});

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

describe("the installable shell", () => {
  test("the worker, the manifest, the offline page and the icons are public with their content types; the worker is never cached for long", async () => {
    const app = appWith();
    const worker = await app.request("/sw.js");
    expect(worker.status).toBe(200);
    expect(worker.headers.get("content-type")).toContain("text/javascript");
    expect(worker.headers.get("cache-control")).toBe("no-cache");
    expect(await worker.text()).toContain("addEventListener");

    const manifest = await app.request("/manifest.webmanifest");
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-type")).toContain("application/manifest+json");
    expect(manifest.headers.get("cache-control")).toBe("private, no-store");

    const offline = await app.request("/offline.html");
    expect(offline.status).toBe(200);
    expect(offline.headers.get("content-type")).toContain("text/html");
    expect(await offline.text()).toBe("offline page");

    const icon = await app.request("/icons/icon-192.png");
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toContain("image/png");
  });

  test("a page still needs a session: /activity and /mailboxes redirect to the login page", async () => {
    const app = appWith();
    for (const path of ["/activity", "/mailboxes", "/settings"]) {
      const res = await app.request(path);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/login?next=${encodeURIComponent(path)}`);
    }
    // A write to a shell path is not a static file: only GET and HEAD are served.
    expect((await app.request("/sw.js", { method: "POST" })).status).toBe(404);
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
