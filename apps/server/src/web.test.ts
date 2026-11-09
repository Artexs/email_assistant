import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { loadConfig } from "./platform/config";
import { distPath, peerAddress, scopeInfos } from "./web";

const base = {
  DATABASE_URL: "postgres://app:x@127.0.0.1:1/x",
  CREDENTIALS_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("scopeInfos", () => {
  test("maps the three scope keys", () => {
    const config = loadConfig({
      ...base,
      TRIAGE_LLM_SCOPE: "off",
      ACTIONS_SCOPE: "synthetic",
      SEND_SCOPE: "self",
      SEND_TEST_ADDRESSES: "me@x.test",
    });
    expect(scopeInfos(config)).toEqual({
      triage: { kind: "off", reason: "env_off" },
      actions: { kind: "synthetic", reason: "synthetic_only" },
      send: { kind: "self", reason: "test_addresses_only" },
    });
  });
});

describe("distPath", () => {
  test("resolves a relative path against the working directory", () => {
    const config = loadConfig({ ...base, WEB_DIST: "apps/web/dist" });
    expect(distPath(config, "/repo")).toBe("/repo/apps/web/dist");
  });

  test("keeps an absolute path", () => {
    const config = loadConfig({ ...base, WEB_DIST: "/app/apps/web/dist" });
    expect(distPath(config, "/repo")).toBe("/app/apps/web/dist");
  });
});

describe("peerAddress", () => {
  test("returns undefined without a Bun server", async () => {
    const app = new Hono();
    let seen: string | undefined = "unset";
    app.get("/", (c) => {
      seen = peerAddress(c);
      return c.text("ok");
    });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(seen).toBeUndefined();
  });
});
