# F087 stage 03 — Write path and CLI

Part of [`../plan.md`](../plan.md). Read its D4, D9, D11–D14 and "Rules for every stage" first. Needs stages 1 and 2 (`isFeatureKey`, `featuresOff`, `upsertOrgFeature`, `getOrgFeature`, `featureStates`, `configureFeatures`).

Two steps. About 300 changed lines.

- [ ] **3.1 `setOrgFeature` with its audit row**
  - Goal: one service function changes a flag of one organization, with the audit row in the same transaction; the CLI now and the console later call it (ADR 0027 point 4).
  - Files:
    - change `apps/server/src/modules/audit/repo.ts` (`auditEvents`);
    - change `apps/server/src/modules/tenancy/service.ts`;
    - change `apps/server/src/modules/tenancy/index.ts` (exports);
    - add `apps/server/test/integration/tenancy-flag-write.test.ts`.
  - Interfaces:

    ```ts
    // audit/repo.ts, next to orgPlanChanged
    orgFlagChanged: "org.flag_changed", // data: flag, enabled

    // tenancy/service.ts
    export interface SetOrgFeatureInput {
      flag: string; // checked here: the CLI passes what the operator typed
      enabled: boolean;
      actor: string; // "cli", or the user id of a later console
      now: Date;
    }
    export type SetOrgFeatureResult =
      | { kind: "changed"; flag: FeatureKey; before: boolean | null; enabled: boolean } // before null = there was no row
      | { kind: "unchanged"; flag: FeatureKey; enabled: boolean }
      | { kind: "not_found" }
      | { kind: "unknown_flag" };
    // D11: unknown key → unknown_flag before any query. One transaction (or the caller's): lockOrganization
    // (not_found without it), getOrgFeature, unchanged when the row has the same value, else upsertOrgFeature
    // (set_by = actor, set_at = now) and recordAudit(orgFlagChanged, { flag, enabled }, actor, at: now).
    // Log: `organization ${ctx.orgId} flag ${flag} ${enabled ? "on" : "off"} by ${actor}`.
    export async function setOrgFeature(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      input: SetOrgFeatureInput
    ): Promise<SetOrgFeatureResult>;
    ```

    Shape: copy the transaction pattern of `setOrgPlan` (`db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run)`).

  - Decisions: D4, D11, D12, D13.
  - Test (`tenancy-flag-write.test.ts`; `NOW = new Date("2026-11-20T10:00:00Z")`; `MISSING = { orgId: "00000000-0000-4000-8000-000000000000" }`; audit rows read with `selectFrom("audit_log").where("org_id", "=", …).where("event", "=", "org.flag_changed")`):
    1. No row, `stats_page` on → `{ kind: "changed", flag: "stats_page", before: null, enabled: true }`; the row has `enabled` true, `set_by` `"cli"`, `set_at` `NOW`; one audit row with `actor` `"cli"`, `data` `{ flag: "stats_page", enabled: true }`, `created_at` `NOW`.
    2. No row, `sent_sync` off → `changed`, `before: null`, `enabled: false`; a row with `enabled` false exists (D11); one audit row `{ flag: "sent_sync", enabled: false }`.
    3. Row on, on again (`now` = `NOW + 1 min`) → `{ kind: "unchanged", flag: "stats_page", enabled: true }`; `set_at` is still `NOW`; still one audit row.
    4. Row on, then off → `changed`, `before: true`, `enabled: false`; two audit rows.
    5. `flag: "stats_pag"` and `flag: "toString"` → `{ kind: "unknown_flag" }`; no row, no audit row.
    6. `MISSING` → `{ kind: "not_found" }`; no audit row with that `org_id`.
    7. Tenant: on for org A → org B has no `org_features` row and no `org.flag_changed` row.
    8. Two at once (committed rows, not `withRollback`): an organization from `createOrganizationWithOwner(db, …)`; `Promise.all` of two `setOrgFeature(db, { orgId }, { flag: "stats_page", enabled: true, actor: "cli", now: NOW })` → the kinds, sorted, are `["changed", "unchanged"]`; exactly one audit row. `afterAll`/`finally` deletes the organization and its user.
  - Check: `bun test apps/server/test/integration/tenancy-flag-write.test.ts`; `bun run typecheck`.
  - Done when: tests 1–8 pass.
  - Out of scope: a "clear" that deletes a row (D12); any web route (stage 5).

