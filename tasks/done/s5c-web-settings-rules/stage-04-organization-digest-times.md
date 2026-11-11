# s5c-web-settings-rules — Stage 4

Part of [`../s5c-web-settings-rules.md`](../s5c-web-settings-rules.md). Read that file's "Done when", "Owns", S1–S11, "Facts checked", B1–B16, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 4 — Organization service and routes, digest times route, the timezone characterisation tests [risky]

Two steps. The timezone moves every schedule of the organization (digests, quiet hours, the reminder run); the signature goes into mail to third parties.

- [x] **4.1 `updateOrganizationSettings` and the characterisation tests (B9, fact 3)**
  - Goal: one service changes the timezone and the signature with their audit rows; tests pin what a timezone change does to the next digest.
  - Files: change `apps/server/src/modules/tenancy/repo.ts`, `tenancy/service.ts`, `tenancy/index.ts`, `packages/core/src/digest/schedule.test.ts`; create `apps/server/test/integration/tenancy-organization.test.ts`.
  - Interfaces:

    ```ts
    // tenancy/repo.ts
    export async function lockOrganization(
      trx: Transaction<DB>,
      ctx: TenantContext
    ): Promise<OrganizationRow | undefined>; // .forNoKeyUpdate(): FOR UPDATE would block the FK checks of child rows
    export async function updateOrganization(
      trx: Transaction<DB>,
      ctx: TenantContext,
      patch: { timezone?: string; styleText?: string | null }
    ): Promise<OrganizationRow | undefined>; // RETURNING *

    // tenancy/service.ts
    export function isSupportedTimeZone(timezone: string): boolean; // Intl.supportedValuesOf("timeZone").includes(timezone)
    export type UpdateOrganizationResult =
      | { kind: "updated"; organization: OrganizationRow }
      | { kind: "bad_timezone" }
      | { kind: "not_found" };
    export async function updateOrganizationSettings(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      patch: { timezone?: string; styleText?: string | null },
      input: { actor: string; now: Date }
    ): Promise<UpdateOrganizationResult>;
    ```

  - Decisions:
    - `tenancy/service.ts` imports `recordAudit` and `auditEvents` from `../audit` (a new edge `tenancy → audit`). `audit` is a leaf module (it imports only the platform), and `mail`, `config` and `channels` import it already, so no cycle forms.
    - `updateOrganizationSettings`: the patch was parsed by `organizationPatchSchema` (the route) or is built by a caller; the service does not parse `styleText` again but refuses a timezone that is not supported first, before the transaction (`bad_timezone`, nothing written). One transaction: `lockOrganization` (none → `not_found`); `timezone` given and different → the update field and the audit row `org.timezone_changed` (`data: { from, to }`, actor, `at: now`); `styleText` key present (also `null`) and different from the stored `style_text` → the update field and `org.style_changed` (`data: { set: styleText !== null }`); nothing changed → `updated` with the locked row and no write; else `updateOrganization` and `updated` with the new row. Log at `info` per changed field: `organization <id> timezone changed by <actor>` and `organization <id> signature changed by <actor>` (no zone name needed, no text).
    - `createOrganizationWithOwner` uses `isSupportedTimeZone` in its refine (same behaviour).
    - Export from `tenancy/index.ts`: `updateOrganizationSettings`, `isSupportedTimeZone`, `type UpdateOrganizationResult`.
  - Test:
    1. (`tenancy-organization.test.ts`, `withRollback`, `createOrgWithMailbox` for two organizations, `NOW = 2026-11-11T12:00:00Z`) `{ timezone: "America/New_York" }` → `updated`; the row has the zone; one `org.timezone_changed` row `{ from: "Europe/Warsaw", to: "America/New_York" }` with the actor and `created_at` NOW (the fixture creates the organization with `Europe/Warsaw`).
    2. The same zone again → `updated`, no new audit row.
    3. `{ timezone: "Mars/Base" }` → `bad_timezone`; `{ timezone: "Europe/Warsaw " }` → `bad_timezone`; nothing changed.
    4. `{ styleText: "Anna Nowak\nCEO" }` → the row has the text; one `org.style_changed` row with `data` exactly `{ set: true }` (`JSON.stringify(data)` does not contain `Anna`); `{ styleText: null }` → `style_text` null and a row `{ set: false }`; `null` again → no row.
    5. Both fields in one call → two audit rows, one transaction (both or none: a timezone of `"Mars/Base"` with a style text writes nothing).
    6. Tenant: `updateOrganizationSettings(B ctx, …)` changes only B; `lockOrganization` and `updateOrganization` with a context of an id that does not exist → `undefined`, `not_found`.
    7. (`packages/core/src/digest/schedule.test.ts`, unit, the six cases of fact 3 with times `08:00, 13:00` unless named) West move: `dueDigestSlot({ now: 2026-11-11T13:30Z, timeZone: "America/New_York", times, afterKey: "2026-11-11T08:00" })` → `null`; at `18:00Z` → key `2026-11-11T13:00`. East move: `Asia/Tokyo`, `afterKey` `2026-11-11T13:00`, at `14:00Z` → `null`; at `23:00Z` → key `2026-11-12T08:00`. East move at once: `Asia/Tokyo`, `afterKey` `2026-11-11T08:00`, at `08:00Z` → key `2026-11-11T13:00`. A new time: `Europe/Warsaw`, times `08:00, 11:00`, `afterKey` `2026-11-11T08:00`, at `11:00Z` → key `2026-11-11T11:00`. A large west move: `America/Los_Angeles`, `afterKey` `2026-11-11T13:00`, at `16:00Z` → `null`, at `21:00Z` → `null`, at `2026-11-12T16:00Z` → key `2026-11-12T08:00` (two digests skipped). Each test has a one-line comment: "characterisation (S5c fact 3): the U8 note on the Settings page depends on this".
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: the routes (4.2).

