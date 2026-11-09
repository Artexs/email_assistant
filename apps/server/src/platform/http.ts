import { existsSync, readFileSync } from "node:fs";
import { BlockList, isIP } from "node:net";
import { join } from "node:path";

import type { MembershipRole } from "@ea/core";
import { serveStatic } from "@hono/bun";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import type { z } from "zod";

import { isAllowedAuthPath } from "./auth";
import type { Db, TenantContext } from "./db";
import { describeError } from "./errors";
import { createLog } from "./log";

const log = createLog("http");

export interface WebSession {
  userId: string;
  setCookie?: string[]; // refreshed cookies from Better Auth (W17)
}

export interface ApiEnv {
  Variables: { session: WebSession; ctx: TenantContext; role: MembershipRole; web: WebDeps };
}

export interface WebDeps {
  auth: { handler(req: Request): Promise<Response>; getSession(headers: Headers): Promise<WebSession | null> };
  db: Db;
  now: () => Date;
  dist: string; // absolute path of the built web app
  baseUrl: URL;
  trustedOrigins: ReadonlySet<string>; // includes baseUrl.origin
  trustedProxies: BlockList;
  connInfo: (c: Context) => string | undefined; // the TCP peer address; undefined when unknown
  listMembershipsOfUser: (userId: string) => Promise<{ org_id: string; role: MembershipRole }[]>;
  routers?: (api: Hono<ApiEnv>) => void; // web.ts mounts the module routers (after requireTenant)
}

export interface HttpDeps {
  checkDb: () => Promise<boolean>;
  web: WebDeps | null;
}

const ipFamily = (address: string): "ipv4" | "ipv6" => (isIP(address) === 6 ? "ipv6" : "ipv4");

export function buildTrustedProxies(entries: readonly string[]): BlockList {
  const list = new BlockList();
  for (const entry of entries) {
    const parts = entry.split("/");
    const [address, prefix] = parts;
    if (parts.length > 2 || address === undefined || isIP(address) === 0)
      throw new Error(`invalid trusted proxy entry: ${entry}`);
    const family = ipFamily(address);
    if (prefix === undefined) {
      list.addAddress(address, family);
    } else {
      const bits = Number(prefix);
      if (!/^\d{1,3}$/.test(prefix) || !Number.isInteger(bits))
        throw new Error(`invalid trusted proxy entry: ${entry}`);
      list.addSubnet(address, bits, family);
    }
  }
  return list;
}

export function normalizeAddress(address: string): string {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  return match?.[1] ?? address;
}

const isTrusted = (address: string, trusted: BlockList): boolean =>
  isIP(address) !== 0 && trusted.check(address, ipFamily(address));

export function clientAddress(
  peer: string | undefined,
  forwardedFor: string | undefined,
  trusted: BlockList
): string | null {
  if (peer === undefined) return null;
  // A peer that is not a plain IP (for example a zoned fe80::1%eth0) is returned unchanged:
  // it only keys the rate limit and auth_sessions.ip_address, never trust.
  const peerAddress = normalizeAddress(peer);
  if (!forwardedFor || !isTrusted(peerAddress, trusted)) return peerAddress;
  const hops = forwardedFor.split(",").map((hop) => normalizeAddress(hop.trim()));
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i] as string;
    if (isIP(hop) === 0) return peerAddress;
    if (!isTrusted(hop, trusted)) return hop;
  }
  return peerAddress;
}

export function originAllowed(req: { method: string; headers: Headers }, trustedOrigins: ReadonlySet<string>): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return true;
  if (req.headers.get("sec-fetch-site") === "same-origin") return true;
  const origin = req.headers.get("origin");
  return origin !== null && trustedOrigins.has(origin);
}

export function safeNext(path: string | null | undefined): string {
  if (path === null || path === undefined || path === "") return "/";
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return "/";
  }
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  const url = new URL(path, "http://x.invalid");
  if (url.origin !== "http://x.invalid") return "/";
  if (url.pathname.startsWith("//")) return "/";
  if (url.pathname.startsWith("/login") || url.pathname.startsWith("/setup")) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

export function authRequest(req: Request, address: string | null): Request {
  const headers = new Headers(req.headers);
  headers.delete("x-client-ip");
  if (address) headers.set("x-client-ip", address);
  if (req.body === null) return new Request(req.url, { method: req.method, headers, redirect: "manual" });
  const init: RequestInit & { duplex: "half" } = {
    method: req.method,
    headers,
    body: req.body,
    duplex: "half",
    redirect: "manual",
  };
  return new Request(req.url, init);
}

export const PUBLIC_PAGE_PATHS: readonly RegExp[] = [
  /^\/login\/?$/,
  /^\/setup\/?$/,
  /^\/404\.html$/,
  /^\/_astro\//,
  /^\/favicon\./,
  /^\/robots\.txt$/,
];

interface ValidationDetail {
  path: string;
  code: string;
  message: string;
}

export class ValidationError extends HTTPException {
  readonly details: ValidationDetail[];

  constructor(details: ValidationDetail[]) {
    super(400, {
      res: new Response(JSON.stringify({ error: "validation", details }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    });
    this.details = details;
  }
}

export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let input: unknown;
  try {
    input = await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ValidationError([{ path: "", code: "invalid_json", message: "invalid JSON" }]);
    }
    throw error;
  }
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      }))
    );
  }
  return result.data;
}

