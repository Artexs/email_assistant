# F121 stage 03 — Pricing page (en)

Part of [`../plan.md`](../plan.md). Decisions P3, D3. Needs stage 01 and F107 stage 08 (`costToRun`, `pilotCost`, `docs/cost-model.md`).

Carry-over reads: F107 `stages/stage-08-cost-and-adr.md` (D10 interface, `basis` rule), `packages/core/src/metrics/cost-model.ts`, `docs/cost-model.md`, `packages/core/src/site.ts`, decision 11 of the E10 epic page.

## Step 1 — Price constant and rows

**Goal.** One source for the price and the cost table.

**Files.** `packages/core/src/site.ts` (`PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH = 25`) and its test; new `apps/docs/src/pricing.ts` and test.

**Decisions.**
- `costRows()` calls `costToRun(n)` for n = 50, 100, 200 at the default host size; values rounded to 2 decimals; `marginUsd = price − totalUsd`.
- `basis` of the rows: one value for the table (all rows share the pilot block). `estimate` shows a note: "Estimate: the measured data is too small." `measured` shows the measurement weeks from `pilotCost.weeks` and the date `measuredOn`.
- If `docs/cost-model.md` already holds the same price, a test asserts both say 25 (one claim, two places).

**Test.**
1. `costRows()` has 3 rows, `mailsPerDay` 50, 100, 200 in this order.
2. For each row, `totalUsd` equals `round2(costToRun(n).totalUsd)` and `marginUsd` equals `round2(25 − costToRun(n).totalUsd)`.
3. With an injected `costToRun` stub returning `totalUsd 1.905` for 100: row 100 shows `1.91` and margin `23.10`. (Inject through a parameter with the real function as the default.)
4. `docs/cost-model.md` price cell = `PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH`.

Mutation: change the price constant to 26 → test 4 fails.

## Step 2 — The page

**Goal.** `/pricing/` shows the one plan, the banner and the cost to run.

**Files.** New `apps/docs/src/content/docs/pricing.mdx`, `apps/docs/src/components/CostTable.astro`, sidebar entry after security.

**Decisions.**
- Banner first: "Not for sale. This is a placeholder price for a product that is built to a sale standard; there is no checkout." Starlight `aside` (no new component).
- One plan card: $25 per mailbox per month, what it includes (the product as described on the home page), no tiers, no "contact sales", no form.
- Cost table columns: mails a day, AI, hosting, backup, total, margin at the placeholder price; a line that hosting assumes 20 mailboxes per host; a link to the security page for where data goes.
- No currency conversion; USD on the page.

**Test.**
5. Browser check: `/pricing/` has the banner text, the price `$25`, a table with 3 body rows; axe zero violations.
6. The page holds no `<form>`, no `input` (browser check).

**Check.** `bun test packages/core/src/site.test.ts apps/docs/src`, `bun run docs:build`, `flock /tmp/email-assistant-shared-tests.lock bun run docs:test`.

**Done when.** Tests 1–6 pass; Proof prints `PROOF_OK`.

**Out of scope.** Polish page (stage 05); any change to `costToRun` or `docs/cost-model.md` numbers.
