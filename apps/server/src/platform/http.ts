import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { BlockList, isIP } from "node:net";
import { join } from "node:path";

import { type MembershipRole, safeNextPath } from "@ea/core";
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
import { createLog, withLogContext } from "./log";

const log = createLog("http");

export interface WebSession {
  userId: string;
  sessionId: string; // the id of the session row, not the cookie token
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
  homePath?: (userId: string) => Promise<"/onboarding" | "/activity">; // where "/" goes; default "/onboarding"
  routers?: (api: Hono<ApiEnv>) => void; // web.ts mounts the module routers (after requireTenant)
  isOrgSuspended?: (orgId: string) => Promise<boolean>; // absent: no organization is suspended (old tests)
  resetRequestOpen?: boolean; // absent = false: /request-password-reset answers 404
  operatorUserIds?: ReadonlySet<string>; // D16: absent = nobody is an operator
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** D17: a proxy's x-request-id is reused only from a trusted peer and only as a UUID (lower-cased). null: make a new one. */
export function incomingRequestId(
  header: string | undefined,
  peer: string | undefined,
  trusted: BlockList
): string | null {
  if (header === undefined || peer === undefined) return null;
  const value = header.trim().toLowerCase();
  return UUID_PATTERN.test(value) && isTrusted(normalizeAddress(peer), trusted) ? value : null;
}

export function originAllowed(req: { method: string; headers: Headers }, trustedOrigins: ReadonlySet<string>): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return true;
  const origin = req.headers.get("origin");
  // A real Origin must be trusted. Only a missing or "null" Origin falls back to Sec-Fetch-Site.
  if (origin !== null && origin !== "null") return trustedOrigins.has(origin);
  return req.headers.get("sec-fetch-site") === "same-origin";
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
  /^\/forgot\/?$/,
  /^\/legal\/(pl|en)\/(privacy|terms|dpa)\/?$/,
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
    super(400);
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
  return parseWith(schema, input);
}

export function parseQuery<T>(c: Context, schema: z.ZodType<T>): T {
  return parseWith(schema, c.req.query());
}

function parseWith<T>(schema: z.ZodType<T>, input: unknown): T {
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

// S6c adds { method: "DELETE", path: /^\/api\/organization$/ } (delete organization).
// Sign-out and the password routes are Better Auth paths outside `api`: they need no entry.
// A paused account can still accept the terms: it changes no mail and no organization data.
export const SUSPENDED_WRITE_ALLOW: readonly { method: string; path: RegExp }[] = [
  { method: "POST", path: /^\/api\/me\/terms$/ },
];

const READ_METHODS: readonly string[] = ["GET", "HEAD", "OPTIONS"];

// D4, S2: a suspended organization reads, it does not write. A throw goes to onError (500): fail closed.
export const refuseSuspendedWrites: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const web = c.get("web");
  if (
    web.isOrgSuspended === undefined ||
    READ_METHODS.includes(c.req.method) ||
    SUSPENDED_WRITE_ALLOW.some((entry) => entry.method === c.req.method && entry.path.test(c.req.path))
  ) {
    await next();
    return;
  }
  if (await web.isOrgSuspended(c.get("ctx").orgId)) return c.json({ error: "org_suspended" }, 403);
  await next();
};

// D15: every path under /api/operator answers a non-operator like a path that does not exist. The log holds the user id only.
export const requireOperator: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const { userId } = c.get("session");
  if (c.get("web").operatorUserIds?.has(userId) !== true) {
    log.warn(`operator route refused for user ${userId}`);
    return c.json({ error: "not_found" }, 404);
  }
  await next();
};

export const requireOwner: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (c.get("role") !== "owner") return c.json({ error: "owner_only" }, 403);
  await next();
};

async function homeOf(web: WebDeps, userId: string): Promise<"/onboarding" | "/activity"> {
  if (!web.homePath) return "/onboarding";
  try {
    return await web.homePath(userId);
  } catch (error) {
    log.warn(`web: home path failed: ${describeError(error)}`);
    return "/onboarding";
  }
}

const MISSING_BUILD = "The web build is missing. Run bun run web:build.";

export function createApp(deps: HttpDeps): Hono<ApiEnv> {
  const { web } = deps;
  const app = new Hono<ApiEnv>();

  // D17: one request id per request, in every log line of the request and in the response header.
  app.use("*", async (c, next) => {
    const requestId =
      (web === null ? null : incomingRequestId(c.req.header("x-request-id"), web.connInfo(c), web.trustedProxies)) ??
      randomUUID();
    await withLogContext({ request_id: requestId }, () => next());
    c.header("x-request-id", requestId);
  });

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
    if (!isAllowedAuthPath(c.req.method, path, { resetRequest: web.resetRequestOpen === true }))
      return c.json({ error: "not_found" }, 404);
    const address = clientAddress(web.connInfo(c), c.req.header("x-forwarded-for"), web.trustedProxies);
    return web.auth.handler(authRequest(c.req.raw, address));
  });

  const api = new Hono<ApiEnv>();
  api.use("*", requireSession);
  api.use("*", requireTenant({ listMembershipsOfUser: web.listMembershipsOfUser }));
  api.use("/operator/*", requireOperator);
  api.use("*", refuseSuspendedWrites);
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
    const session = await readSession(c);
    if (!session) return c.redirect(`/login?next=${encodeURIComponent(safeNextPath(path))}`, 302);
    if (path === "/") return c.redirect(await homeOf(web, session.userId), 302);
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
