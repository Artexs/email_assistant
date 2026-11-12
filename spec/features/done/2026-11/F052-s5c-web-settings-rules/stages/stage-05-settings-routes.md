# s5c-web-settings-rules — Stage 5

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", S1–S11, "Facts checked", B1–B16, "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first.

## Stage 5 — Settings routes, the view composer, the composition [risky]

One step. Every route changes what the assistant may do to real mail; the owner rule, the tenant rule and the gate-closing expiry must hold on each.

- [x] **5.1 `config/view.ts`, `config/routes.ts` (`settingsRoutes`), `web.ts` (B3–B6)**
  - Goal: the web reads the settings of one mailbox with the gate and the synced folders, and changes the mode, a switch, a category's `auto` and a synced folder, with the same audit rows and expiry as the CLI.
  - Files: create `apps/server/src/modules/config/view.ts`, `apps/server/src/modules/config/routes.ts`, `apps/server/test/integration/web-settings.test.ts`; change `config/index.ts`, `apps/server/src/web.ts`.
  - Interfaces:

    ```ts
    // config/view.ts
    import type { BarCategory, GateView, SettingsWebView, SwitchableSyncFolderKey } from "@ea/core";
    export interface SettingsViewDeps {
      settings: SettingsDeps;
      goNoGo(ctx: TenantContext, mailboxId: string, now: Date): Promise<Record<BarCategory, GateView>>;
      listSyncFolders(ctx: TenantContext, mailboxId: string): Promise<SettingsWebView["syncFolders"]>;
    }
    export async function buildSettingsView(
      deps: SettingsViewDeps,
      ctx: TenantContext,
      mailboxId: string
    ): Promise<SettingsWebView>;

    // config/routes.ts
    export type AutoGateOutcome = { kind: "changed"; change: SettingsChange } | { kind: "refused"; gate: GateView };
    export interface SettingsRouteDeps extends SettingsViewDeps {
      db: Db;
      now(): Date;
      setAuto(
        ctx: TenantContext,
        mailboxId: string,
        input: { category: BarCategory; auto: boolean; force: boolean; actor: string }
      ): Promise<AutoGateOutcome>;
      setSyncFolder(
        ctx: TenantContext,
        mailboxId: string,
        input: { key: SwitchableSyncFolderKey; enabled: boolean; actor: string; now: Date }
      ): Promise<"changed" | "same" | "not_found">;
    }
    export function settingsRoutes(deps: SettingsRouteDeps): Hono<ApiEnv>;

    // web.ts
    export function settingsRouteDeps(db: Db, now: () => Date): SettingsRouteDeps;
    ```

  - Decisions:
    - `buildSettingsView`: `getSettingsView(deps.settings, ctx, id)` (throws `SettingsNotFoundError`), `deps.goNoGo(ctx, id, deps.settings.now())`, `deps.listSyncFolders(ctx, id)` → `{ mailboxId: id, mode, toolSwitches, movesSupported, categories: barCategories.map((category) => ({ category, auto: autoFor(policy, category), threshold: thresholdFor(policy, category), gate: gates[category] })), syncFolders, bar: GATE_BAR, minKept: GATE_MIN_KEPT }`. Three reads; no write.
    - `config/routes.ts` imports `repo`, `service`, `view` and the platform; never `index` (a cycle) and never another server module at run time (`@ea/core` values such as `modeBodySchema`, `barCategories`, `GATE_BAR`, `autoFor` are fine). The `AutoGateOutcome` shape matches `triage`'s `AutoGateResult` without its `gate` on `changed` (TypeScript checks the assignment in `web.ts`).
    - Helpers in the route file: `mailboxIdOf(c)` (`z.uuid().safeParse(c.req.param("mailboxId"))`; null → 404 with no database call); `ensureSettings(c, id)` = `getMailboxSettings(db, ctx, id)` → undefined → 404 (runs before the gate, so another organization's id never gets 409); `respond(c, ctx, id, change)` = 200 `{ changed, expired, settings: await buildSettingsView(…) }`; a `SettingsNotFoundError` from any call → 404 (wrap the handlers with one `try`/`catch` helper, rethrow other errors).
    - `GET /settings/:mailboxId` (member) → `ensureSettings` → 200 `buildSettingsView`.
    - `PATCH /settings/:mailboxId/mode` (owner) → `ensureSettings` → `parseBody(c, modeBodySchema)` → `setMode(deps.settings, ctx, id, { mode, keepSwitches, actor: userId })` → `respond` with `change.changed`, `change.expired`.
    - `PATCH /settings/:mailboxId/switches/:name` (owner) → `:name` not in `toolSwitchNames` → 404 → `ensureSettings` → `parseBody(c, switchBodySchema)` → `setToolSwitch(…, { name, value, actor })` → `respond`.
    - `PATCH /settings/:mailboxId/auto/:category` (owner) → `:category` not in `barCategories` → 404 → `ensureSettings` → `parseBody(c, autoBodySchema)` → `deps.setAuto(ctx, id, { category, auto, force: force ?? false, actor })`: `refused` → 409 `{ error: "no_go", gate }`; `changed` → `respond`.
    - `PATCH /settings/:mailboxId/sync-folders/:key` (owner) → `:key` not in `switchableSyncFolderKeys` → 404 → `ensureSettings` → `parseBody(c, syncFolderBodySchema)` → `deps.setSyncFolder(ctx, id, { key, enabled, actor: userId, now: deps.now() })`: `not_found` → 404; else `respond` with `changed: result === "changed"`, `expired: 0`.
    - Order in each PATCH: id check → name check → `ensureSettings` → body → service. Tests depend on it (a foreign id with a bad body is 404).
    - `web.ts` `settingsRouteDeps(db, now)`: `const settings = settingsDeps(db, now)` (stage 2); `goNoGo: (ctx, id, at) => goNoGoFor(db, ctx, id, at)`; `setAuto: async (ctx, id, input) => { const result = await setCategoryAutoWithGate(settings, ctx, id, input); return result.kind === "refused" ? result : { kind: "changed", change: result.change }; }`; `listSyncFolders: async (ctx, id) => (await listSyncFolders(db, ctx, id, { enabledOnly: false })).map(({ key, role, path, enabled }) => ({ key, role, path, enabled }))`; `setSyncFolder: (ctx, id, input) => setSyncFolderEnabled(db, ctx, id, input.key, input.enabled, input.actor, input.now)`. `routers` mounts `settingsRoutes(settingsRouteDeps(db, now))` after `mailRoutes`. `web.ts` may import `triage`, `mail`, `config` and `composition` (the composition root).
    - No log line per change (the audit rows hold them; the access log has the route pattern).
  - Test (`web-settings.test.ts`; `webTestApp` with `routers: (api) => api.route("/", settingsRoutes(settingsRouteDeps(db, () => NOW)))`, `webOrg`, `as()`; each test makes its own `webOrg` and committed mailboxes with `insertMailbox` + `insertInboxFolder` + `insertDefaultSettings` in the owner's organization (M1) and in the other organization (M2); `NOW = 2026-11-11T12:00:00Z`; cleanup by `webOrg().cleanup()` in `afterEach`):
    1. Matrix for each of the five routes: no cookie → 401; the assistant on the four PATCH routes → 403 `owner_only`; `GET` as the assistant → 200; M2's id → 404 (GET and every PATCH, also `auto` with `{ auto: true }`: 404, not 409); `"not-a-uuid"` → 404; `switches/nope`, `auto/delegation`, `sync-folders/inbox` → 404; `mode` with `{ mode: "on" }` → 400 `validation` with `details[0].path` `mode`; a PATCH without `Origin` → 403 `bad_origin`.
    2. `GET` M1 → `settingsViewSchema` parses; `mode` `shadow`; every switch false; five categories in `barCategories` order, each `auto` false, threshold 0.7, gate `no-go: too few`; `syncFolders` `[{ key: "inbox", role: "inbox", path: "INBOX", enabled: true }]`; `bar` 0.98, `minKept` 30.
    3. `PATCH mode { mode: "assist", keepSwitches: false }` → 200, `changed` true, the view has `assist` and move, mark_read, flag on; one `mailbox.mode_changed` row with actor = the owner's id and `switches_set: true`.
    4. Expiry (after `PATCH mode { mode: "assist", keepSwitches: false }`, so `move` is on): a `ready` `move` action on an `info` mail of M1 (`db.transaction().execute((trx) => insertTriagedWithActions(trx, ctx, M1, { category: "info", createdAt: <NOW − 1 h>, actions: [{ type: "move", status: "ready" }] }))`: the fixture needs a `Transaction`, S5b B17; as in `config-settings.test.ts` "gate close (B3)"); `PATCH switches/move { value: false }` → 200 `expired: 1`; the action is `expired`. `PATCH mode { mode: "shadow", keepSwitches: false }` with a ready `flag` row → `expired` ≥ 1.
    5. `PATCH auto/info { auto: true }` on M1 (no labels) → 409 `{ error: "no_go", gate: { decision: "no-go: too few", kept: 0, … } }` (`noGoBodySchema` parses); the row is unchanged and no audit row exists. Again with `{ auto: true, force: true }` → 200, `categories[info].auto` true; the audit row has `forced: true` and actor = the owner. `{ auto: false }` → 200, `auto` false.
    6. Sync folder: insert an `offers` row for M1 (`ensureSyncFolders(db, ctx, M1, [{ key: "offers", path: "Oferty", role: "sort" }], NOW)`); `PATCH sync-folders/offers { enabled: false }` → 200, `changed` true, the view shows `offers` off; one `mailbox.sync_folder_changed` row with actor = the owner's id; `PATCH sync-folders/social { enabled: false }` (no row) → 404.
    7. A mailbox without a settings row (insert a mailbox and no `insertDefaultSettings`) → `GET` 404, `PATCH mode` 404.
    8. A paused and an `auth_error` mailbox (S10): `PATCH switches/flag { value: true }` → 200 on both.
    9. Two PATCHes at once on M1 (`Promise.all` of `switches/flag { value: true }` and `switches/mark_read { value: true }`) → both 200; the final `GET` has both switches on (the row lock orders them).
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`; a hand check: `bun run dev` in the worktree with the web keys (`TELEGRAM_BOT_TOKEN=` empty on the command line), then `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/settings/00000000-0000-4000-8000-000000000000` → 401; stop it with Ctrl-C.
  - Done when: the tests pass; `grep -nE "selectFrom|sql\W" apps/server/src/modules/config/routes.ts` finds nothing (no SQL in the route file); the relative imports of `config/routes.ts` and `config/view.ts` are only `./…` files of `config` and `../../platform/…` (check with `grep -n "from \"\.\./" apps/server/src/modules/config/routes.ts apps/server/src/modules/config/view.ts`).
  - Out of scope: the rules routes (stage 6); the page (stage 8).
