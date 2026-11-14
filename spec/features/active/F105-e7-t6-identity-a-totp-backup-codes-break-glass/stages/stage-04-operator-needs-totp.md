# F105 stage 04 — Operators need TOTP [risky]

Part of [`../plan.md`](../plan.md). Read its D10, "Facts checked" F9, F12 and "Rules for every stage" first. Lane B. Needs stage 02 (the plugin adds `user.twoFactorEnabled` to the session read). May run next to stage 03.

`[risky]`: authentication of the only cross-organization web path. A review job checks it before the land; the reviewer tries every form of the `/operator` page path and every `/api/operator/*` route with an operator who has no TOTP.

Two steps. About 180 changed lines.

- [ ] **04.1 The session carries the TOTP state**
  - Goal: every request knows whether the session user has TOTP on, without a second DB read.
  - Files: change `apps/server/src/platform/http.ts` (`WebSession`), `apps/server/src/web.ts` (`getSession`), and every place that builds a `WebSession` (Fact F12): `apps/server/test/integration/web-helpers.ts`, `apps/server/test/integration/web-http.test.ts`, `apps/server/src/platform/http.test.ts`; `grep -rn "sessionId:" apps/server/src apps/server/test` finds them (add any new one the grep shows).
  - Interfaces:

    ```ts
    // platform/http.ts
    export interface WebSession {
      userId: string;
      sessionId: string;
      twoFactorEnabled: boolean; // the session user has TOTP on (users.two_factor_enabled, read by Better Auth)
      setCookie?: string[];
    }

    // web.ts getSession
    twoFactorEnabled: response.response.user.twoFactorEnabled === true,

    // test/integration/web-helpers.ts
    export interface WebTestOptions {
      // …
      twoFactorOff?: ReadonlySet<string>; // user ids whose fake session has TOTP off; every other user has it on
    }
    // getSession: { userId, sessionId: cookieOf(headers), twoFactorEnabled: opts.twoFactorOff?.has(userId) !== true }
    ```

    The other fakes set `twoFactorEnabled: true`, so their operator cases keep their meaning.
  - Decisions: D10.
  - Test: the existing suites pass with the new field (`bun run typecheck` finds every missing one).
  - Check: `bun run typecheck`; `bun test apps/server/src/platform/http.test.ts apps/server/test/integration/web-http.test.ts apps/server/test/integration/web-me.test.ts`.
  - Done when: the typecheck passes and the listed suites pass.
  - Out of scope: the guards (step 04.2).

- [ ] **04.2 The operator guards ask for TOTP**
  - Goal: an operator without TOTP cannot use the console; everyone else sees the same answers as before.
  - Files: change `apps/server/src/platform/http.ts` (`requireOperator`, the page guard in `createApp`); change `apps/server/src/platform/http.test.ts` (`describe("requireOperator")`); change `apps/server/test/integration/web-operator-page.test.ts`, `web-operator.test.ts` and `web-operator-writes.test.ts` (new cases).
  - Interfaces:

    ```ts
    // requireOperator (plan D10): the 404 check stays first, so a non-operator never learns about the TOTP rule.
    if (c.get("web").operatorUserIds?.has(userId) !== true) { /* unchanged: warn operator_route_refused, 404 */ }
    if (!c.get("session").twoFactorEnabled) {
      log.warn("operator_two_factor_required", { user_id: userId });
      return c.json({ error: "two_factor_required" }, 403);
    }

    // the page guard in createApp, after the existing non-operator branch:
    if (OPERATOR_PAGE.test(path) && !session.twoFactorEnabled) {
      log.warn("operator_two_factor_required", { user_id: session.userId });
      c.header("Cache-Control", "private, no-store");
      return c.redirect("/settings?two_factor=required", 302);
    }
    ```

    Keep the order of the existing branches; the TOTP branch runs only for an operator. At ff61cbc `requireOperator` ends with `await withoutTenantScope(() => next());` (F092 stage 03, plan F13): the TOTP branch goes between the 404 branch and that call, and the call stays as it is. Add no other `withoutTenantScope` or `withTenantScope` call (`tenant-scope-sites.test.ts`). The comment above `requireOperator` names ADR 0027 and ADR 0026 point 1.
  - Decisions: D10.
  - Test:
    1. `http.test.ts` `requireOperator`: an operator with `twoFactorEnabled: true` → 200; an operator with `false` → 403 `{ error: "two_factor_required" }` and one captured line holding `operator_two_factor_required user_id=u-op`; a non-operator with `false` → 404 `not_found` (not 403).
    2. `web-operator-page.test.ts`: an operator (the assistant of `webOrg`, as the file sets it) listed in `twoFactorOff` → every form of `FORMS` answers 302 with `location: /settings?two_factor=required` and `cache-control: private, no-store`; the owner (no operator) still gets the 404 page in every form; the same operator without `twoFactorOff` still gets the page (200).
    3. `web-operator.test.ts` (it builds the real `apiRouters` with `operatorUserIds`; add `twoFactorOff` to its `operatorApp` helper): `GET /api/operator/flags` and `GET /api/operator/orgs` for the operator in `twoFactorOff` → 403 `two_factor_required`; for the owner → 404.
    3a. `web-operator-writes.test.ts` (F099 stage 09; its `flagUrl`, `post`, `auditOfB` helpers and its valid body): a write is refused too. `POST /api/operator/orgs/<org B>/flags` by the operator in `twoFactorOff` → 403 `two_factor_required`, and organization B gets no new `audit_log` row.
    4. `web-me.test.ts` (it builds the real tenancy routes): `GET /api/me` of an operator in `twoFactorOff` still answers `operator: true` (the nav keeps its link; the page sends the user to the settings).
  - Check: `bun test apps/server/src/platform apps/server/test/integration/web-operator-page.test.ts apps/server/test/integration/web-operator.test.ts apps/server/test/integration/web-operator-writes.test.ts apps/server/test/integration/web-operator-orgs.test.ts apps/server/test/integration/web-operator-detail.test.ts apps/server/test/integration/web-tenant-scope.test.ts apps/server/test/integration/web-me.test.ts`; `bun run lint`.
  - Done when: tests 1–4 and 3a pass and the old cases pass (the F099 operator suites and the F092 route walk keep their meaning: their fake sessions have TOTP on).
  - Out of scope: the settings page text for `?two_factor=required` (stage 11); operator CLIs (no change).

## Done when

- Steps 04.1 and 04.2 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 04 (`/tmp/f105-s04`) prints `PROOF_OK`.
