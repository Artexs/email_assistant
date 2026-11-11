/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { ApiError, createApi } from "./api";

const okSchema = z.object({ ok: z.boolean() });

function setup(response: Response) {
  let unauthorized = 0;
  const api = createApi({
    fetchImpl: () => Promise.resolve(response),
    onUnauthorized: () => {
      unauthorized += 1;
    },
  });
  return { api, unauthorizedCount: () => unauthorized };
}

describe("createApi", () => {
  test("sends same-origin credentials, accept, and a JSON body only when there is one", async () => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const api = createApi({
      fetchImpl: (path, init) => {
        calls.push({ path, init });
        return Promise.resolve(Response.json({ ok: true }));
      },
      onUnauthorized: () => undefined,
    });
    await api("/api/get", okSchema);
    await api("/api/post", okSchema, { method: "POST", body: { a: 1 } });

    expect(calls[0]?.path).toBe("/api/get");
    expect(calls[0]?.init).toEqual({
      method: "GET",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      body: undefined,
    });
    expect(calls[1]?.path).toBe("/api/post");
    expect(calls[1]?.init).toEqual({
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
  });

  test("a 403 becomes an ApiError with status and code", async () => {
    const { api } = setup(Response.json({ error: "owner_only" }, { status: 403 }));
    const error = await api("/api/x", okSchema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).code).toBe("owner_only");
  });

  test("a 400 keeps the details", async () => {
    const details = [{ path: "email", code: "invalid", message: "Bad" }];
    const { api } = setup(Response.json({ error: "validation", details }, { status: 400 }));
    const error = (await api("/api/x", okSchema).catch((e: unknown) => e)) as ApiError;
    expect(error.details).toEqual(details);
  });

  test("a 500 with a body that is not JSON gets the code internal", async () => {
    const { api } = setup(new Response("oops", { status: 500 }));
    const error = (await api("/api/x", okSchema).catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(500);
    expect(error.code).toBe("internal");
  });

  test("a 409 keeps the parsed body as raw", async () => {
    const body = {
      error: "no_go",
      gate: { decision: "no-go", precision: 0.9, kept: 40, atConfidence: 0.5, threshold: null },
    };
    const { api } = setup(Response.json(body, { status: 409 }));
    const error = (await api("/api/x", okSchema).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("no_go");
    expect(error.raw.gate).toEqual(body.gate);
  });

  test("a 500 with a text body has an empty raw", async () => {
    const { api } = setup(new Response("oops", { status: 500 }));
    const error = (await api("/api/x", okSchema).catch((e: unknown) => e)) as ApiError;
    expect(error.raw).toEqual({});
  });

  test("a 401 calls onUnauthorized once and never settles", async () => {
    const { api, unauthorizedCount } = setup(Response.json({ error: "unauthorized" }, { status: 401 }));
    const pending = Symbol("pending");
    const result = await Promise.race([
      api("/api/x", okSchema),
      new Promise((resolve) => setTimeout(() => resolve(pending), 50)),
    ]);
    expect(result).toBe(pending);
    expect(unauthorizedCount()).toBe(1);
  });

  test("a 200 body is parsed with the schema", async () => {
    const { api } = setup(Response.json({ ok: true }));
    expect(await api("/api/x", okSchema)).toEqual({ ok: true });
  });

  test("a 204 resolves undefined", async () => {
    const { api } = setup(new Response(null, { status: 204 }));
    expect(await api("/api/x", z.undefined())).toBeUndefined();
  });
});
