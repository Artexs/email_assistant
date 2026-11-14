# F105 stage 06 — Operator reset [risky]

Part of [`../plan.md`](../plan.md). Read its D4, D13, D22, D25 and "Rules for every stage" first. Lane A. Needs stage 05 (`clearBreakGlassOwner`, `getUserAuthProfile.twoFactorEnabled`, `auditEvents.orgBreakGlassCleared`).

`[risky]`: authentication data and sessions. A review job checks it before the land; the reviewer checks that one transaction holds every write, that a repeat run is safe, and that the CLI prints no address.

Two steps. About 280 changed lines.

- [ ] **06.1 `resetTwoFactorRows` and `resetTwoFactor`**
  - Goal: one transaction turns a user's second factor off, ends the user's sessions and trusted devices, clears the user's break-glass marks, and writes the audit rows.
  - Files: add `apps/server/src/platform/auth-two-factor-reset.ts`; change `apps/server/src/modules/tenancy/repo.ts`, `service.ts`, `index.ts`; change `apps/server/src/modules/audit/repo.ts` (`auditEvents`); add `apps/server/test/integration/two-factor-reset.test.ts`.
  - Interfaces:

    ```ts
    // platform/auth-two-factor-reset.ts — Kysely only, no better-auth import (plan D4).
    // The second place where our SQL touches the Better Auth tables (docs/code-patterns.md § Data access, stage 13 adds it).
    export async function resetTwoFactorRows(
      trx: Transaction<DB>,
      userId: string
    ): Promise<{ hadTwoFactor: boolean; sessionsEnded: number }>;
    // 1. DELETE FROM auth_two_factors WHERE user_id = $1                 → hadTwoFactor = a row was deleted, or
    // 2. UPDATE users SET two_factor_enabled = false WHERE id = $1 AND two_factor_enabled → … or this row changed
    // 3. DELETE FROM auth_verifications WHERE value = $1                  (trusted devices, open challenges, open reset links)
    // 4. DELETE FROM auth_sessions WHERE user_id = $1                     → sessionsEnded = the deleted count

    // audit/repo.ts auditEvents
    webTwoFactorReset: "web.two_factor_reset", // data: via, sessions_ended

    // tenancy/repo.ts — no TenantContext (the user gives the rows; stage 13 lists it in docs/code-patterns.md)
    export async function listBreakGlassOrgIdsOfUser(db: Db | Transaction<DB>, userId: string): Promise<string[]>;

    // tenancy/service.ts
    export type ResetTwoFactorResult =
      | { kind: "reset"; hadTwoFactor: boolean; sessionsEnded: number; breakGlassCleared: string[] } // org ids
      | { kind: "not_member" };
    export async function resetTwoFactor(
      db: Db | Transaction<DB>, ctx: TenantContext, input: { userId: string; actor: string; now: Date }
    ): Promise<ResetTwoFactorResult>; // runs in the caller's transaction when given one (as setOrgFeature does)
    ```

    `resetTwoFactor`, in one transaction: `getMembership(trx, ctx, userId)` none → `not_member` (nothing changes); `resetTwoFactorRows(trx, userId)`; for each org id of `listBreakGlassOrgIdsOfUser(trx, userId)`: `clearBreakGlassOwner(trx, { orgId }, { actor, now, reason: "two_factor_reset" })`; `recordAudit(trx, ctx, { event: auditEvents.webTwoFactorReset, actor, data: { via: "cli", sessions_ended: sessionsEnded }, at: now })`. A repeat run writes one more `web.two_factor_reset` row with `sessions_ended: 0` and changes nothing else. It writes the row also when `hadTwoFactor` is false (the operator ran it; the log shows it).
  - Decisions: D13, D22.
  - Test (`two-factor-reset.test.ts`; a real `createAuth` handle as in `web-two-factor.test.ts`, with the stage 02 helpers copied or imported from a shared helper file if you add one — `apps/server/test/integration/two-factor-helpers.ts` is allowed; committed rows; capture the console):
    1. An enrolled owner with two sessions, a trusted device and the break-glass mark → `reset` with `hadTwoFactor: true`, `sessionsEnded: 2`, `breakGlassCleared: [orgId]`; after it: no `auth_two_factors` row, `two_factor_enabled = false`, no `auth_sessions` row, no `auth_verifications` row with `value` = the user id, `break_glass = false`; one `web.two_factor_reset` (`{ via: "cli", sessions_ended: 2 }`, actor `cli`) and one `org.break_glass_cleared` (`reason: "two_factor_reset"`).
    2. After test 1, `/sign-in/email` with the password → 200 with a session (no `twoFactorRedirect`); the old session cookies → `get-session` null.
    3. A repeat run → `reset` with `hadTwoFactor: false`, `sessionsEnded: 0` (the new session of test 2 counts if it exists: end it first or expect 1), `breakGlassCleared: []`; one more `web.two_factor_reset`.
    4. Mixed state (D22 a): `two_factor_enabled = true` and the row `verified = false` → after the reset both are gone. Mixed state (D22 b): flag false and a verified row → after the reset no row; then `POST /two-factor/enable` works again (200).
    5. A user who is not a member of the organization → `not_member`; their row and sessions stay.
    6. One transaction: `await expect(db.transaction().execute(async (trx) => { await resetTwoFactor(trx, ctx, input); throw new Error("rollback probe"); })).rejects.toThrow("rollback probe")`; after it the row, the flag, the sessions, the trust row, the break-glass mark and the audit count are as before the call.
    7. No captured line holds an address, a secret or a code.
  - Check: `bun test apps/server/test/integration/two-factor-reset.test.ts apps/server/test/integration/break-glass.test.ts`; `bun run typecheck`.
  - Done when: tests 1–7 pass.
  - Out of scope: the CLI (06.2); a console button (not in this ticket).

