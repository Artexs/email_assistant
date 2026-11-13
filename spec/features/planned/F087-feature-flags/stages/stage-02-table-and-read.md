# F087 stage 02 — Table and read path [risky]

Part of [`../plan.md`](../plan.md). Read its D2, D3, D7, D9, D10, D21, D24, "Facts checked" and "Rules for every stage" first. Needs stage 1 (`featureFlags`, `FeatureKey`, `isFeatureKey`, `resolveFeature`, `featuresOff`, `featuresOffFromEnv`).

`[risky]`: migration and tenant filter. This is the only migration of F087: it must not run next to another migration or a `bun.lock` change (F088 stage 1, F092 stage 1). A review job checks it before the land.

One `[risky]` step. About 280 changed lines (the generated `schema.ts` lines not counted).

- [ ] **2.1 `org_features`, its repository functions and `isFeatureOn`**
  - Goal: code can ask whether a flag is on for one organization; the answer follows `FEATURES_OFF` → row → default; rows belong to one organization and go with it.
  - Files:
    - add `db/migrations/<YYYYMMDD>100001_org_features.sql` — `<YYYYMMDD>` is the UTC build day; the name must sort after the newest file in `db/migrations` (check with `ls db/migrations | tail -1`; if a file of that day exists, raise `100001` to the next free number);
    - change `apps/server/src/platform/db/schema.ts` only through `bun run db:types`;
    - change `apps/server/src/modules/tenancy/repo.ts` (three functions);
    - add `apps/server/src/modules/tenancy/features.ts`;
    - change `apps/server/src/modules/tenancy/index.ts` (exports);
    - change `apps/server/src/main.ts` (configure + one log line);
    - change `apps/server/test/preload.ts`;
    - add `apps/server/test/integration/tenancy-features.test.ts`.
  - Migration (exact):

    ```sql
    -- migrate:up
    -- Per-organization feature flags (ADR 0027). No row = the registry default (packages/core/src/features.ts).
    -- The key list is not in SQL: the registry is the source, the repository refuses an unknown key.
    CREATE TABLE org_features (
      org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      flag text NOT NULL CHECK (flag ~ '^[a-z][a-z0-9_]{0,39}$'),
      enabled boolean NOT NULL,
      set_by text NOT NULL CHECK (length(set_by) > 0),
      set_at timestamptz NOT NULL,
      PRIMARY KEY (org_id, flag)
    );

    -- migrate:down
    DROP TABLE org_features;
    ```

    Apply it to the job DB with `bun run db:migrate` (the job `.env` points `MIGRATOR_DATABASE_URL` at the job DB; never at the shared dev DB), then `bun run db:types`. The `schema.ts` diff must add only the `OrgFeatures` interface and its `org_features` entry in `DB`; any other diff → stop and ask.

  - Interfaces:

    ```ts
    // tenancy/repo.ts — each takes a TenantContext and filters by org_id
    export async function getOrgFeature(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      flag: FeatureKey
    ): Promise<boolean | undefined>;
    // ordered by flag
    export async function listOrgFeatureRows(
      db: Db | Transaction<DB>,
      ctx: TenantContext
    ): Promise<{ flag: string; enabled: boolean; set_by: string; set_at: Date }[]>;
    // INSERT … ON CONFLICT (org_id, flag) DO UPDATE SET enabled, set_by, set_at.
    // Throws Error(`unknown feature flag: ${flag}`) before any query when !isFeatureKey(flag) (D2: the cast-proof guard).
    export async function upsertOrgFeature(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      input: { flag: FeatureKey; enabled: boolean; setBy: string; setAt: Date }
    ): Promise<void>;

    // tenancy/features.ts — the process kill list (D9). Module state: `let off: ReadonlySet<FeatureKey> | null = null`.
    /** Sets the kill list explicitly (main.ts, org:flag, tests). */
    export function configureFeatures(input: { off: readonly FeatureKey[] }): void;
    /** The kill list. Without an earlier configureFeatures call: featuresOffFromEnv(process.env), parsed once and kept. */
    export function featureSettings(): { off: ReadonlySet<FeatureKey> };
    // D3, D10, D24: no query when the flag is killed; else one getOrgFeature query; resolveFeature decides.
    export async function isFeatureOn(db: Db | Transaction<DB>, ctx: TenantContext, flag: FeatureKey): Promise<boolean>;
    // Every registry key in registry order, with the resolveFeature result; one listOrgFeatureRows query;
    // rows whose key is not in the registry are skipped.
    export async function featureStates(
      db: Db | Transaction<DB>,
      ctx: TenantContext
    ): Promise<{ flag: FeatureKey; enabled: boolean; source: FeatureSource }[]>;
    ```

    `tenancy/index.ts` exports `getOrgFeature`, `listOrgFeatureRows`, `upsertOrgFeature` from `./repo` and `configureFeatures`, `featureSettings`, `featureStates`, `isFeatureOn` from `./features`. No function takes a settings argument (D24).

    `main.ts`, right after `configureMailHosts(...)`:

    ```ts
    const featuresOffList = featuresOff(config);
    configureFeatures({ off: featuresOffList });
    log.info(`features off by FEATURES_OFF: ${featuresOffList.length === 0 ? "none" : featuresOffList.join(", ")}`);
    ```

    `apps/server/test/preload.ts` adds (keep the existing lines):

    ```ts
    import { configureFeatures } from "../src/modules/tenancy/features";
    // The CLI tests spawn scripts with this process env: no kill list from a developer .env (Bun keeps "" and does not load .env over it).
    process.env.FEATURES_OFF = "";
    configureFeatures({ off: [] });
    ```

  - Decisions: D2, D3, D7, D9, D10, D21, D24.
  - The "new table" checklist (review N10): if `docs/code-patterns.md` (written by F086) asks a new table with `org_id` to join an organization-delete test or a DSR map, check whether that test or map exists. Today neither exists (S6c builds the `information_schema` delete test). Meet the checklist with test 2 (cascade) and test 3 (tenant filter), and name the missing parts as a question in your final message. Build no new delete test or DSR map.
  - Test (`apps/server/test/integration/tenancy-features.test.ts`; `withRollback` and `createOrgWithMailbox` from `./helpers` and `./fixtures`; for statements that must fail, copy the savepoint helper of `auth-public-schema.test.ts:22-27` into this file with a `code` parameter (`expectViolation(trx, code, run)`; it is local there and hardcodes `23514`); `AT = new Date("2026-11-20T10:00:00Z")`; `noDb` = a `Proxy` whose every property read throws `Error("no query expected")`, cast to `Db`):
    1. Schema: a raw insert with `flag: "Bad-Key"` fails with code `23514`; with `set_by: ""` fails with `23514`; a second raw insert of the same `(org_id, flag)` fails with `23505`.
    2. Cascade: org A from `createOrgWithMailbox`; `upsertOrgFeature` for `stats_page` and `sent_sync`; `trx.deleteFrom("organizations").where("id", "=", A)`; then `org_features` has 0 rows with `org_id = A`.
    3. Tenant filter: orgs A and B; A `stats_page` = true. `getOrgFeature(B, "stats_page")` is `undefined`; `listOrgFeatureRows(B)` is `[]`; `upsertOrgFeature(B, stats_page, false)` leaves A's row `true` and A's `listOrgFeatureRows` length 1.
    4. Order, no kill list: no row → `isFeatureOn` false (default); row true → true; row false → false.
    5. Kill list: `configureFeatures({ off: ["stats_page"] })`; `isFeatureOn(noDb, A, "stats_page")` → `false` and no throw (no query made). Then `approvals_page` with a real row `true` → `true` (only the listed key is killed). `afterEach` calls `configureFeatures({ off: [] })`.
    6. Env path without `configureFeatures` (D9): spawn `bun --eval` (cwd = the repo root; `bunfig.toml` preloads only for `bun test`) with `env: { ...process.env, FEATURES_OFF: "sent_sync" }` and a script that imports `featureSettings` from the absolute path of `apps/server/src/modules/tenancy/features.ts` and prints `[...featureSettings().off].join(",")` → exit 0, stdout `sent_sync`. With `FEATURES_OFF: "nope"` → exit code not 0 and stderr has `FEATURES_OFF`.
    7. `configureFeatures({ off: ["sent_sync"] })` → `featureSettings().off` has `sent_sync` only.
    8. `configureFeatures({ off: ["sent_sync"] })`, then `featureStates(trx, A)` with A rows `stats_page` = true and a raw row `old_flag` = true → `[{ flag: "stats_page", enabled: true, source: "row" }, { flag: "approvals_page", enabled: false, source: "default" }, { flag: "sent_sync", enabled: false, source: "env" }]` (no `old_flag`).
    9. `upsertOrgFeature(trx, A, { flag: "nope" as FeatureKey, … })` rejects with `unknown feature flag: nope`; A has 0 rows after it.
    10. A second `upsertOrgFeature` of the same key changes `enabled`, `set_by` and `set_at` (`AT` then `AT + 1 min`), still one row.
  - Check: `bun run db:migrate && bun run db:types` (job DB); `bun test apps/server/test/integration/tenancy-features.test.ts`; `bun run typecheck`; `bun run lint`; then `bun run db:rollback && bun run db:migrate` once (the down step works; job DB only).
  - Done when: tests 1–10 pass; the down step drops the table; `main.ts` configures the flags after `loadConfig`; `schema.ts` holds only the generated addition.
  - Out of scope: the write service and its audit row (stage 3); the cross-organization read (stage 5); any caller that reads a flag in a job or route; `docs/` (stage 6; the one exception list entry of stage 5).

## Done when

- Step 2.1 is done and committed by explicit paths (the migration, `schema.ts`, the code and the test in one commit or in order).
- The Proof command of `plan.md` for stage 02 (`/tmp/f087-s02`) prints `PROOF_OK`.
- Owner step U1 (`bun run db:migrate` on the shared dev DB) is in the final message as the next owner step.
