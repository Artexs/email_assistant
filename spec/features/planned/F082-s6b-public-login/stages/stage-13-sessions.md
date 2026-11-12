# F082 stage 13 — Session list and the sign-out audit rows

Part of [`../plan.md`](../plan.md). Read its F6, L21, L22, B3 and "Rules for every stage" (the Playwright rules) first. Needs stage 3. Gets a review job (audit rows of the auth routes).

Three steps.

- [ ] **13.1 Server: the list route and the audit rows**
  - Goal: a member reads their own live sessions without tokens; "sign out everywhere" and "sign out my other devices" leave an audit row.
  - Files:
    - change `apps/server/src/platform/auth.ts` (`listUserSessions`, `AuthEventKind`, `hooks.after`), `platform/http.ts` (`WebSession.sessionId`), `web.ts` (`getSession`, `eventNames`, the route dep), `modules/audit/repo.ts`, `modules/tenancy/routes.ts`;
    - change the test helpers that build a `WebSession` (`apps/server/test/integration/web-helpers.ts`: `sessionId` = the cookie value; `web-http.test.ts` `makeWeb`);
    - add `packages/core/src/web/sessions.ts` (+ test), export it from `packages/core/src/web/index.ts`;
    - add `apps/server/test/integration/web-sessions.test.ts`.
  - Interfaces:

    ```ts
    // platform/http.ts
    export interface WebSession {
      userId: string;
      sessionId: string;
      setCookie?: string[];
    }

    // platform/auth.ts — reads through Better Auth's internal adapter (F6); never returns the token
    export interface AuthSessionRow {
      id: string;
      userAgent: string | null;
      ipAddress: string | null;
      createdAt: Date;
      updatedAt: Date;
      expiresAt: Date;
    }
    export function listUserSessions(handle: AuthHandle, userId: string): Promise<AuthSessionRow[]>;
    export type AuthEventKind =
      | "login"
      | "password_set"
      | "password_changed"
      | "login_locked"
      | "sessions_revoked"
      | "other_sessions_revoked";

    // packages/core/src/web/sessions.ts
    export const browserCodes = ["edge", "opera", "firefox", "chrome", "safari", "unknown"] as const;
    export const osCodes = ["android", "ios", "windows", "macos", "linux", "unknown"] as const;
    export function deviceOf(userAgent: string | null): {
      browser: (typeof browserCodes)[number];
      os: (typeof osCodes)[number];
    };
    export const sessionViewSchema = z.object({
      id: z.string(),
      current: z.boolean(),
      device: z.object({ browser: z.enum(browserCodes), os: z.enum(osCodes) }),
      address: z.string().nullable(),
      lastUsedAt: z.iso.datetime(),
      createdAt: z.iso.datetime(),
    });
    export const sessionsSchema = z.object({ sessions: z.array(sessionViewSchema) });

    // modules/tenancy/routes.ts — TenancyRouteDeps
    sessions: (userId: string) => Promise<AuthSessionRow[]>; // web.ts: (userId) => listUserSessions(handle, userId)
    ```

  - Decisions:
    - `listUserSessions`: `const context = await handle.auth.$context; const rows = await context.internalAdapter.listSessions(userId);` map each to `AuthSessionRow` (`userAgent || null`, `ipAddress || null`: Better Auth stores `""` for unknown). The token field is never copied.
    - `GET /me/sessions` (any member): rows with `expiresAt > deps.now()`, sorted by `updatedAt` newest first; `current = row.id === c.get("session").sessionId`; `device = deviceOf(row.userAgent)`; `address = row.ipAddress`; ISO dates. Answer `{ sessions }`.
    - `deviceOf` order (first match wins): browser `/Edg\//` edge, `/OPR\/|Opera/` opera, `/Firefox\//` firefox, `/Chrome\//` chrome (also matches `HeadlessChrome/`), `/Safari\//` safari, else unknown; system `/Android/` android, `/iPhone|iPad|iPod/` ios, `/Windows/` windows, `/Mac OS X|Macintosh/` macos, `/Linux/` linux, else unknown.
    - `hooks.after` (L22): path `/revoke-sessions` → `report("sessions_revoked", id)`, `/revoke-other-sessions` → `report("other_sessions_revoked", id)`, only when `ctx.context.returned` is not an `APIError` and `ctx.context.session?.user.id` is set. Events `web.sessions_revoked`, `web.other_sessions_revoked` (data `{ via: "web" }`).
    - `web.ts` `getSession` returns `sessionId: response.response.session.id`.
  - Test:
    1. `sessions.test.ts` (core): `deviceOf` for a Firefox-on-Linux UA → `firefox`/`linux`; Chrome on Windows → `chrome`/`windows`; Safari on iPhone → `safari`/`ios`; Edge on Windows → `edge`/`windows`; Chrome on Android → `chrome`/`android`; `null` and `""` → `unknown`/`unknown`.
    2. `web-sessions`: a user signs in twice (`createAuth`, two cookies) → `listUserSessions` gives 2 rows; no row object has a `token` key; another user's sessions are not in the list.
    3. The route (with `webTestApp` and a fake `sessions` dep): 3 rows, one expired → 2 rows, newest first, `current` true only for the row whose id equals the session id; no session → `401`.
    4. `POST /api/auth/revoke-sessions` with a valid cookie → `200`; one `web.sessions_revoked` row with `actor` = the user id. `/revoke-other-sessions` → one `web.other_sessions_revoked` row. Without a cookie → `401` and no row.
  - Check: `bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: ending one chosen session (B3).

- [ ] **13.2 Web: the list in the Account card**
  - Files: change `apps/web/src/components/settings/AccountCard.tsx`, `apps/web/src/i18n/en.ts`.
  - Decisions: above the "sign out everywhere" button, a section `acct_sessions_title` with one row per session: `t("device_on", { browser: t(\`browser*${device.browser}\`), os: t(\`os*${device.os}\`) })`, the address or `acct_unknown_address`, `t("acct_last_active", { date })`(date only,`Intl.DateTimeFormat`with`dateStyle: "medium"`), and a `Badge` `acct_this_device`on the current row. Data through`useResource(() => api("/api/me/sessions", sessionsSchema))`; loading → `Skeleton`; error → `load_error_text`and`retry`. `en.ts`keys (exact):`acct_sessions_title: "Signed-in devices"`, `acct_this_device: "This device"`, `acct_last_active: "Last active {date}"`, `acct_unknown_address: "Unknown address"`, `device_on: "{browser} on {os}"`, `browser_edge: "Edge"`, `browser_opera: "Opera"`, `browser_firefox: "Firefox"`, `browser_chrome: "Chrome"`, `browser_safari: "Safari"`, `browser_unknown: "Unknown browser"`, `os_android: "Android"`, `os_ios: "iOS"`, `os_windows: "Windows"`, `os_macos: "macOS"`, `os_linux: "Linux"`, `os_unknown: "unknown system"`.
  - Check: `bun run web:build`.
  - Done when: the build passes.

- [ ] **13.3 Playwright**
  - Files: change `apps/web/e2e/tests/account.spec.ts`.
  - Test:
    1. Signed in as the project's member → the Account card shows `acct_sessions_title` and exactly one row with the badge `acct_this_device`.
    2. A second sign-in of the same user in a new browser context → after a reload the first context lists 2 rows, one with the badge.
    3. The existing "sign out everywhere" test still passes.
  - Check: Proof (web form, `/tmp/f082-s13`, specs `account.spec.ts`).
  - Done when: the Proof printed `PROOF_OK`.
