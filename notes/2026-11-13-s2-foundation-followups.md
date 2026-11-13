# Stage 2 foundation: follow-ups from reviews (2026-11-13)

- F087 stage 2 review, note 1: no organization-delete test and no DSR map exist yet. `org_features` (and `outbox.view`, F088 stage 03) must join both when E7-T3 or S6c builds them. `F087 plan.md:75` cites S6c, not E7-T3: check that the E7-T3 planner finds the table.
- F089 stage 03 review, note 1: no test sends a trusted valid-UUID `x-request-id` through `createApp` with `web !== null` and checks the echo. Add one small test in `web-http.test.ts`.
- F089 stage 01 review, note 1: a class instance passes as `LogFields` and skips the allow-list. Make a lint rule or the types refuse a second log argument that is not an object literal (F089 stage 04 follow-up or E8a).
