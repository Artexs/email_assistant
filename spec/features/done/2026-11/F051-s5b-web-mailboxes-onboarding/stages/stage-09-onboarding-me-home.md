# s5b-web-mailboxes-onboarding — Stage 9

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", S1–S12, "Facts checked", B1–B17, "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first.

## Stage 9 — Onboarding state, the `/api/me` fill, `keep-mode`, the `/` rule [risky]

One step. It changes the S5a contract (`telegram` and `onboarding` are objects now) and the page gate.

- [x] **9.1 D15 end to end on the server, the shell rule (B13)**
  - Goal: `/api/me` carries the onboarding state and the Telegram state; the owner can keep shadow mode once; `/` goes to `/onboarding` while open and to `/activity` when done.
  - Files: change `packages/core/src/web/me.ts`, `me.test.ts`, `modules/audit/repo.ts` (`onboardingModeKept`, `hasAuditEvent`, `recordAuditOnce`), `modules/audit/index.ts`, `modules/config/repo.ts` + `index.ts` (`countSenderRules`), `modules/tenancy/routes.ts`, `apps/server/src/web.ts`, `apps/server/src/platform/http.ts` (`WebDeps.homePath`, the `/` rule), `apps/web/src/components/shell/AppShell.tsx` (the S5b note goes), `apps/server/test/integration/web-me.test.ts` (moves to `web-helpers.ts`), `web-helpers.ts` (`homePath` and `dist` options, B17), `web-http.test.ts` (the `/` cases); create `apps/server/test/integration/web-onboarding.test.ts`.
  - Interfaces:

    ```ts
    // core/web/me.ts
    telegram: z.object({ available: z.boolean(), linked: z.boolean(), botUsername: z.string().nullable() }),
    onboarding: onboardingSchema,
    // audit/repo.ts
    onboardingModeKept: "onboarding.mode_kept",
    export async function hasAuditEvent(db: DbOrTrx, ctx: TenantContext, events: readonly string[]): Promise<boolean>;
    // INSERT INTO audit_log (…) SELECT … WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE org_id = ctx.orgId AND event = event.event); true = a row was written
    export async function recordAuditOnce(db: DbOrTrx, ctx: TenantContext, event: AuditEvent): Promise<boolean>;
    // config/repo.ts
    export async function countSenderRules(db: DbOrTrx, ctx: TenantContext): Promise<number>; // every rule of the org, org-wide and per mailbox
    // tenancy/routes.ts
    export interface TenancyRouteDeps {
      db: Db;
      now(): Date;
      scopes: { triage: ScopeInfo; actions: ScopeInfo; send: ScopeInfo };
      countMailboxes(ctx: TenantContext): Promise<{ total: number; inAuthError: number }>;
      onboarding(ctx: TenantContext, userId: string): Promise<Onboarding>;
      telegram(ctx: TenantContext, userId: string): Promise<{ available: boolean; linked: boolean; botUsername: string | null }>;
      keepMode(ctx: TenantContext, userId: string, now: Date): Promise<void>;
    }
    // platform/http.ts
    export interface WebDeps { …; homePath?: (userId: string) => Promise<"/onboarding" | "/activity"> }
    // web.ts
    export function onboardingDeps(db: Db, botUsername: (() => Promise<string>) | null):
      Pick<TenancyRouteDeps, "onboarding" | "telegram" | "keepMode">;
    export function homePathOf(db: Db): NonNullable<WebDeps["homePath"]>;
    ```

  - Decisions:
    - `onboarding(ctx, userId)` = `onboardingOf({ mailboxCount: (await listMailboxes(db, ctx)).length, telegramLinked: (await getChatLinkForUser(db, ctx, userId)) !== undefined, modeChosen: await hasAuditEvent(db, ctx, [auditEvents.mailboxModeChanged, auditEvents.onboardingModeKept]), ruleCount: await countSenderRules(db, ctx) })`. The Telegram item is per user; the others are per organization (D15).
    - `telegram(ctx, userId)` = `{ available: botUsername !== null, linked: <the same link check>, botUsername: botUsername ? await botUsername().catch(() => null) : null }` (a `getMe` failure never fails `/api/me`, and the runtime bounds it to 3 s: B9). `onboarding` passes `telegramAvailable: botUsername !== null` to `onboardingOf` (B2: a server without a bot never blocks `done`; cold review finding 8). So `onboardingDeps` builds both from the same `botUsername` argument.
    - `keepMode` = `recordAuditOnce(db, ctx, { actor: userId, event: auditEvents.onboardingModeKept, data: { via: "web" }, at: now })`; the route `POST /onboarding/keep-mode` (with `requireOwner`) → `c.body(null, 204)`; a second call writes no row and still answers 204.
    - `homePathOf(db)(userId)`: `listMembershipsOfUser` → none → `"/onboarding"`; else `onboarding({ orgId }, userId).done ? "/activity" : "/onboarding"`.
    - `http.ts` page gate: `if (path === "/") { const session = await readSession(c); … return c.redirect(await home(session.userId), 302) }` where `home` calls `web.homePath` when set, else `"/onboarding"`; an error inside `homePath` → `log.warn(`web: home path failed: ${describeError(error)}`)` and `"/onboarding"`. The platform still imports no module.
    - `AppShell.tsx`: `const onboardingOpen = me === null || !me.onboarding.done;` (remove the S5b comment).
    - `web-me.test.ts` keeps its four cases (now through `webTestApp` and `webOrg`) and its `telegram`/`onboarding` expectations change to the objects.
  - Test (`web-onboarding.test.ts`, committed through `webOrg`):
    1. Fresh organization: `/api/me` as the owner → `onboarding` `{ mailbox: false, telegram: false, mode: false, rules: 0, done: false }`, `telegram` `{ available: true, linked: false, botUsername: "fake_ea_bot" }`, `onboarding.telegramAvailable` true (the deps' fake); `meSchema` parses.
    2. Add a mailbox, link the owner's chat (`linkChat`), write `mailbox.mode_changed` through `recordAudit` → `done: true`; the assistant (not linked) sees `telegram: false`, `done: false` (per-user item).
    3. `keep-mode` as the owner → 204; one `onboarding.mode_kept` row with `actor` = the owner, `data { via: "web" }`; again → 204, still one row; `mode: true`.
    4. `keep-mode` as the assistant → 403 `owner_only`; without `Origin` → 403 `bad_origin`; no cookie → 401.
    5. A sender rule (`insertSenderRule`) → `rules: 1`, `done` unchanged.
    6. `botUsername` that rejects → `/api/me` 200 with `available: true`, `botUsername: null`. With `botUsername: null` (no bot): a mailbox and a mode row and no link → `done: true`, `telegramAvailable: false`.
       6a. Tenant filters (code patterns; cold review finding 11): a `mailbox.mode_changed` row and a sender rule in **another** organization leave `hasAuditEvent` false and `countSenderRules` 0 for this one.
    7. `/` (with a temp dist made like `web-http.test.ts:20-28` and passed through the new `dist` option of `webTestApp`, and `homePath: homePathOf(db)`): the fresh owner → 302 `/onboarding`; after test 2's state → 302 `/activity`; a user with no membership → 302 `/onboarding`; no session → 302 `/login?next=%2F` (unchanged S5a rule); a `homePath` that throws → 302 `/onboarding` and one `warn` line.
    8. `me.test.ts` (core): the old `telegram: null` sample now fails; the new shape passes.
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int && cd apps/web && bun run build`.
  - Done when: the tests pass; `grep -n "S5b" apps/web/src/components/shell/AppShell.tsx` finds nothing; the Playwright S5a smoke (`bun run test:e2e`, after `bun run web:build`) still passes (`/` → `/onboarding` for the seed owner).
  - Out of scope: the pages (stages 10–13).