- [ ] **06.2 CLI `web:two-factor-reset`**
  - Goal: the operator resets a member's second factor from the host.
  - Files: add `apps/server/src/scripts/web-two-factor-reset.ts`, `apps/server/src/scripts/web-two-factor-reset-args.ts`, `apps/server/src/scripts/web-two-factor-reset-args.test.ts`, `apps/server/test/integration/web-two-factor-reset-cli.test.ts`; change the root `package.json` (`"web:two-factor-reset": "bun apps/server/src/scripts/web-two-factor-reset.ts"`, next to `web:invite`).
  - Interfaces:

    ```ts
    // web-two-factor-reset-args.ts
    export const usage = "usage: bun run web:two-factor-reset --org-id <uuid> --user-id <uuid>";
    export function parseTwoFactorResetArgs(argv: string[]): { orgId: string; userId: string } | null; // both required, both uuids, strict
    ```

    The script follows `org-flag.ts` for config, DB and exit codes; output with `process.stdout.write`, errors as event lines (`log.error("two_factor_reset_failed", { ...errorFields(error) })`), a bad argument prints `usage` to stderr and exits 1. Results:
    - `reset` → `user <user_id>: two-factor sign-in reset; <n> sessions ended` plus, when `breakGlassCleared` is not empty, a line `user <user_id>: break-glass cleared in <org ids, comma-separated>`; when `hadTwoFactor` is false the first line ends with ` (it was off)`. Exit 0.
    - `not_member` → stderr `user is not a member of this organization`, exit 1.
    - No `getOrganization` check is needed: a missing organization has no member.
  - Decisions: D13.
  - Test:
    8. Args: both present → the object; a missing or bad id, an unknown option, a positional → null.
    9. CLI (pattern of `org-flag-cli.test.ts`: `Bun.spawn` of the script, committed rows cleaned in `afterEach`): an enrolled member → exit 0, stdout holds `two-factor sign-in reset` and the user id, and not the address or the organization name; the DB state as test 1; a user of another organization → exit 1 with `user is not a member`.
  - Check: `bun test apps/server/src/scripts/web-two-factor-reset-args.test.ts apps/server/test/integration/web-two-factor-reset-cli.test.ts`; `bun run lint`.
  - Done when: tests 8–9 pass.
  - Out of scope: the docs line for the operator (stage 13).

## Done when

- Steps 06.1 and 06.2 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 06 (`/tmp/f105-s06`) prints `PROOF_OK`.
