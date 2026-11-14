# F099 stage 06 — Operator module and `/api/me` [risky]

Part of [`../plan.md`](../plan.md). Read its D13, D15, D21, D22, D23, D24, "Facts checked" (P1) and "Rules for every stage" first. Lane B, first stage. Needs F087 (landed: `requireOperator`, `operatorRoutes`, `featureStates`). Lane C (stages 12–13) waits for this stage.

`[risky]`: auth. A review job checks it before the land; the reviewer tries every path form of `/operator` and `/api/operator/*` as a non-operator.

Three steps. About 260 changed lines.

- [ ] **6.1 The `operator` module in its own layer**
  - Goal: the operator routes live in one module that may read every lower module.
  - Files:
    - `git mv apps/server/src/modules/tenancy/operator-routes.ts apps/server/src/modules/operator/routes.ts`, then edit its imports (`featureStatesOfAll` from `../tenancy`);
    - add `apps/server/src/modules/operator/index.ts` (`export { operatorRoutes, type OperatorRouteDeps } from "./routes";`);
    - change `apps/server/src/modules/tenancy/index.ts` (drop the `operatorRoutes` export);
    - change `apps/server/src/web.ts` (import `operatorRoutes` from `./modules/operator`);
    - change `apps/server/src/modules/layers.json` (a fifth layer `["operator"]` after `["reports", "channels", "testmail"]`);
    - change `docs/code-patterns.md` § Layers and borders (the table: a row `5 | operator` above row 4) and `.agents/limen/styleguide.md` § Shape (the layer list ends `… → reports, channels, testmail → operator → composition roots`);
    - run `bun run graph:modules`; commit `docs/diagrams/module-graph.{md,json}`;
    - change `apps/server/test/integration/web-operator.test.ts` only if an import path changes.
  - Interfaces: none new. `OperatorRouteDeps` stays `{ db: Db }` in this stage.
  - Decisions: D13.
  - Test: the existing `web-operator.test.ts` cases 1–13 pass unchanged; `apps/server/src/modules/layers.test.ts` passes (the graph is fresh; no cycle).
  - Check: `bun run lint`; `bun test apps/server/src/modules/layers.test.ts apps/server/src/modules/borders.test.ts apps/server/test/integration/web-operator.test.ts`.
  - Done when: `apps/server/src/modules/tenancy/operator-routes.ts` is gone; `git log --follow apps/server/src/modules/operator/routes.ts` shows the F087 history; the lint accepts the new layer.
  - Out of scope: new routes (stages 07–09).

