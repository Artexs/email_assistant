# s5a-web-foundation — Stage 5

Part of [`../s5a-web-foundation.md`](../s5a-web-foundation.md). Read that file's "Done when", "Owns", S1–S13, "Facts checked", W1–W20, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first. Decisions named D<n> are in the master plan, W<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 5 — `platform/http.ts`: the `WebDeps` type and the pure helpers of W1, W3, W8 (unit-tested); `createApp` is unchanged here

- [ ] **5.1 Types and pure helpers**
  - Goal: every rule of the HTTP platform that can be a pure function is one, with a unit test, before stage 6 wires them into `createApp`.
  - Files: change `apps/server/src/platform/http.ts` (add exports; `createApp` stays as today), create `apps/server/src/platform/http.test.ts`.
  - Interfaces:

    ```ts
    // platform/http.ts (additions)
    import { BlockList, isIP } from "node:net";
    import type { Context, Hono, MiddlewareHandler } from "hono";
    import { HTTPException } from "hono/http-exception";
    import type { MembershipRole } from "@ea/core";
    import type { z } from "zod";
    import type { Db, TenantContext } from "./db";

    export interface WebSession {
      userId: string;
      setCookie?: string[];
    } // setCookie: refreshed cookies from Better Auth (W17)
    export interface WebDeps {
      auth: { handler(req: Request): Promise<Response>; getSession(headers: Headers): Promise<WebSession | null> };
      db: Db;
      now: () => Date;
      dist: string; // absolute path of the built web app
      baseUrl: URL;
      trustedOrigins: ReadonlySet<string>; // includes baseUrl.origin
      trustedProxies: BlockList;
      connInfo: (c: Context) => string | undefined; // the TCP peer address; undefined when unknown
      listMembershipsOfUser: (userId: string) => Promise<{ org_id: string; role: MembershipRole }[]>; // filled by web.ts
      routers?: (api: Hono<ApiEnv>) => void; // web.ts mounts the module routers (after requireTenant)
    }
    export interface HttpDeps {
      checkDb: () => Promise<boolean>;
      web?: WebDeps | null;
    } // `web` optional here; stage 6 makes it required
    export type ApiEnv = { Variables: { session: WebSession; ctx: TenantContext; role: MembershipRole } };

    export function buildTrustedProxies(entries: readonly string[]): BlockList; // "a.b.c.d" → addAddress; "a.b.c.d/n" → addSubnet(…, n, "ipv4"); IPv6 the same with "ipv6"; an invalid entry throws (the config check refused it already)
    export function normalizeAddress(address: string): string; // "::ffff:a.b.c.d" → "a.b.c.d"; else unchanged
    export function clientAddress(
      peer: string | undefined,
      forwardedFor: string | undefined,
      trusted: BlockList
    ): string | null; // W1
    export function originAllowed(
      req: { method: string; headers: Headers },
      trustedOrigins: ReadonlySet<string>
    ): boolean; // GET/HEAD/OPTIONS → true; else Sec-Fetch-Site === "same-origin" || trustedOrigins.has(Origin)
    export function safeNext(path: string | null | undefined): string; // the six steps under Decisions; else "/"
    export function authRequest(req: Request, address: string | null): Request; // a copy without x-client-ip, plus x-client-ip = address when not null; duplex "half" when a body exists
    export const PUBLIC_PAGE_PATHS: readonly RegExp[]; // /^\/login\/?$/, /^\/setup\/?$/, /^\/404\.html$/, /^\/_astro\//, /^\/favicon\./, /^\/robots\.txt$/
    export class ValidationError extends HTTPException {
      constructor(details: { path: string; code: string; message: string }[]);
    } // status 400, res = JSON { error: "validation", details }
    export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T>; // c.req.json() → SyntaxError → ValidationError([{ path: "", code: "invalid_json", message: "invalid JSON" }]); schema.safeParse → ValidationError(issues mapped to path, code, message); never the input (D9)
    ```

  - Decisions:
    - `clientAddress` (W1): normalise the peer and every forwarded entry with `normalizeAddress`; peer undefined → `null` (a forwarded header alone is never trusted); peer in `trusted` and `forwardedFor` set → walk the comma list from the right (trim each entry) and return the first entry not in `trusted`; an entry that is not a plain IP (`isIP === 0`, for example with a port or brackets) ends the walk and returns the peer (fail closed: the entries left of it are client-controlled; second cold review, finding 5); none left → the peer; peer not in `trusted` → the peer. `BlockList.check(address, family)` with `family = isIP(address) === 6 ? "ipv6" : "ipv4"`.
    - `authRequest`: `headers = new Headers(req.headers)`; `headers.delete("x-client-ip")`; `if (address) headers.set("x-client-ip", address)`; `new Request(req.url, { method: req.method, headers, body: req.body, duplex: "half", redirect: "manual" })` for a request with a body, without `body` and `duplex` otherwise.
    - `safeNext` is the server twin of the browser's `safeNextPath` (stage 11) and guards the open redirect of D3 and the `/login?next=/login` loop (cold review of this plan, finding 11). The rule, in this order (the browser twin uses the same steps and the same test list): (1) `null`, `undefined` or `""` → `/`; (2) a character in U+0000–U+001F or U+007F → `/` (the URL parser drops tab, LF and CR, so `"/\t/evil.test"` would become `//evil.test` and leave the origin: second cold review, finding 1); (3) not starting with `/`, starting with `//`, or holding a backslash → `/`; (4) `const url = new URL(value, "http://x.invalid")`, and `url.origin !== "http://x.invalid"` → `/`; (5) `url.pathname` starts with `/login` or `/setup` → `/`; (6) else `${url.pathname}${url.search}${url.hash}`.
    - `parseBody` is the one way a route reads a JSON body: a bad body becomes a 400 with the D9 `details`; a `ZodError` anywhere else (for example a response-shape parse) stays a 500 in stage 6's `onError` (a bug on our side, never a client error).
    - `ValidationError` extends Hono's `HTTPException` with a prepared `res` (the JSON body), so stage 6's `onError` returns `error.res` for every `HTTPException` that has one.
    - `WebDeps` carries no `scopes`: `web.ts` passes them to `tenancyRoutes` (stage 8); the platform does not read them.
  - Test (`http.test.ts`, unit):
    1. `clientAddress("172.18.0.1", "203.0.113.9", trusted(["172.18.0.0/16"]))` → `203.0.113.9`; `("172.18.0.1", "203.0.113.9, 172.18.0.5", t)` → `203.0.113.9`; `("172.18.0.1", "203.0.113.9, 10.0.0.1", t)` → `10.0.0.1` (the first untrusted hop from the right); `("203.0.113.9", "1.2.3.4", t)` → `203.0.113.9` (a direct client cannot spoof); `("::ffff:172.18.0.1", "203.0.113.9", t)` → `203.0.113.9`; `(undefined, "1.2.3.4", t)` → `null`; `("127.0.0.1", undefined, trusted(["127.0.0.1"]))` → `127.0.0.1`; `("172.18.0.1", "garbage, 203.0.113.9", t)` → `203.0.113.9`; `("172.18.0.1", "1.2.3.4, 203.0.113.9:5123", t)` → `172.18.0.1` (a non-IP hop ends the walk); `("172.18.0.1", "172.18.0.9", t)` → `172.18.0.1` (every hop trusted → the peer).
    2. `buildTrustedProxies(["10.0.0.0/8", "fd00::/8", "172.18.0.1"])`: `10.1.2.3` true, `11.0.0.1` false, `fd00::1` true, `172.18.0.1` true, `172.18.0.2` false; `normalizeAddress("::ffff:10.0.0.1")` → `10.0.0.1`, `("2001:db8::1")` unchanged.
    3. `originAllowed`: `GET` without headers → true; `POST` with `Origin: https://ea.test` and the set `{ "https://ea.test" }` → true; `POST` with `Sec-Fetch-Site: same-origin` and no Origin → true; `POST` with `Origin: https://evil.test` → false; `POST` with `Origin: null` → false; `POST` with nothing → false.
    4. `safeNext("/mailboxes?x=1")` → the same; `"//evil.test"` → `/`; `"https://evil.test"` → `/`; `"/\\evil"` → `/`; `"/login"`, `"/login?next=%2F"`, `"/setup?token=abc"` → `/`; `null` → `/`; `""` → `/`; `"/\t/evil.test"`, `"/\n/evil.test"`, `"/\r\n/evil.test"` → `/`; `"/%09/evil.test"` → the same (it stays on the origin); `"/mailboxes?x=1#y"` → the same.
    5. `authRequest`: an incoming `x-client-ip: 9.9.9.9` is dropped; `address` `203.0.113.9` is set; `null` → no header; the method, the `cookie` header and the body survive (`await (await authRequest(req, null)).text()` equals the original for a POST with a JSON body; a GET has no body).
    6. `parseBody` with a bare `Hono` app and `app.request`: `{ "n": "x" }` against `z.object({ n: z.number() })` → the thrown `ValidationError` has `status 400` and a `res` whose JSON is `{ error: "validation", details: [{ path: "n", code: "invalid_type", message: … }] }` and whose text does not contain `"x"`; the body `{not json` → `details[0].code === "invalid_json"`; a good body → the parsed value.
  - Check: the database guard (segment file, user step 0; it must print `/email_assistant_s5a /email_assistant_s5a`, else stop), then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int` (the existing `health.test.ts` still passes: `createApp` is unchanged).
  - Done when: the unit tests pass; `platform/http.ts` imports nothing from `modules/`.
  - Out of scope: the request chain, static serving, errors (stage 6).
