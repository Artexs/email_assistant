# F105 stage 06 — The break-glass owner keeps TOTP [risky]

Part of [`../plan.md`](../plan.md). Read its P1, D12, D28 and "Rules for every stage" first. Lane A. Needs stage 05 (`isBreakGlassOwner`, `setBreakGlassOwner`, `clearBreakGlassOwner`). May run next to stage 07 (no shared file).

`[risky]`: authentication rule. A review job checks it before the land; the reviewer tries to turn TOTP off as the break-glass owner by every allowed path (`/two-factor/disable` with and without the password, with an old session).

One step. About 120 changed lines.

- [ ] **06.1 The break-glass owner cannot turn TOTP off**
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

    An error of `keepsTwoFactor` is not caught: the request fails (500) and nothing changes (fail closed). The hook runs inside `/api/auth/*`, which has no tenant scope (plan F13, D12), so `isBreakGlassOwner` sees every membership of the user.
  - Decisions: D12.
  - Test (`web-two-factor.test.ts`, the handle gets `keepsTwoFactor: (userId) => isBreakGlassOwner(db, userId)`):
    1. An enrolled owner marked break-glass (`setBreakGlassOwner`) → `POST /two-factor/disable { password }` → 403 `BREAK_GLASS_NEEDS_TWO_FACTOR`; `two_factor_enabled` stays true, the row stays, no `web.two_factor_disabled` row.
    2. After `clearBreakGlassOwner`, the same call → 200 and TOTP is off.
    3. A handle without `keepsTwoFactor` lets a marked user turn TOTP off (the CLIs and old tests keep working).
    4. Old session (Fact F7: `/two-factor/disable` needs a live session and the password, not a fresh one): set the session row's `created_at` to 2 days before now with SQL; for the marked owner `disable` still answers 403 `BREAK_GLASS_NEEDS_TWO_FACTOR`; after `clearBreakGlassOwner` it answers 200 (no `SESSION_NOT_FRESH`).
  - Check: `bun test apps/server/test/integration/web-two-factor.test.ts`; `bun run typecheck`.
  - Done when: tests 1–4 pass.
  - Out of scope: the panel text for this refusal (stage 11).

## Done when

- Step 06.1 is done and committed by explicit paths.
- The Proof command of `plan.md` for stage 06 (`/tmp/f105-s06`) prints `PROOF_OK`.