// One getSession call per request: the result is cached in the context; refreshed cookies go to the response (W17).
export async function readSession(c: Context): Promise<WebSession | null> {
  const ctx = c as Context<ApiEnv>;
  const cached = ctx.get("session");
  if (cached) return cached;
  const session = await ctx.get("web").auth.getSession(ctx.req.raw.headers);
  if (!session) return null;
  ctx.set("session", session);
  for (const value of session.setCookie ?? []) ctx.header("set-cookie", value, { append: true });
  return session;
}

export const requireSession: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (!(await readSession(c))) return c.json({ error: "unauthorized" }, 401);
  await next();
};

const warnedMultiOrg = new Set<string>();

// D3: the tenant comes from the session user's oldest membership, never from the request.
export function requireTenant(deps: {
  listMembershipsOfUser: WebDeps["listMembershipsOfUser"];
}): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const { userId } = c.get("session");
    const rows = await deps.listMembershipsOfUser(userId);
    const [first] = rows;
    if (!first) return c.json({ error: "no_organization" }, 403);
    if (rows.length > 1 && !warnedMultiOrg.has(userId)) {
      warnedMultiOrg.add(userId);
      log.warn(`web: user ${userId} has ${rows.length} memberships; using the oldest`);
    }
    c.set("ctx", { orgId: first.org_id, userId });
    c.set("role", first.role);
    await next();
  };
}

export const requireOwner: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (c.get("role") !== "owner") return c.json({ error: "owner_only" }, 403);
  await next();
};

const MISSING_BUILD = "The web build is missing. Run bun run web:build.";

export function createApp(deps: HttpDeps): Hono<ApiEnv> {
  const { web } = deps;
  const app = new Hono<ApiEnv>();

  app.use("*", async (c, next) => {
    const start = performance.now();
    await next();
    log.debug(`${c.req.method} ${routePath(c)} ${c.res.status} ${Math.round(performance.now() - start)}ms`);
  });

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: { frameAncestors: ["'none'"] },
      xFrameOptions: "DENY",
      referrerPolicy: "same-origin",
      strictTransportSecurity:
        web !== null && web.baseUrl.protocol === "https:" ? "max-age=15552000; includeSubDomains" : false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.get("/health", async (c) => {
    const dbUp = await deps.checkDb();
    return dbUp ? c.json({ status: "ok", db: "up" }, 200) : c.json({ status: "error", db: "down" }, 503);
  });

  app.onError((error, c) => {
    // Built through the context, so prepared headers (a refreshed session cookie) stay on the 400.
    if (error instanceof ValidationError) return c.json({ error: "validation", details: error.details }, 400);
    if (error instanceof HTTPException) {
      return error.res ?? c.json({ error: error.message || "error" }, error.status);
    }
    log.error(`${c.req.method} ${routePath(c)}: ${describeError(error)}`);
    return c.json({ error: "internal" }, 500);
  });

  if (web === null) return app;

  app.use("*", async (c, next) => {
    c.set("web", web);
    await next();
  });

  app.use("/api/*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "too_large" }, 413) }));

  app.use("/api/*", async (c, next) => {
    if (!originAllowed(c.req.raw, web.trustedOrigins)) return c.json({ error: "bad_origin" }, 403);
    await next();
  });

  app.on(["GET", "POST"], "/api/auth/*", async (c) => {
    const path = new URL(c.req.url).pathname.slice("/api/auth".length);
    if (!isAllowedAuthPath(c.req.method, path)) return c.json({ error: "not_found" }, 404);
    const address = clientAddress(web.connInfo(c), c.req.header("x-forwarded-for"), web.trustedProxies);
    return web.auth.handler(authRequest(c.req.raw, address));
  });

  const api = new Hono<ApiEnv>();
  api.use("*", requireSession);
  api.use("*", requireTenant({ listMembershipsOfUser: web.listMembershipsOfUser }));
  web.routers?.(api);
  api.all("*", (c) => c.json({ error: "not_found" }, 404));
  app.route("/api", api);

  const notFoundPath = join(web.dist, "404.html");
  if (!existsSync(web.dist) || !existsSync(notFoundPath)) {
    log.warn("web: dist folder missing, pages are off");
    app.on(["GET", "HEAD"], "*", (c) => c.text(MISSING_BUILD, 503));
    return app;
  }
  const notFoundHtml = readFileSync(notFoundPath, "utf8");

  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.text("not found", 404);
    const path = c.req.path;
    if (PUBLIC_PAGE_PATHS.some((pattern) => pattern.test(path))) return next();
    if (!(await readSession(c))) return c.redirect(`/login?next=${encodeURIComponent(safeNext(path))}`, 302);
    if (path === "/") return c.redirect("/onboarding", 302);
    return next();
  });

  app.use(
    "*",
    serveStatic({
      root: web.dist,
      onFound: (filePath, c) => {
        c.header(
          "Cache-Control",
          filePath.includes("/_astro/") ? "public, max-age=31536000, immutable" : "private, no-store"
        );
      },
    })
  );

  app.notFound((c) => {
    c.header("Cache-Control", "private, no-store");
    return c.html(notFoundHtml, 404);
  });

  return app;
}