- [ ] **6.2 The page guard and operator writes in a suspended organization**
  - Goal: a non-operator gets the normal 404 page for `/operator` in every path form; an operator's POST under `/api/operator` works while the operator's own organization is suspended.
  - Files:
    - change `apps/server/src/platform/http.ts` (`OPERATOR_PAGE`, the check in the static-page middleware, one `SUSPENDED_WRITE_ALLOW` entry);
    - add `apps/server/test/integration/web-operator-page.test.ts`;
    - change `apps/server/test/integration/web-suspended.test.ts` (one case).
  - Interfaces:

    ```ts
    // platform/http.ts
    // The operator console page (ADR 0027): non-operators get the 404 page, as for a path that does not exist. Probe P1 of
    // spec/features/…/F099-…/plan.md: c.req.path is decoded and normalized, so this covers every served form.
    export const OPERATOR_PAGE = /^\/operator(\/|$)/i;

    // In the middleware before serveStatic, after the session check and the "/" redirect:
    //   if (OPERATOR_PAGE.test(path) && web.operatorUserIds?.has(session.userId) !== true) {
    //     log.warn("operator_page_refused", { user_id: session.userId });
    //     c.header("Cache-Control", "private, no-store");
    //     return c.html(notFoundHtml, 404);
    //   }

    // SUSPENDED_WRITE_ALLOW: a new entry with a comment
    //   // The operator acts on other organizations; its own organization's plan does not matter (plan D21).
    //   { method: "POST", path: /^\/api\/operator\// },
    ```

  - Decisions: D21, D22, D24.
  - Test (`web-operator-page.test.ts`; a temp `dist` as in `web-http.test.ts` with `404.html` ("not found page"), `operator/index.html` ("operator page") and `settings/index.html`; `webTestApp` with `dist`, `operatorUserIds = new Set([org.assistantId])`, sessions `owner`, `assistant` (the operator), `other`; `org = await webOrg(db)`):
    1. The owner of A (not an operator) gets 404 with body `not found page` and `Cache-Control: private, no-store` for each of `/operator`, `/operator/`, `/operator/index.html`, `/%6Fperator`, `/%6fperator/`, `/OPERATOR`, `/./operator`, `/settings/../operator`, `/operator/index%2Ehtml`.
    2. The operator gets 200 `operator page` for `/operator`, `/operator/`, `/operator/index.html`.
    3. No session → `/operator` redirects 302 to `/login?next=%2Foperator` (the same as any page).
    4. The owner of A gets 200 for `/settings` (the guard does not leak).
    5. Logs: case 1 writes `operator_page_refused` lines with `user_id` = the owner's id and no `@x.test`.
    - `web-suspended.test.ts`: 6. With `isOrgSuspended` true for the operator's organization, `POST /api/operator/flags` (no such POST route yet) answers 404 `not_found`, not 403 `org_suspended`; a POST to another `/api` path still answers 403 `org_suspended`. Keep the file's existing "every write route" walk green (add the new allow entry to its expectations if it lists them).
  - Check: `bun test apps/server/test/integration/web-operator-page.test.ts apps/server/test/integration/web-suspended.test.ts apps/server/test/integration/web-http.test.ts apps/server/src/platform/http.test.ts`.
  - Done when: tests 1–6 pass.
  - Out of scope: the page itself (stage 10).

- [ ] **6.3 `/api/me` tells the web who is an operator and which flags are on**
  - Goal: the panel can show the operator nav item and gate a web feature on a flag, with no extra request.
  - Files:
    - change `packages/core/src/web/me.ts` (`operator`, `features`) and `packages/core/src/web/me.test.ts`;
    - change `apps/server/src/modules/tenancy/routes.ts` (the two fields in `GET /me`);
    - change `apps/server/test/integration/web-me.test.ts`;
    - change every test or web fixture that builds a whole `Me` object (`grep -rn "operatorContact:" apps packages --include=*.ts*`), so typecheck passes.
  - Interfaces:

    ```ts
    // core/web/me.ts, in meSchema
    operator: z.boolean(),
    features: z.array(z.string()), // the registry keys that are on for the organization (plan D23)

    // tenancy/routes.ts — no new dep: the same set that requireOperator reads (plan.md D23, review N12)
    // GET /me: operator: c.get("web").operatorUserIds?.has(userId) === true,
    //          features: (await featureStates(deps.db, ctx)).filter((state) => state.enabled).map((state) => state.flag)

    ```

  - Decisions: D23.
  - Test:
    7. `me.test.ts`: a `Me` without `operator` or without `features` is refused; `features: ["future_flag"]` is accepted.
    8. `web-me.test.ts`: the owner (not an operator) gets `operator: false`, `features: []`; with `upsertOrgFeature(db, ctx, { flag: "stats_page", enabled: true, … })` → `features: ["stats_page"]`; with `configureFeatures({ off: ["stats_page"] })` → `features: []` (reset in `afterEach`); with the owner in `operatorUserIds` of `webTestApp` → `operator: true`; without `operatorUserIds` → `operator: false`. The body has no field with the list of operator ids.
  - Check: `bun test packages/core/src/web apps/server/test/integration/web-me.test.ts`; `bun run typecheck` (the web uses `Me` through `@ea/core/web`); `bun run web:build`.
  - Done when: tests 7–8 pass; `bun run web:build` passes.
  - Out of scope: the nav item (stage 10), the security-log section (stage 13).

## Done when

- Steps 6.1–6.3 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 06 (`/tmp/f099-s06`) prints `PROOF_OK`.
