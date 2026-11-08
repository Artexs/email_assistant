# s5a-web-foundation — Stage 2

Part of [`../s5a-web-foundation.md`](../s5a-web-foundation.md). Read that file's "Done when", "Owns", S1–S13, "Facts checked", W1–W20, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first. Decisions named D<n> are in the master plan, W<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 2 — Config keys (D7), `.env.example`, `tenancy` changes (D2, W13, W14), the audit events, the code-patterns lines for them

- [ ] **2.1 Config keys, `.env.example`, `listMembershipsOfUser`, the lower-case e-mail, the audit events**
  - Goal: the server reads the five web keys with the D7 rules; the tenancy module lower-cases on insert and can list a user's organizations; the audit module knows the three web events; `docs/code-patterns.md` names the new repository exception in the same commit as the code.
  - Files: change `apps/server/src/platform/config.ts`, `apps/server/src/platform/config.test.ts`, `.env.example`, `apps/server/src/modules/tenancy/repo.ts`, `apps/server/src/modules/tenancy/service.ts`, `apps/server/src/modules/tenancy/index.ts`, `apps/server/src/modules/audit/repo.ts`, `apps/server/test/integration/tenancy.test.ts`, `docs/code-patterns.md`.
  - Interfaces:

    ```ts
    // config.ts, baseSchema (the emptyAsUndefined pattern of the file)
    WEB_BASE_URL: z.preprocess(emptyAsUndefined, z.string().refine(isOrigin, "must be http(s)://host[:port] with no path, query or hash").optional()),
    WEB_AUTH_SECRET: z.preprocess(emptyAsUndefined, z.string().min(32).optional()), // secret: never print or log it
    WEB_TRUSTED_ORIGINS: z.preprocess(emptyAsUndefined, z.string().optional()), // comma list of origins
    WEB_TRUSTED_PROXIES: z.preprocess(emptyAsUndefined, z.string().optional()), // comma list of IPs or CIDRs
    WEB_DIST: z.preprocess(emptyAsUndefined, z.string().default("apps/web/dist")),
    // superRefine: WEB_BASE_URL set and WEB_AUTH_SECRET undefined → issue on WEB_AUTH_SECRET "needed when WEB_BASE_URL is set";
    // each WEB_TRUSTED_ORIGINS entry must pass isOrigin → else an issue on WEB_TRUSTED_ORIGINS;
    // each WEB_TRUSTED_PROXIES entry must pass isIpOrCidr → else an issue on WEB_TRUSTED_PROXIES.
    export function isOrigin(value: string): boolean; // new URL(value) parses, protocol http: or https:, url.origin === value
    export function isIpOrCidr(value: string): boolean; // net.isIP(ip) !== 0 and, with "/n", 0 ≤ n ≤ 32 (v4) or ≤ 128 (v6)
    export function webTrustedOrigins(config: Config): string[]; // split, trim, drop empty, unique
    export function webTrustedProxies(config: Config): string[]; // the same
    // tenancy/repo.ts
    export interface UserMembership { org_id: string; role: MembershipRole; created_at: Date }
    export async function listMembershipsOfUser(db: Db | Transaction<DB>, userId: string): Promise<UserMembership[]>; // ORDER BY created_at, org_id; no TenantContext (W13)
    // tenancy/index.ts adds: listMembershipsOfUser, type UserMembership
    // tenancy/service.ts: createOrganizationInputSchema.email = z.email().transform((email) => email.toLowerCase())
    // audit/repo.ts auditEvents adds: webLogin: "web.login", webPasswordSet: "web.password_set", webPasswordChanged: "web.password_changed"
    ```

  - Decisions:
    - `WEB_BASE_URL` empty = the web is off (D6); the check does not refuse `http://` (dev), the `warn` for a non-loopback `http://` host lives in `web.ts` (stage 8). `WEB_DIST` default `apps/web/dist` is relative to the process working directory (the repo root for `bun run dev`); the image sets an absolute path (stage 14).
    - `isIpOrCidr` uses `node:net` `isIP` (a pure check); the `BlockList` itself is built in `platform/http.ts` (stage 5) from `webTrustedProxies(config)`.
    - `.env.example` block (after the Telegram keys; `WEB_BASE_URL=` stays empty on purpose: the web is opt-in, and a filled example would break a fresh start without a secret — D18 as refined):

      ```
      # Web panel (S5). Empty = the web is off: no login, no pages, no /api. Dev: http://localhost:4321 (bun run web:dev proxies /api to 8080);
      # the built shape (bun run web:build && bun run dev) is reached on http://127.0.0.1:8080 and needs that origin in WEB_TRUSTED_ORIGINS.
      WEB_BASE_URL=
      # Session cookie secret, 32 or more characters: openssl rand -base64 32. Required when WEB_BASE_URL is set. Secret: never print or log it.
      WEB_AUTH_SECRET=
      # Other browser origins that may call the API (comma list). Dev default below; VPS: empty.
      WEB_TRUSTED_ORIGINS=http://127.0.0.1:8080,http://localhost:8080
      # Proxies that may set x-forwarded-for (IPs or CIDRs, comma list). Empty = none. VPS: the Compose bridge gateway (S5e).
      WEB_TRUSTED_PROXIES=
      # The built web app folder. Empty = apps/web/dist (relative to the repo root); the image sets /app/apps/web/dist.
      WEB_DIST=
      # Playwright (bun run test:e2e) uses its own database: bun run db:worktree e2e | grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' | sed 's/^/E2E_/' >> .env
      E2E_DATABASE_URL=
      E2E_MIGRATOR_DATABASE_URL=
      # Local Playwright runs with the system Chromium (empty = Playwright's own browser, installed with bunx playwright install chromium).
      CHROMIUM_PATH=
      ```

    - `listMembershipsOfUser` is the one new repository function without a `TenantContext` (D3): it reads `memberships` only (no join: the route reads the organization with `getOrganization`). `docs/code-patterns.md` "Data access" exceptions list gets, in this stage: "`listMembershipsOfUser` (`tenancy/repo.ts`, S5a): the user gives the tenant; the web resolves the organization from the session." and the sentence "The tables `auth_sessions`, `auth_accounts`, `auth_verifications` and the Better Auth columns of `users` are read and written only by the Better Auth library through `platform/auth.ts`; no repository function touches them." (the header of that file asks for the doc and the code in one commit).
    - `createOrganizationWithOwner` lower-cases through the schema transform; `CreateOrganizationInput` stays `z.input` (the caller may pass any case). `org:create` prints nothing new.

  - Test:
    1. `config.test.ts`: `WEB_BASE_URL=https://ea.example.ts.net` without `WEB_AUTH_SECRET` → `ConfigError` keys `["WEB_AUTH_SECRET"]`; with a 31-character secret → the same key; with 32 → OK; `WEB_BASE_URL=https://x.test/panel` → key `WEB_BASE_URL` (a path); `http://localhost:4321` → OK; `WEB_TRUSTED_ORIGINS="http://127.0.0.1:8080, http://localhost:8080"` → `webTrustedOrigins` = the two trimmed values; `"http://x.test/"` (trailing slash) → key `WEB_TRUSTED_ORIGINS`; `WEB_TRUSTED_PROXIES="172.18.0.1, 10.0.0.0/8, fd00::/8"` → OK, three entries; `"172.18.0.1/33"` and `"gateway"` → key `WEB_TRUSTED_PROXIES`; empty web keys → the web keys are `undefined` and `WEB_DIST` is `apps/web/dist`; the existing tests stay green.
    2. `tenancy.test.ts`: `createOrganizationWithOwner` with `email: "Owner.Mixed@X.test"` stores `owner.mixed@x.test` (read `users.email`); `listMembershipsOfUser` for a user in two organizations returns two rows ordered by `created_at` (insert the second membership with `insertMembership` and move its `created_at` one hour later with an `UPDATE`), and for an unknown user `[]`.
    3. `audit`: the three constants exist (the stage 3 tests assert the stored `event` strings).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int && bunx prettier --check docs/code-patterns.md`.
  - Done when: the tests pass; `bun run dev` with the old `.env` (no web keys) starts as before (the server stays silent about the web until stage 8 adds the `web is off` line).
  - Out of scope: `platform/auth.ts` (stage 3), HTTP (stages 5–6).
