import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { buildTrustedProxies, createApp, parseBody, type WebDeps } from "./http";
import { apiDoc } from "./openapi";

const ORIGIN = "http://127.0.0.1:8080";

function appWith(opts: { session: boolean; routers?: WebDeps["routers"] }) {
  const web = {
    auth: {
      handler: async () => new Response(null),
      getSession: async () =>
        opts.session
          ? { userId: "u-owner", sessionId: "s1", twoFactorEnabled: true, signInMethod: "password" as const }
          : null,
    },
    db: {} as WebDeps["db"],
    now: () => new Date("2026-11-20T10:00:00Z"),
    dist: "/nonexistent/dist",
    baseUrl: new URL(ORIGIN),
    trustedOrigins: new Set([ORIGIN]),
    trustedProxies: buildTrustedProxies([]),
    connInfo: () => undefined,
    listMembershipsOfUser: async () => [{ org_id: "org-1", role: "owner" as const }],
    ...(opts.routers ? { routers: opts.routers } : {}),
  } satisfies WebDeps;
  return createApp({ checkDb: async () => true, web });
}

const pick = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((current, key) => (current as Record<string, unknown> | undefined)?.[key], value);

interface Doc {
  openapi: string;
  info: { title: string; version: string };
  security: unknown;
  paths: Record<string, Record<string, Record<string, unknown>>>;
}

describe("GET /api/openapi.json", () => {
  test("answers 401 unauthorized without a session", async () => {
    const res = await appWith({ session: false }).request("/api/openapi.json");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("answers the OpenAPI 3.1 file with a session", async () => {
    const res = await appWith({ session: true }).request("/api/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Doc;
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toMatchObject({ title: "Email assistant API", version: "0" });
    expect(doc.security).toEqual([{ session: [] }]);
  });

  test("lists no operator path, also when an operator route carries an apiDoc", async () => {
    const app = appWith({
      session: true,
      routers: (api) => {
        api.get(
          "/operator/x",
          apiDoc({ operationId: "operatorX", summary: "x", tags: ["t"], ok: { status: 200, schema: z.object({}) } }),
          (c) => c.json({})
        );
        api.get(
          "/shown",
          apiDoc({ operationId: "shown", summary: "x", tags: ["t"], ok: { status: 200, schema: z.object({}) } }),
          (c) => c.json({})
        );
      },
    });
    const doc = (await (await app.request("/api/openapi.json")).json()) as Doc;
    // The public sign-in route is in the file; the operator route is not.
    expect(Object.keys(doc.paths).sort()).toEqual(["/api/shown", "/api/sign-in-options"]);
    expect(Object.keys(doc.paths).filter((path) => path.startsWith("/api/operator"))).toEqual([]);
  });

  test("a described route shows its path, body, answer and error codes", async () => {
    const app = appWith({
      session: true,
      routers: (api) => {
        api.post(
          "/x/:id",
          apiDoc({
            operationId: "postX",
            summary: "Post x",
            tags: ["x"],
            body: z.object({ a: z.string() }),
            ok: { status: 200, schema: z.object({ id: z.string() }) },
            errors: [{ status: 409, codes: ["closed", "changed"] }],
          }),
          async (c) => {
            const body = await parseBody(c, z.object({ a: z.string() }));
            return c.json({ id: body.a });
          }
        );
      },
    });
    const doc = (await (await app.request("/api/openapi.json")).json()) as Doc;
    const operation = doc.paths["/api/x/{id}"]?.post;
    expect(pick(operation, "operationId")).toBe("postX");
    const content = (...path: string[]) =>
      pick(operation, ...path, "content", "application/json", "schema", "properties");
    expect(pick(operation, "requestBody", "content", "application/json", "schema", "properties", "a", "type")).toBe(
      "string"
    );
    expect(pick(content("responses", "200"), "id", "type")).toBe("string");
    expect(pick(operation, "responses", "409", "description")).toContain("closed, changed");
    expect(pick(content("responses", "409"), "error", "type")).toBe("string");
  });

  test("a second success answer (`alsoOk`) is in the file next to the first", async () => {
    const app = appWith({
      session: true,
      routers: (api) => {
        api.post(
          "/y",
          apiDoc({
            operationId: "postY",
            summary: "Post y",
            tags: ["y"],
            ok: { status: 202, schema: z.object({ requestId: z.string() }) },
            alsoOk: { status: 200, schema: z.object({ sendId: z.string() }) },
          }),
          (c) => c.json({ requestId: "r" }, 202)
        );
      },
    });
    const doc = (await (await app.request("/api/openapi.json")).json()) as Doc;
    const operation = doc.paths["/api/y"]?.post;
    const props = (status: string) =>
      pick(operation, "responses", status, "content", "application/json", "schema", "properties");
    expect(Object.keys(props("202") as object)).toEqual(["requestId"]);
    expect(Object.keys(props("200") as object)).toEqual(["sendId"]);
  });
});
