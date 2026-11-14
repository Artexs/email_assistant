# F105 stage 08 — Status route

Part of [`../plan.md`](../plan.md). Read its D14, D25 and "Rules for every stage" first. Lane A. Needs stage 04 (`WebSession.twoFactorEnabled`, the `twoFactorOff` option of `webTestApp`) and stage 05 (`MembershipWithUser.break_glass`). May run next to stage 07.

Two steps. About 200 changed lines.

- [ ] **08.1 Schema and the backup-code count**
  - Goal: the web has one schema for the TOTP state, and the server can count the backup codes left without showing them.
  - Files: add `packages/core/src/web/two-factor.ts` and `packages/core/src/web/two-factor.test.ts`; change `packages/core/src/web/index.ts`; change `apps/server/src/platform/auth-two-factor.ts`; add a case to `apps/server/test/integration/web-two-factor.test.ts`.
  - Interfaces:

    ```ts
    // packages/core/src/web/two-factor.ts — `import { z } from "./zod";` as the other web schemas
    export const twoFactorRequirements = ["operator", "break_glass"] as const;
    export const twoFactorStatusSchema = z.strictObject({
      enabled: z.boolean(),
      backupCodesLeft: z.number().int().min(0).nullable(),
      requiredBy: z.array(z.enum(twoFactorRequirements)),
    });
    export type TwoFactorStatus = z.infer<typeof twoFactorStatusSchema>;
    export const FEW_BACKUP_CODES = 3; // the Account card warns at this count or fewer (plan D17)

    // apps/server/src/platform/auth-two-factor.ts
    import type { AuthHandle } from "./auth"; // type-only
    // The number of unused backup codes, never the codes. null when the read fails (also: no row).
    export async function backupCodesLeft(handle: AuthHandle, userId: string): Promise<number | null>;
    //   try { return (await handle.auth.api.viewBackupCodes({ body: { userId } })).backupCodes.length; }
    //   catch (error) { log.warn("two_factor_codes_unreadable", { user_id: userId, ...errorFields(error) }); return null; }
    ```

  - Decisions: D14, D25.
  - Test:
    1. `two-factor.test.ts`: the schema accepts `{ enabled: true, backupCodesLeft: 7, requiredBy: ["operator"] }` and `{ enabled: false, backupCodesLeft: null, requiredBy: [] }`; it refuses an extra key, `backupCodesLeft: -1`, `requiredBy: ["admin"]`.
    2. `web-two-factor.test.ts`: `backupCodesLeft(handle, id)` of an enrolled user = 10; after one backup-code sign-in = 9; for a user without TOTP = null and one captured `two_factor_codes_unreadable` line with the user id and no code.
  - Check: `bun test packages/core/src/web/two-factor.test.ts apps/server/test/integration/web-two-factor.test.ts`.
  - Done when: tests 1–2 pass.
  - Out of scope: the route (08.2).

- [ ] **08.2 `GET /api/me/two-factor`**
  - Goal: a member reads the TOTP state of the own account and why the role needs it.
  - Files: change `apps/server/src/modules/tenancy/routes.ts` (`TenancyRouteDeps`, the route); change `apps/server/src/web.ts` (`apiRouters` passes the dep); change every caller of `tenancyRoutes` and `apiRouters` (`grep -rln "tenancyRoutes(\|apiRouters(" apps/server`; at ff61cbc: `tenancyRoutes` in `log-context.test.ts`, `web-http.test.ts`, `web-locale.test.ts`, `web-me.test.ts`, `web-onboarding.test.ts`, `web-organization.test.ts`, `web-security-log.test.ts`, `web-sessions.test.ts`, `web-terms.test.ts`; `apiRouters` in `web-operator.test.ts`, `web-operator-detail.test.ts`, `web-operator-orgs.test.ts`, `web-operator-writes.test.ts`, `web-suspended.test.ts`, `web-tenant-scope.test.ts`); add `noBackupCodes` to `apps/server/test/integration/web-helpers.ts`; add `apps/server/test/integration/web-two-factor-status.test.ts`.
  - Interfaces:

    ```ts
    // tenancy/routes.ts
    export interface TenancyRouteDeps {
      // …
      backupCodesLeft: (userId: string) => Promise<number | null>; // web.ts: backupCodesLeft of the auth handle (plan D14)
    }
    app.get("/me/two-factor", async (c) => {
      const ctx = c.get("ctx");
      const { userId, twoFactorEnabled } = c.get("session");
      const member = await getMembership(deps.db, ctx, userId);
      const requiredBy: TwoFactorStatus["requiredBy"] = [];
      if (c.get("web").operatorUserIds?.has(userId) === true) requiredBy.push("operator");
      if (member?.break_glass === true) requiredBy.push("break_glass");
      const body: TwoFactorStatus = {
        enabled: twoFactorEnabled,
        backupCodesLeft: twoFactorEnabled ? await deps.backupCodesLeft(userId) : null,
        requiredBy,
      };
      return c.json(body);
    });

    // web.ts: apiRouters gets a sixth parameter `backupCodes: TenancyRouteDeps["backupCodesLeft"]`
    //   and passes it as `backupCodesLeft`; webDeps calls apiRouters(…, (userId) => backupCodesLeft(handle, userId)).
    // web-helpers.ts: export const noBackupCodes: TenancyRouteDeps["backupCodesLeft"] = async () => null;
    ```

  - Decisions: D14.
  - Test (`web-two-factor-status.test.ts`; `webOrg(db)`; `webTestApp` with the real `tenancyRoutes` and a `backupCodesLeft` stub that records its calls and returns 7):
    3. No session → 401.
    4. The owner with TOTP off (`twoFactorOff: new Set([ownerId])`) → 200 `{ enabled: false, backupCodesLeft: null, requiredBy: [] }`; the stub was not called.
    5. The owner with TOTP on → `{ enabled: true, backupCodesLeft: 7, requiredBy: [] }`; a stub that returns null → `backupCodesLeft: null`.
    6. The assistant in `operatorUserIds` with TOTP off → `requiredBy: ["operator"]`.
    7. The owner marked break-glass (`setBreakGlassOwner` with TOTP on in `users`) and in `operatorUserIds` → `requiredBy: ["operator", "break_glass"]`.
    8. The owner of organization B (not marked) → `requiredBy: []` while A's owner is marked (tenant filter).
    9. A suspended organization (`isOrgSuspended: async () => true`) → 200 (a read).
    10. `twoFactorStatusSchema.parse` passes on every answer; the body text holds no `@x.test` and no user id.
  - Check: `bun test apps/server/test/integration/web-two-factor-status.test.ts apps/server/test/integration/web-me.test.ts apps/server/test/integration/web-sessions.test.ts apps/server/test/integration/web-tenant-scope.test.ts`; `bun run typecheck`; `bun run lint`. The F092 route walk (`web-tenant-scope.test.ts`) finds the new route by itself and checks that it runs in the tenant scope.
  - Done when: tests 3–10 pass and every old caller compiles and passes.
  - Out of scope: the web section (stage 11).

## Done when

- Steps 08.1 and 08.2 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 08 (`/tmp/f105-s08`) prints `PROOF_OK`.
