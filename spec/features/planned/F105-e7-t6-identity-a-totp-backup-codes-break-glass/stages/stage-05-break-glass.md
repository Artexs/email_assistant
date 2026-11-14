# F105 stage 05 — Break-glass owner [risky]

Part of [`../plan.md`](../plan.md). Read its P1, P4, D11, D12, D23, D27 and "Rules for every stage" first. Lane A. Needs stage 03 (it edits the same `web.ts` and auth files; the `memberships.break_glass` column is from stage 01).

`[risky]`: authentication rule and tenant data. A review job checks it before the land; the reviewer tries to mark an assistant, a user without TOTP, two owners of one organization, and to turn TOTP off as the break-glass owner.

Three steps. About 300 changed lines.

- [ ] **05.1 Repository and service**
  - Goal: the tenancy module sets, clears and reads the break-glass owner of an organization, with one audit row per change, in one transaction.
  - Files: change `apps/server/src/modules/tenancy/repo.ts`, `service.ts`, `index.ts`; change `apps/server/src/modules/audit/repo.ts` (`auditEvents`); add `apps/server/test/integration/break-glass.test.ts`.
  - Interfaces:

    ```ts
    // audit/repo.ts auditEvents
    orgBreakGlassSet: "org.break_glass_set", // data: user_id
    orgBreakGlassCleared: "org.break_glass_cleared", // data: user_id, reason ("cli" | "replaced" | "two_factor_reset")

    // tenancy/repo.ts
    // MembershipWithUser gets `break_glass: boolean`; getMembership and listMemberships select memberships.break_glass.
    // UserAuthProfile gets `twoFactorEnabled: boolean` (users.two_factor_enabled); getUserAuthProfile selects it.
    export async function getBreakGlassUserId(db: Db | Transaction<DB>, ctx: TenantContext): Promise<string | null>;
    export async function setBreakGlassFlag(trx: Transaction<DB>, ctx: TenantContext, userId: string, on: boolean): Promise<boolean>; // true = a row changed
    // No TenantContext (the user gives the rows; listed in docs/code-patterns.md by stage 13):
    export async function isBreakGlassOwner(db: Db | Transaction<DB>, userId: string): Promise<boolean>; // any membership of the user with break_glass

    // tenancy/service.ts
    export type SetBreakGlassResult =
      | { kind: "set"; replaced: string | null } // replaced = the user id that lost the mark, or null
      | { kind: "unchanged" }
      | { kind: "not_found" } // no such organization
      | { kind: "not_owner" } // no membership, or the role is assistant
      | { kind: "no_two_factor" }; // users.two_factor_enabled is false
    export async function setBreakGlassOwner(
      db: Db, ctx: TenantContext, input: { userId: string; actor: string; now: Date }
    ): Promise<SetBreakGlassResult>;
    export type ClearBreakGlassResult = { kind: "cleared"; userId: string } | { kind: "none" } | { kind: "not_found" };
    export async function clearBreakGlassOwner(
      db: Db | Transaction<DB>, ctx: TenantContext, input: { actor: string; now: Date; reason: "cli" | "two_factor_reset" }
    ): Promise<ClearBreakGlassResult>;
    ```

    `setBreakGlassOwner`, in one transaction: `lockOrganization` (none → `not_found`); `getMembership` (none or `role !== "owner"` → `not_owner`); `getUserAuthProfile(trx, userId).twoFactorEnabled` false → `no_two_factor`; the current holder (`getBreakGlassUserId`) equals the user → `unchanged`; else clear the current holder (if any) with `setBreakGlassFlag(…, false)` and an `org.break_glass_cleared` row (`{ user_id: <old>, reason: "replaced" }`), then `setBreakGlassFlag(…, userId, true)` and an `org.break_glass_set` row (`{ user_id }`). Rows: actor = `input.actor`, `at: input.now`. The clear runs before the set, so the partial unique index never sees two marks.
    `clearBreakGlassOwner`: the same lock; no holder → `none`; else clear it and write `org.break_glass_cleared` (`{ user_id, reason }`). It accepts a transaction (stage 06 calls it inside its own).
  - Decisions: D11, D23.
  - Test (`break-glass.test.ts`; committed rows from `webOrg(db)` of `web-helpers.ts`, cleaned in `afterAll`; TOTP on through `UPDATE users SET two_factor_enabled = true`; `NOW = 2026-11-20T10:00:00Z`):
    1. The owner with TOTP → `set` (`replaced: null`); the membership has `break_glass = true`; one `org.break_glass_set` row with `data = { user_id: <owner> }`, actor `cli`.
    2. The same call again → `unchanged`, no new row.
    3. The assistant (TOTP on) → `not_owner`; a user who is no member → `not_owner`; an unknown organization id → `not_found`.
    4. A second owner of the organization (add one with `insertUser` + `insertMembership`, role `owner`) without TOTP → `no_two_factor`; with TOTP → `set` with `replaced` = the first owner; one `org.break_glass_cleared` (`reason: "replaced"`) and one `org.break_glass_set`; only the second owner is marked.
    5. `clearBreakGlassOwner` (`reason: "cli"`) → `cleared` with the user id and one row; again → `none`.
    6. Tenant filter: the organization B of `webOrg` is never changed by calls for A (its owner keeps `break_glass = false` and B gets no audit row); `getBreakGlassUserId` for B is null.
    7. `isBreakGlassOwner` is true only for the marked user; false for the assistant and for an unknown id.
    8. `getUserAuthProfile` returns `twoFactorEnabled` true and false as set; `getMembership` returns `break_glass`.
  - Check: `bun test apps/server/test/integration/break-glass.test.ts apps/server/test/integration/tenancy*.test.ts`; `bun run typecheck`.
  - Done when: tests 1–8 pass.
  - Out of scope: the CLI (05.3); the reset (stage 06).