- [ ] **3.2 `bun run org:flag`**
  - Goal: the operator lists the flags of one organization and turns one on or off from the command line; the output holds ids, keys and codes only.
  - Files:
    - add `apps/server/src/scripts/org-flag-args.ts` and `org-flag-args.test.ts`;
    - add `apps/server/src/scripts/org-flag.ts`;
    - change `package.json` (one script line after `org:create`: `"org:flag": "bun apps/server/src/scripts/org-flag.ts",`);
    - change `deploy/README.md` § "Customers (S6a)" (three command lines and one bullet, text below);
    - add `apps/server/test/integration/org-flag-cli.test.ts`.
  - Interfaces:

    ```ts
    // scripts/org-flag-args.ts — structure only; the key is checked by setOrgFeature (unknown_flag)
    export const usage = "usage: bun run org:flag --org-id <uuid> [--flag <key> --on|--off]";
    export type OrgFlagArgs =
      | { mode: "list"; orgId: string }
      | { mode: "set"; orgId: string; flag: string; enabled: boolean };
    // null on: a missing or bad uuid, --on with --off, --flag without --on/--off, --on/--off without --flag,
    // an empty --flag, a positional, an unknown option (parseArgs strict, as org-plan-args.ts).
    export function parseOrgFlagArgs(argv: string[]): OrgFlagArgs | null;
    ```

    `org-flag.ts`, the shape of `org-plan.ts` (`createLog("org-flag")`, `main()` returns the exit code, `finally` destroys the DB):
    1. `parseOrgFlagArgs`; null → `log.error(usage)`, exit 1.
    2. `loadConfig()`; `configureFeatures({ off: featuresOff(config) })`; `createDb`; `assertAppRole(db)`.
    3. List mode: `getOrganization(db, ctx)` undefined → `log.error("organization not found")`, exit 1. Else one `log.info` line per `featureStates(db, ctx)` entry: `org <orgId>: <flag> on|off (<source>)`. Exit 0.
    4. Set mode: `setOrgFeature(db, { orgId }, { flag, enabled, actor: "cli", now: new Date() })`:
       - `changed` → `org <orgId>: flag <flag> <before> → <after>` with `unset` for `before: null`, else `on`/`off`; exit 0;
       - `unchanged` → `org <orgId>: flag <flag> already <on|off>, no change`; exit 0;
       - `unknown_flag` → `log.error(`unknown flag; known flags: ${featureKeys.join(", ")}`)`; exit 1;
       - `not_found` → `log.error("organization not found")`; exit 1.
       - For `changed` and `unchanged`, when `featuresOff(config)` holds the flag, add one more `log.info` line: `(FEATURES_OFF holds <flag>: it reads off everywhere)`.
    5. A throw → `log.error(`failed: ${describeError(error)}`)`, exit 1.

    `deploy/README.md`, in the code block after the `org:plan` lines:

    ```sh
    $C run --rm server bun run org:flag --org-id <org id>
    $C run --rm server bun run org:flag --org-id <org id> --flag <key> --on
    $C run --rm server bun run org:flag --org-id <org id> --flag <key> --off
    ```

    and a bullet after the `org:plan` bullet:

    > - `org:flag` lists the feature flags of an organization (each `on` or `off`, with the source: `env`, `row` or `default`) or turns one flag on or off for it, with an audit row `org.flag_changed`. The keys and their defaults are in `packages/core/src/features.ts`. An `--off` is kept when the default later changes. `FEATURES_OFF=<key>,<key>` in the server `.env` turns flags off for every organization at the next restart, without a DB write (the kill switch); an unknown key stops the start.

  - Decisions: D9, D14.
  - Test:
    - `org-flag-args.test.ts` (`orgId = "0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11"`):
      1. `["--org-id", orgId]` → `{ mode: "list", orgId }`.
      2. `["--org-id", orgId, "--flag", "stats_page", "--on"]` → `{ mode: "set", orgId, flag: "stats_page", enabled: true }`; with `--off` → `enabled: false`.
      3. null for: `[]`; `["--org-id", "nope"]`; `--on` and `--off` together; `--flag stats_page` alone; `--on` without `--flag`; `--flag ""` with `--on`; a positional `extra`; `--unknown x`.
    - `org-flag-cli.test.ts` (spawn the script as `org-cli.test.ts` does, `cwd` = repo root, `env: { ...process.env }` unless the case sets more; committed organizations from `createOrganizationWithOwner(db, …)` with the name `Secret Org <uuid>`, deleted in `afterEach`; every case asserts that stdout and stderr do not contain the organization name):
      1. List on a new organization → exit 0; stdout has `stats_page off (default)`, `approvals_page off (default)`, `sent_sync off (default)`.
      2. and 3. run in one `test` on one organization (the `afterEach` delete would remove the row between two tests): `--flag stats_page --on` → exit 0; stdout has `flag stats_page unset → on`; the row is `enabled` true with `set_by` `"cli"`; one `org.flag_changed` row. Then the same command again → exit 0; stdout has `already on, no change`; still one audit row.
      3. `--flag nope --on` → exit 1; stderr has `unknown flag; known flags: stats_page`; no row.
      4. `--flag stats_page` alone → exit 1; stderr has `usage: bun run org:flag`.
      5. `--org-id 00000000-0000-4000-8000-000000000000` (list mode, and set mode) → exit 1; stderr has `organization not found`.
      6. With `env: { ...process.env, FEATURES_OFF: "stats_page" }`: `--flag stats_page --on` → exit 0, the row is written, stdout has `FEATURES_OFF holds stats_page`; then list → stdout has `stats_page off (env)`.
  - Check: `bun test apps/server/src/scripts/org-flag-args.test.ts`; `bun test apps/server/test/integration/org-flag-cli.test.ts`; `bun run lint`.
  - Done when: all cases pass; `bun run org:flag` with no argument prints the usage and exits 1.
  - Out of scope: a `--clear` option (D12); `org:status` changes; the dev-DB run (owner step U2).

## Done when

- Steps 3.1 and 3.2 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 03 (`/tmp/f087-s03`) prints `PROOF_OK`.
