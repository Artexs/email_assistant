# F102 stage 03 — Describe routes B

Part of [`../plan.md`](../plan.md). Read D6 and stages 01–02. Needs stage 02 landed.

Two steps, no behaviour change. At the end `NOT_DESCRIBED_YET` is empty, and the test refuses a non-empty list.

## Step 1 — Activity, stats, triage, actions, channels

- **Goal:** the routes of `activityRoutes`, `statsRoutes`, `triageRoutes`, `actionRoutes` and `channelRoutes` are in the OpenAPI file.
- **Files:** the route files of the modules `reports`, `triage`, `actions`, `channels`; `packages/core/src/web/*` only when an answer has no schema; the route test.
- **Decisions:** stage 02 Step 1 rules (same schema objects, error codes from the handler, `operationId`, tags = router name without `Routes`). `GET /activity` and `GET /stats` describe their query with `query:` (the schema the handler parses).
- **Test:**
  - T1: `NOT_DESCRIBED_YET` holds no key of these five routers.
  - T2: `GET /api/activity` has the query parameters `before` and `limit`.
  - T3: `POST /api/actions/{id}/reject-reason` lists the 404 and 409 codes `not_found`, `not_rejected`.
- **Done when:** T1–T3 pass; the existing integration tests of these routers pass unchanged.

## Step 2 — The rest, and the empty list

- **Goal:** no route is undescribed.
- **Files:** any router that landed after the plan base (for example the SSO or two-factor routes of F119 or F105); the route test.
- **Decisions:**
  - Describe every key still on the list, with the same rules. A route of another active ticket that lands during this stage: describe it too and name it in the final message.
  - Then delete `NOT_DESCRIBED_YET` and the `notDescribedYet` input of `routeGaps`, so a new route can only be described or hidden with a reason.
- **Test:**
  - T4: the route test has no `NOT_DESCRIBED_YET` name (this check must find nothing: `grep -c NOT_DESCRIBED_YET apps/server/src/openapi-routes.test.ts` prints `0`).
  - T5: T8 of stage 01 still passes: `undescribed` = `[]`.
  - T6: the number of paths in the file plus the hidden keys equals the number of route keys of `apiRouters` (name both numbers).
- **Done when:** T4–T6 pass.

## Out of scope

- ADR 0023 and the capability page (stage 19). Behaviour changes: a question.

## Done when (stage)

- Steps 1 and 2 hold. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s03`).
