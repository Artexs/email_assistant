import { describe, expect, test } from "bun:test";

import { createApp } from "./http";

describe("GET /health", () => {
  test("returns 200 when the DB is up", async () => {
    const res = await createApp({ checkDb: async () => true }).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "up" });
  });

  test("returns 503 when the DB is down", async () => {
    const res = await createApp({ checkDb: async () => false }).request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error", db: "down" });
  });

  test("returns 500 with a generic body when the check throws", async () => {
    const res = await createApp({
      checkDb: async () => {
        throw new Error("boom");
      },
    }).request("/health");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });

  test("returns 404 for unknown routes", async () => {
    const res = await createApp({ checkDb: async () => true }).request("/nope");
    expect(res.status).toBe(404);
  });
});
