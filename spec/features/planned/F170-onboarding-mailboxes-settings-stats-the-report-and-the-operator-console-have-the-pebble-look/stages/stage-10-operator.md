# F170 stage 10 — The operator console: theme and dense tables

Needs F166 stage 03: the tokens and the `Table` sizes. Needs F166 stage 09: `AppShell` `lead`. May run next to 01–09.

Part of [`../plan.md`](../plan.md). Decisions: P8, P9, D5, D7.

Owns: `apps/web/src/islands/OperatorPage.tsx`, `components/operator/`, a new spec `apps/web/e2e/tests/operator.spec.ts` with its fixture file, the `op_*` keys (next to the other `op_*` keys).

## Step 1 — A spec that can open the page

- **Before you build:** the e2e server answers the 404 page for `/operator` (no operator user). Check that a Playwright `page.route("**/operator", …)` that fulfills with the file `apps/web/dist/operator/index.html` (the `web:build:dev` output that the e2e server serves) loads its `/_astro/` files from the real server and runs the island. Fallback, if it does not: give the e2e server a seeded operator with TOTP (the seed and `OPERATOR_USER_IDS` in the e2e env); that touches shared e2e files, so ask the coordinator first and stop.
- **Decisions:** the spec signs in as the main owner of the seed, routes the page as above, and answers `GET /api/operator/orgs`, `/api/operator/orgs/<id>`, and `/api/operator/notices?days=<1|7|30>` from a fixture file. Each fixture is parsed with its `@ea/core/web` schema (`operatorOrgListSchema`, `operatorOrgDetailSchema`, `operatorNoticesSchema`) at the start of the spec, so a schema change fails the spec, not the screen. Fixture data: three organizations (one `trial`, one `active`, one `suspended`; one with a mailbox in `auth_error` and one in `host_blocked`), one with an SSO block, five notices. Ids, codes, counts and dates only, as the API (no name, no address).
- **Test:** (1) the organization table shows 3 rows; a tap on the second row shows its detail; the notices list shows 5 rows; the a11y scan passes with `schemes: ["light", "dark"]` on the `desktop` project and light on `mobile` (ticket acceptance: both schemes). (2) The plan dialog opens from the detail and its a11y scan passes; Cancel sends no `POST` (a request counter saw 0 calls to `/plan`). (3) The spec saves four full-page pictures (phone and desktop × light and dark) under `UI_SHEET_DIR`'s folder `operator/` (D7: the page is not in the sheet).

## Step 2 — The look

- **Decisions (P8, PB-11):** tokens and primitives only; no layout change and no new pattern. The tables keep every column and stay dense: rows and in-table controls 36 px (`Button` `xs`, `SelectTrigger` `sm`), numbers in tabular figures, the selected row in `bg-muted` and keeps `data-state="selected"`. Today a row is chosen only by a mouse click on the row: the short id in the first cell becomes a `Button` `link` `xs` that selects the row, so a keyboard reaches it; the row click stays. On a phone the tables scroll inside their own box (no page-level sideways scroll at 320 px, DB-7). Cards around the three blocks are `Card`s with a title; the detail hint (`op_detail_hint`) is a `FactBox`. The SSO block, the plan dialog and the flag changes keep their texts and calls.
- **Page head:** `lead="op_lead"`: "Organizations, plans and notices." No action; "Reload" stays at the top of the content.
- **Edge cases:** a non-operator who reaches the shell keeps `op_not_found` and nothing else. Loading uses skeletons with `aria-busy`. A suspended operator organization still writes (the server rule; the panel shows no lock).
- **Test:** (4) render test: `OrgTable` with three rows renders three body rows; the row of the `selected` id has `data-state="selected"`; a click on the id button of row 2 calls `onSelect` once with its `orgId`.

## Step 3 — Docs

Update the Operator part of `docs/capabilities/web-panel.md` rule 9 (the look and the new spec). No user docs page (the operator page is not public).

## Out of scope

Any operator route or rule, the CLI, the operator nav item (the shell ticket).

## Done when

The four pictures of step 1 test 3 match the panel theme with dense tables; the Proof of `../plan.md` with `operator.spec.ts` prints `PROOF_OK`.
