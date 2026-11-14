# F105 stage 13 — Security log kinds

Part of [`../plan.md`](../plan.md). Read its D21, P5 and "Rules for every stage" first. Lane D. F099 stages 12 (c18c07a) and 13 (b6fa717) are on `master` (refresh 1): the registry `packages/core/src/security-log.ts`, the route `GET /api/security-log` (owner only, behind the flag `security_log`), `apps/server/src/modules/tenancy/security-log.ts` (`listSecurityLog`) and the web helper `apps/web/src/lib/security-log-text.ts`. At ff61cbc the registry has the shape below (6 kinds; `securityEvents` is `as const satisfies Record<string, SecurityEventKind>`; `@ea/core/web` re-exports `securityEventKinds` through `packages/core/src/web/security-log.ts`). Needs stage 07 of this ticket (every new audit event exists: stages 03, 05, 07). If the registry shape differs from this at your base, stop and report the difference. This stage meets the rule of `docs/code-patterns.md` § Data access: a new security-relevant audit event gets an entry in `securityEvents` and a `sec_kind_*` text.

Two steps. About 120 changed lines.

- [ ] **13.1 The eight kinds in the registry**
  - Goal: the owner security log shows the second-factor and break-glass events.
  - Files: change `packages/core/src/security-log.ts` and `packages/core/src/security-log.test.ts`; change `apps/server/test/integration/web-security-log.test.ts` (new cases).
  - Interfaces:

    ```ts
    // securityEventKinds: add after "other_sessions_ended" (and remove the comment's "E7-T6 adds the 2FA kinds" part)
    "two_factor_on", "two_factor_off", "two_factor_reset", "backup_codes_new", "backup_code_used",
    "two_factor_locked", "break_glass_set", "break_glass_cleared",

    // securityEvents: add
    "web.two_factor_enabled": "two_factor_on",
    "web.two_factor_disabled": "two_factor_off",
    "web.two_factor_reset": "two_factor_reset",
    "web.backup_codes_generated": "backup_codes_new",
    "web.backup_code_used": "backup_code_used",
    "web.two_factor_locked": "two_factor_locked",
    "org.break_glass_set": "break_glass_set",
    "org.break_glass_cleared": "break_glass_cleared",
    ```

  - Decisions: D21.
  - Test:
    1. `security-log.test.ts`: the existing "every kind is used once" case passes with 14 kinds; `securityKindOf("web.two_factor_locked")` = `"two_factor_locked"`; `securityKindOf("org.break_glass_set")` = `"break_glass_set"`.
    2. `apps/server/src/modules/audit/security-events.test.ts` (F099) passes unchanged: every key is a value of `auditEvents`.
    3. `web-security-log.test.ts` (the file's fixtures and `NOW`): a `web.two_factor_locked` row by the owner with `data: { via: "web", locked_until: "2026-11-20T08:15:00.000Z" }` → entry `kind: "two_factor_locked"`, actor member `Owner`, `lockedUntil: "2026-11-20T08:15:00.000Z"`; an `org.break_glass_set` row by `cli` → `kind: "break_glass_set"`, actor `{ kind: "operator" }`; a `web.two_factor_reset` row by `cli` → actor operator; the body holds no user id (the `data.user_id` of the break-glass rows never reaches the answer).
  - Check: `bun test packages/core/src/security-log.test.ts apps/server/src/modules/audit apps/server/test/integration/web-security-log.test.ts`.
  - Done when: tests 1–3 pass.
  - Out of scope: showing which member a break-glass row names (the F099 entry shape has no subject field).

- [ ] **13.2 Texts**
  - Goal: each new kind has its text in the Account card log.
  - Files: change `apps/web/src/i18n/en.ts` and `apps/web/src/i18n/pl.ts` (every key in both files: `pl.ts` is on `master` and its type requires each key, D20).
  - Keys (English | Polish):

    | Key | English | Polish |
    | --- | --- | --- |
    | `sec_kind_two_factor_on` | Two-factor sign-in turned on | Włączono logowanie dwuetapowe |
    | `sec_kind_two_factor_off` | Two-factor sign-in turned off | Wyłączono logowanie dwuetapowe |
    | `sec_kind_two_factor_reset` | Two-factor sign-in reset | Zresetowano logowanie dwuetapowe |
    | `sec_kind_backup_codes_new` | New backup codes made | Utworzono nowe kody zapasowe |
    | `sec_kind_backup_code_used` | Signed in with a backup code | Zalogowano kodem zapasowym |
    | `sec_kind_two_factor_locked` | Code step locked after wrong codes | Krok kodu zablokowany po błędnych kodach |
    | `sec_kind_break_glass_set` | Break-glass owner chosen | Wybrano właściciela awaryjnego |
    | `sec_kind_break_glass_cleared` | Break-glass owner removed | Usunięto właściciela awaryjnego |

    Change `sec_help` (F099 stage 13) to "Sign-ins, lockouts, password and two-factor changes, and ended sessions of this organization in the last 90 days." (Polish in `pl.ts`, which has the key: "Logowania, blokady, zmiany hasła i logowania dwuetapowego oraz zakończone sesje tej organizacji z ostatnich 90 dni.").
  - Decisions: D20, D21.
  - Test: 4. `apps/web/src/lib/security-log-text.test.ts` (F099 stage 13, test 1) passes: every kind has its `sec_kind_*` key.
  - Check: `bun test apps/web/src/lib apps/web/src/i18n`; `bun run typecheck`; `bun run web:build`. `bun run typecheck` fails until each key is in `pl.ts` too.
  - Done when: test 4 passes and the build passes.
  - Out of scope: the second-factor name in the `sign_in` line.

## Done when

- Steps 13.1 and 13.2 are done and committed by explicit paths.
- The web Proof command of `plan.md` for stage 13 (`/tmp/f105-s13`, with `bun run web:build`) prints `PROOF_OK`.