- [ ] **05.2 The break-glass owner cannot turn TOTP off**
  - Goal: `/two-factor/disable` refuses the break-glass owner before anything changes.
  - Files: change `apps/server/src/platform/auth.ts` (`AuthDeps`, `hooks.before`); change `apps/server/src/web.ts` (pass `keepsTwoFactor`); change `apps/server/test/integration/web-two-factor.test.ts`.
  - Interfaces:

    ```ts
    // AuthDeps
    // True = the user may not turn TOTP off (the break-glass owner, plan D12). Absent = every user may.
    keepsTwoFactor?: (userId: string) => Promise<boolean>;

    // hooks.before, a new branch (after the existing ones):
    if (ctx.path === "/two-factor/disable" && deps.keepsTwoFactor) {
      const session = await getSessionFromCtx(ctx);
      if (session && (await deps.keepsTwoFactor(session.user.id))) {
        throw APIError.from("FORBIDDEN", {
          code: "BREAK_GLASS_NEEDS_TWO_FACTOR",
          message: "The break-glass owner keeps two-factor sign-in.",
        });
      }
    }
    // web.ts createAuth({ …, keepsTwoFactor: (userId) => isBreakGlassOwner(db, userId) })
    ```

    An error of `keepsTwoFactor` is not caught: the request fails (500) and nothing changes (fail closed).
  - Decisions: D12.
  - Test (`web-two-factor.test.ts`, the handle gets `keepsTwoFactor: (userId) => isBreakGlassOwner(db, userId)`):
    9. An enrolled owner marked break-glass (`setBreakGlassOwner`) → `POST /two-factor/disable { password }` → 403 `BREAK_GLASS_NEEDS_TWO_FACTOR`; `two_factor_enabled` stays true, the row stays, no `web.two_factor_disabled` row.
    10. After `clearBreakGlassOwner`, the same call → 200 and TOTP is off.
    11. A handle without `keepsTwoFactor` lets a marked user turn TOTP off (the CLIs and old tests keep working).
  - Check: `bun test apps/server/test/integration/web-two-factor.test.ts`; `bun run typecheck`.
  - Done when: tests 9–11 pass.
  - Out of scope: the panel text for this refusal (stage 10).

- [ ] **05.3 CLI `org:break-glass`**
  - Goal: the operator lists, sets and clears the break-glass owner of an organization.
  - Files: add `apps/server/src/scripts/org-break-glass.ts`, `apps/server/src/scripts/org-break-glass-args.ts`, `apps/server/src/scripts/org-break-glass-args.test.ts`; change the root `package.json` (`"org:break-glass": "bun apps/server/src/scripts/org-break-glass.ts"`, next to `org:flag`).
  - Interfaces:

    ```ts
    // org-break-glass-args.ts (pattern of org-flag-args.ts)
    export const usage = "usage: bun run org:break-glass --org-id <uuid> [--user-id <uuid> | --clear]";
    export type OrgBreakGlassArgs =
      | { mode: "list"; orgId: string }
      | { mode: "set"; orgId: string; userId: string }
      | { mode: "clear"; orgId: string };
    export function parseOrgBreakGlassArgs(argv: string[]): OrgBreakGlassArgs | null; // null on any bad argument; --user-id with --clear → null
    ```

    `org-break-glass.ts` follows `org-flag.ts` (`loadConfig`, `createDb`, `assertAppRole`, `db.destroy` in `finally`, exit code), with these differences: output lines go to `process.stdout.write` (ids and words only, never an address or a name); errors are event lines (`log.error("org_break_glass_failed", { ...errorFields(error) })`; a bad argument prints `usage` to stderr with `process.stderr.write` and exits 1).
    - list: `getOrganization` (none → stderr `organization not found`, exit 1); for each owner of `listMemberships`: `owner <user_id>: two-factor on|off, break-glass yes|no` (TOTP from `getUserAuthProfile`).
    - set: `setBreakGlassOwner(db, ctx, { userId, actor: "cli", now: new Date() })` → `set`: `org <org_id>: break-glass owner <user_id>` plus ` (was <old>)` when replaced; `unchanged`: `org <org_id>: <user_id> is already the break-glass owner`; `not_found`, `not_owner`, `no_two_factor` → stderr `organization not found` / `user is not an owner of this organization` / `user has no two-factor sign-in: they turn it on in Settings → Account first`, exit 1.
    - clear: `clearBreakGlassOwner(db, ctx, { actor: "cli", now: new Date(), reason: "cli" })` → `org <org_id>: break-glass owner <user_id> cleared` or `org <org_id>: no break-glass owner`; `not_found` → exit 1.
  - Decisions: D11.
  - Test (`org-break-glass-args.test.ts`):
    12. `--org-id <uuid>` → list; `--org-id <uuid> --user-id <uuid>` → set; `--org-id <uuid> --clear` → clear.
    13. Missing or bad `--org-id`, a bad `--user-id`, `--user-id` with `--clear`, an unknown option, a positional argument → null.
  - Check: `bun test apps/server/src/scripts/org-break-glass-args.test.ts`; `bun run lint`.
  - Done when: tests 12–13 pass and `bun run org:break-glass` without arguments prints the usage and exits 1.
  - Out of scope: a panel or console page for the choice (questions.md Q1).

## Done when

- Steps 05.1–05.3 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 05 (`/tmp/f105-s05`) prints `PROOF_OK`.