- [x] **4.2 `GET` and `PATCH /api/organization`, `PATCH /api/me/digest-times` (B9, B10)**
  - Goal: the Settings page reads and changes the organization and the member's own digest times.
  - Files: change `apps/server/src/modules/tenancy/routes.ts`; create `apps/server/test/integration/web-organization.test.ts`.
  - Interfaces:

    ```ts
    // tenancy/routes.ts (inside tenancyRoutes; TenancyRouteDeps unchanged)
    app.get("/organization", …);                        // member → OrganizationSettings
    app.patch("/organization", requireOwner, …);        // → OrganizationView
    app.patch("/me/digest-times", …);                   // member, the session user → { times }
    ```

  - Decisions:
    - A view helper in `tenancy/service.ts` (not in the route): `organizationView(row): OrganizationView` = `{ id, name, timezone, styleText: row.style_text, retentionDays: row.data_retention_days }`.
    - `GET /organization`: `getOrganization` (none → 404) → `{ ...organizationView(row), timezones: Intl.supportedValuesOf("timeZone") }` (B10). The list is the same function the PATCH checks.
    - `PATCH /organization`: `parseBody(c, organizationPatchSchema)` → `updateOrganizationSettings(db, ctx, patch, { actor: userId, now })`: `bad_timezone` → 400 `{ error: "validation", details: [{ path: "timezone", code: "custom", message: "timezone_invalid" }] }`; `not_found` → 404; `updated` → 200 `organizationView`.
    - `PATCH /me/digest-times`: `parseBody(c, digestTimesBodySchema)` → `parseDigestTimes(times)` (sorted, unique) → `setDigestTimes(db, ctx, userId, sorted)` → `false` → 404 → 200 `{ times: sorted }`. No audit row (the CLI writes none; B9). An assistant may call it (S2).
    - The route file stays thin (D8): parse, one service call, map.
  - Test (`web-organization.test.ts`, `webTestApp` + `webOrg` + `as()` of `web-helpers.ts`, routers `tenancyRoutes(<the deps of web-me.test.ts>)`):
    1. Matrix: no cookie → 401 on the three routes; the assistant on `PATCH /organization` → 403 `owner_only`; the assistant on `GET /organization` → 200 and on `PATCH /me/digest-times` → 200; `PATCH /organization` with `{}` → 400 `validation` with `details[0].message` `empty_patch`; with `{ styleText: 5 }` → 400; without `Origin` → 403 `bad_origin`.
    2. `GET` → `organizationSettingsSchema` parses; `timezones` contains `Europe/Warsaw` (the organization's zone) and `Europe/London` (CI runs Bun 1.3.14, whose list was not probed: assert no count and no `UTC`; cold review finding 20); `retentionDays` 30.
    3. `PATCH { timezone: "Europe/London" }` → 200 with the zone; `GET /me` shows it; `PATCH { timezone: "Mars/Base" }` → 400 with `details[0]` `{ path: "timezone", message: "timezone_invalid" }`.
    4. `PATCH { styleText: "  Anna\r\nCEO  " }` → 200 `styleText: "Anna\nCEO"`; `{ styleText: "" }` → `styleText: null`; 501 characters → 400 `style_too_long`.
    5. Tenant: the other organization's owner changes only their own organization (the first stays `Europe/Warsaw`).
    6. `PATCH /me/digest-times { times: ["13:00", "08:00"] }` as the assistant → 200 `{ times: ["08:00", "13:00"] }`; `GET /me` of the assistant has them and the owner's `digestTimes` is unchanged; `{ times: [] }` → `[]`; `{ times: ["08:00", "08:00"] }` → 400 `times_duplicate`; seven times → 400.
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; `grep -nE "selectFrom|sql\W" apps/server/src/modules/tenancy/routes.ts` finds nothing (no SQL in the route file).
  - Out of scope: the web cards (stage 9).
