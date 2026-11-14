# F099 stage 13 — Security log card

Part of [`../plan.md`](../plan.md). Read its D26, D27, D29, "Rules for every stage" and `docs/code-patterns.md` § Web app first. Needs stage 12 (`GET /api/security-log`, `securityLogSchema`, `securityEventKinds`) and stage 06 (`me.features`).

Two steps. About 180 changed lines. No server change.

- [ ] **13.1 Text helpers with tests**
  - Goal: each security event kind and actor has one tested text.
  - Files: add `apps/web/src/lib/security-log-text.ts` and `apps/web/src/lib/security-log-text.test.ts`; change `apps/web/src/i18n/en.ts`; D29 for `pl.ts`.
  - Interfaces:

    ```ts
    // lib/security-log-text.ts — pure
    export function securityKindText(kind: string): string;
    //   a known kind → t(`sec_kind_${kind}`); any other string → t("sec_kind_other")
    export function securityActorText(actor: SecurityLogEntry["actor"]): string;
    //   member → actor.name; former_member → t("sec_actor_former"); operator → t("sec_actor_operator"); system → t("sec_actor_system")
    export function securityLineText(entry: SecurityLogEntry, timeZone: string): string;
    //   t("sec_line", { when: <date and time in timeZone, Intl medium date + short time>, what: securityKindText(kind), who: securityActorText(actor) })
    //   plus, for lockedUntil !== null, " " + t("sec_locked_until", { time: <short time in timeZone> })
    ```

    `en.ts` keys (exact English):
    - `sec_title`: "Security log"
    - `sec_help`: "Sign-ins, lockouts, password changes and ended sessions of this organization in the last 90 days."
    - `sec_empty`: "No security events in the last 90 days."
    - `sec_kind_sign_in`: "Signed in"; `sec_kind_locked`: "Sign-in locked after failed tries"; `sec_kind_password_set`: "Password set"; `sec_kind_password_changed`: "Password changed"; `sec_kind_sessions_ended`: "Signed out everywhere"; `sec_kind_other_sessions_ended`: "Other devices signed out"; `sec_kind_other`: "Other security event"
    - `sec_actor_former`: "a former member"; `sec_actor_operator`: "the operator"; `sec_actor_system`: "the system"
    - `sec_line`: "{when} · {what} · {who}"
    - `sec_locked_until`: "(locked until {time})"
  - Decisions: D27.
  - Test (`security-log-text.test.ts`; `timeZone = "Europe/Warsaw"`):
    1. Every kind of `securityEventKinds` has a `sec_kind_*` key in `en` (a loop: a new kind fails this test until its text exists).
    2. `securityKindText("future_kind")` = `t("sec_kind_other")`.
    3. Each actor kind gives its text; a member gives the name as is.
    4. `securityLineText` of a `locked` entry at `2026-11-20T08:00:00Z` with `lockedUntil` `2026-11-20T08:15:00Z` holds `09:15` (Warsaw time) and the `locked` text and the actor name.
  - Check: `bun test apps/web/src/lib/security-log-text.test.ts apps/web/src/i18n`.
  - Done when: tests 1–4 pass.
  - Out of scope: the component (step 13.2).

- [ ] **13.2 The section in the Account card**
  - Goal: an owner of an organization with `security_log` on sees the log under the session list.
  - Files: add `apps/web/src/components/settings/SecurityLog.tsx`; change `apps/web/src/components/settings/AccountCard.tsx`.
  - Interfaces:
    - `AccountCard` reads `useMe()` (from `components/shell/MeProvider`); it renders `<SecurityLog timeZone={me.organization.timezone} />` below the "Sign out everywhere" block only when `me.role === "owner"` and `me.features.includes("security_log")`.
    - `SecurityLog` follows `SessionsList`: `useResource(() => api("/api/security-log", securityLogSchema))`; a load error shows `load_error_text` and a Retry button; loading shows a `Skeleton`; an empty list shows `sec_empty`; else a `<ul>` of `securityLineText` lines, `data-section="security-log"`, title `sec_title`, help text `sec_help`.
  - Decisions: D26.
  - Test: the helpers of step 13.1 carry the logic; no component test.
  - Check: `bun run typecheck`; `bun run lint`; `bun run web:build`.
  - Done when: `bun run web:build` passes; an assistant or a flag-off owner never triggers the request (the component is not rendered).
  - Out of scope: paging; a filter; 2FA, export, delete and DSR texts (their tickets add a kind and a key; test 1 makes them do it).

## Done when

- Steps 13.1 and 13.2 are done and committed by explicit paths.
- The web-stage Proof command of `plan.md` for stage 13 (`/tmp/f099-s13`, with `bun run web:build`) prints `PROOF_OK`.
