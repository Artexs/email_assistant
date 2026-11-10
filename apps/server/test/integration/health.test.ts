import { afterAll, describe, expect, test } from "bun:test";

import { checkDb } from "../../src/platform/db";
import { createApp } from "../../src/platform/http";

import { testDb } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("GET /health", () => {
  test("returns 200 with db up against the real DB", async () => {
    const res = await createApp({ checkDb: () => checkDb(db), web: null }).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "up" });
  });
});
