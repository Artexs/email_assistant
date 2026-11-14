# F099 stage 11 — Operator page writes

Part of [`../plan.md`](../plan.md). Read its D20, D21, D29, "Rules for every stage" and `docs/code-patterns.md` § Web app first. Needs stages 09 and 10 (the two POST routes and their schemas, the page and `OrgDetail`).

Two steps. About 250 changed lines. No server change.

- [ ] **11.1 Request helpers and error texts**
  - Goal: the two writes and their error answers have one tested mapping.
  - Files: add `apps/web/src/lib/operator-api.ts` and `apps/web/src/lib/operator-api.test.ts`; change `apps/web/src/i18n/en.ts` (`op_*` keys); D29 for `pl.ts`.
  - Interfaces:

    ```ts
    // lib/operator-api.ts — through `api` of lib/api.ts (it sends the JSON body; the browser sends the origin)
    export function changePlan(orgId: string, body: OperatorPlanBody): Promise<OperatorPlanResult>;
    //   api(`/api/operator/orgs/${orgId}/plan`, operatorPlanResultSchema, { method: "POST", body })
    export function changeFlag(orgId: string, body: OperatorFlagBody): Promise<OperatorFlagResult>;
    //   api(`/api/operator/orgs/${orgId}/flags`, operatorFlagResultSchema, { method: "POST", body })
    export function writeErrorKey(error: unknown): TextKey;
    //   ApiError with code: trial_days_needed → "op_err_trial_days_needed"; trial_days_without_trial → "op_err_trial_days_without_trial";
    //   nothing_to_change → "op_err_nothing_to_change"; trial_days_range → "op_err_trial_days_range";
    //   max_mailboxes_range → "op_err_max_mailboxes_range"; unknown_flag → "op_err_unknown_flag"; not_found → "op_not_found";
    //   validation → "op_err_validation"; org_suspended, bad_origin, anything else → "error_generic"
    export function planChangeText(result: OperatorPlanResult): string;
    //   unchanged → t("op_plan_unchanged"); changed → t("op_plan_changed", { plan }) plus, when > 0,
    //   t("op_plan_cancelled", { count: cancelledMessages }) and t("op_plan_expired", { count: expiredSends })
    ```

    Read `lib/api.ts` for the field of `ApiError` that holds the server's `error` code; use it, do not parse the message.
  - Decisions: D20.
  - Test (`operator-api.test.ts`; the `createApi` fake of `lib/api.test.ts`):
    1. `changePlan("<uuid>", { plan: "suspended" })` sends `POST /api/operator/orgs/<uuid>/plan` with body `{"plan":"suspended"}` and parses the result.
    2. `changeFlag` sends `POST /api/operator/orgs/<uuid>/flags` with `{"flag":"stats_page","enabled":true}`.
    3. `writeErrorKey` maps each code above to its key; an `Error("x")` → `"error_generic"`.
    4. `planChangeText` for `unchanged`, for `changed` with `cancelledMessages: 2`, and for `changed` with zeros (no count part).
    5. Every key that the helpers return exists in `en`.
  - Check: `bun test apps/web/src/lib/operator-api.test.ts apps/web/src/i18n`.
  - Done when: tests 1–5 pass.
  - Out of scope: components (step 11.2).

- [ ] **11.2 Plan dialog and flag switches in `OrgDetail`**
  - Goal: the operator suspends, resumes, starts a trial, sets max mailboxes and switches a flag from the detail card, with a confirm step for the plan.
  - Files: add `apps/web/src/components/operator/PlanDialog.tsx`; change `apps/web/src/components/operator/OrgDetail.tsx` and `apps/web/src/islands/OperatorPage.tsx` (reload the list and the detail after a write).
  - Interfaces:
    - `PlanDialog` (shadcn `dialog`, `select`, `input`, `button`): plan select (`trial`, `active`, `suspended`), trial days (shown only for `trial`, 1–365), max mailboxes (0–100, prefilled). The confirm text names the organization by its short id and the target plan; for `suspended`: `t("op_plan_suspend_warning")` ("Queued messages of this organization are cancelled. Its members can read but not change anything."). Submit calls `changePlan` with only the fields that differ from the current state; an empty change shows `op_err_nothing_to_change` without a request.
    - Flags: one `switch` per flag row of the detail; a change calls `changeFlag(orgId, { flag, enabled })`; the switch is disabled while the request runs; a row with `source: "env"` shows a badge `t("op_flag_killed")` and its switch is disabled (the env kill list wins; a row write would change nothing visible).
    - Results: `toast.success(planChangeText(result))` / `toast.success(t("op_flag_changed", { flag, state }))`; errors: `toast.error(t(writeErrorKey(error)))`.
  - Decisions: D20 (no flag clear), D21.
  - Test: the helpers of step 11.1 carry the logic; no component test.
  - Check: `bun run typecheck`; `bun run lint`; `bun run web:build`.
  - Done when: `bun run web:build` passes; no literal text in the new components.
  - Out of scope: SSO provider setup (E7-T7); member or mailbox writes.

## Done when

- Steps 11.1 and 11.2 are done and committed by explicit paths.
- The web-stage Proof command of `plan.md` for stage 11 (`/tmp/f099-s11`, with `bun run web:build`) prints `PROOF_OK`.
