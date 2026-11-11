# s5b-web-mailboxes-onboarding — Stage 6

Part of [`../s5b-web-mailboxes-onboarding.md`](../s5b-web-mailboxes-onboarding.md). Read that file's "Done when", "Owns", S1–S12, "Facts checked", B1–B17, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 6 — `botUsername`, `channels/routes.ts`, the web route test helper [risky]

One step. The routes hand out a one-time link token in a response body: they are a security surface.

- [x] **6.1 Telegram routes (B9) and the test helper (B17)**
  - Goal: a signed-in member gets their Telegram state, a fresh `t.me` link and can unlink, with the same token rules as the CLI; later route stages reuse one test helper.
  - Files: create `apps/server/src/modules/channels/routes.ts`, `apps/server/test/integration/web-helpers.ts`, `apps/server/test/integration/web-telegram.test.ts`, `apps/server/src/modules/channels/telegram/runtime.test.ts`; change `channels/telegram/runtime.ts` (`botUsername`), `channels/linking.ts` (`unlinkUser` actor), `channels/index.ts` (exports `channelRoutes`, `type ChannelRouteDeps`, `getChatLinkForUser`), `apps/server/test/integration/channels-linking.test.ts` if an `unlinkUser` call needs the new argument (it is optional: none should).
  - Interfaces:

    ```ts
    // channels/telegram/runtime.ts
    export interface TelegramRuntime {
      notify();
      scheduleDigests();
      startPolling();
      stop();
      botUsername(): Promise<string>;
    }
    // channels/linking.ts
    export async function unlinkUser(
      db: Db,
      ctx: TenantContext,
      userId: string,
      now: Date,
      opts?: { actor?: string }
    ): Promise<number>;
    // channels/routes.ts
    export interface ChannelRouteDeps {
      db: Db;
      now(): Date;
      botUsername: (() => Promise<string>) | null; // null: Telegram is off on this server
    }
    export function channelRoutes(deps: ChannelRouteDeps): Hono<ApiEnv>;
    // GET /channels/telegram, POST /channels/telegram/link, DELETE /channels/telegram/link
    // test/integration/web-helpers.ts
    export interface WebTestOptions {
      db: Db;
      sessions: Record<string, string>;
      routers: WebDeps["routers"];
    } // stage 9 adds homePath
    export function webTestApp(opts: WebTestOptions): Hono<ApiEnv>;
    export const TEST_ORIGIN = "http://127.0.0.1:8080";
    export function as(cookie: string, init?: { method?: string; body?: unknown }): RequestInit; // cookie, Origin: TEST_ORIGIN, JSON body + content-type when body is given
    export interface WebOrg {
      orgId: string;
      ownerId: string;
      assistantId: string;
      otherOrgId: string;
      otherOwnerId: string;
      cleanup(): Promise<void>;
    }
    export async function webOrg(db: Db): Promise<WebOrg>; // committed: org with owner + assistant, a second org with its owner
    ```

  - Decisions:
    - `botUsername()` in `createTelegramRuntime` = `cacheOnSuccess(() => withTimeout(bot.api.getMe().then((me) => me.username), BOT_USERNAME_TIMEOUT_MS))` with `BOT_USERNAME_TIMEOUT_MS = 3_000` (B9; grammY's own API timeout is 500 s, cold review finding 4): `cacheOnSuccess` keeps the promise on success and drops it on a rejection, so the next call tries again; `withTimeout` rejects with `new SoftError("telegram getMe timed out")` and clears its timer. Both helpers are exported from `runtime.ts` for the unit test. No log here (the route logs a label).
    - `GET /channels/telegram`: `link = await getChatLinkForUser(db, ctx, userId)` (the session user; `c.get("session").userId`); `botUsername` = `deps.botUsername ? await deps.botUsername().catch(() => null) : null`; answer `{ available: deps.botUsername !== null, linked: link !== undefined, linkedAt: link?.linkedAt ?? null, botUsername }` (B9; finding 9).
    - `POST /channels/telegram/link`: `deps.botUsername === null` → 409 `{ error: "telegram_off" }`; `botUsername()` throws → `log.warn(`web: telegram getMe failed: ${telegramErrorLabel(error)}`)` and 502 `{ error: "telegram_unreachable" }` (no token row is made: the bot check comes first, as in `scripts/telegram-link.ts`); else `createLinkToken(db, ctx, userId, now)` and 200 `{ url: `https://t.me/${username}?start=${token}`, expiresAt }` with the header `Cache-Control: no-store`; `log.info(`web: telegram link made for user ${userId}`)`. Never log the token, the URL or the username with the token.
    - `DELETE /channels/telegram/link`: `unlinkUser(db, ctx, userId, now, { actor: userId })` → 204 with no body (also when 0 rows: idempotent).
    - Every route is for any member (no `requireOwner`): each user links their own chat (P4, the contract). `routes.ts` imports `./repo`, `./linking`, `./telegram/errors` only (never `./index`: a cycle).
    - `unlinkUser`'s audit row: `actor: opts?.actor ?? "system"`, the rest unchanged.
    - `webTestApp` copies the `WebDeps` of `web-me.test.ts` (`dist: "/nonexistent/dist"`, `trustedOrigins: new Set([TEST_ORIGIN])`, `trustedProxies: buildTrustedProxies([])`, `connInfo: () => undefined`, `listMembershipsOfUser` from `tenancy`) and returns `createApp({ checkDb: async () => true, web })`. `web-me.test.ts` moves to it in stage 9.
  - Test (`web-telegram.test.ts`; committed data through `webOrg`, `cleanup` in `afterEach`; the fake `botUsername` is `async () => "fake_ea_bot"`):
    1. Matrix: each route with no cookie → 401; `POST` and `DELETE` without the `Origin` header → 403 `bad_origin` (the S5a origin check still runs before the router).
    2. `GET` for the owner before a link → `{ available: true, linked: false, linkedAt: null, botUsername: "fake_ea_bot" }` (parse with `telegramStateSchema`).
    3. `POST /link` as the assistant → 200; `telegramLinkSchema` parses the body; the URL matches `^https://t\.me/fake_ea_bot\?start=[A-Za-z0-9_-]{43}$`; `expiresAt` is 15 minutes after `now` (fixed `now` in the deps); the header `cache-control` is `no-store`; one `chat_link_tokens` row for the assistant in the organization; then `consumeLinkToken(db, { token, chatId: randomChatId(), now })` → `linked`, and `GET` → `linked: true`, `linkedAt` = that time.
    4. `DELETE /link` → 204; `GET` → `linked: false`; the `chat.unlinked` audit row has `actor` = the user id; a second `DELETE` → 204 and no second row.
    5. `botUsername: null` → `POST /link` → 409 `telegram_off`; `GET` → `available: false`, `botUsername: null`; no token row.
    6. `botUsername` that rejects → `POST /link` → 502 `telegram_unreachable`, no token row; `GET` → 200 with `available: true`, `botUsername: null`.
    7. Tenant: the owner of the other organization calling `DELETE /link` leaves the first organization's chat link in place (the route only ever uses the session user and `ctx`).
    8. Log: with a captured log (the pattern of `web-auth-logs.test.ts`), the `POST /link` flow writes no line that contains the token or `start=`.
    9. Unit (`channels/telegram/runtime.test.ts`): `botUsername()` is built on an exported pure helper `cacheOnSuccess<T>(load: () => Promise<T>): () => Promise<T>`; two calls → one `load`; a rejected `load` → the next call loads again; a resolved value is returned to both callers; `withTimeout(new Promise(() => {}), 50)` rejects with a `SoftError` within 1 s (a `getMe` that never answers cannot hold `/api/me`).
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; `web-helpers.ts` is used by `web-telegram.test.ts`.
  - Out of scope: the wiring in `web.ts` and `main.ts` (stage 7), the page (stages 10, 12, 13).
