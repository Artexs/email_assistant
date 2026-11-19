# F121 stage 03 — Pricing page (en)

Needs stage 01: `OWNER_REVIEW_PENDING` holding `pricing`. Reads `costToRun`, `pilotCost` and `docs/cost-model.md`, landed (F107 stage 08). May run next to 02 (shared sidebar: merge, re-prove).

Part of [`../plan.md`](../plan.md). Decisions P3, D3.

Carry-over reads: `packages/core/src/metrics/cost-model.ts`, `docs/cost-model.md` and its test `apps/server/src/cost-model-doc.test.ts` (rounding), `packages/core/src/site.ts`, decision 11 of the E10 epic page.

At the base: `costToRun(mailsPerDay, { mailboxesPerHost?, pilot? })` returns `{ llmUsd, hostingUsd, backupUsd, totalUsd, basis }`; `basis` is `estimate` (87 pilot mails, the rule needs 100).

## Step 1 — Price constant and rows

**Goal.** One source for the price and the cost table.

**Files.** `packages/core/src/site.ts` (`PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH = 25`) and its test; new `apps/docs/src/pricing.ts` and test.

**Decisions.**
- `costRows(compute = costToRun)` calls `compute(n)` for n = 50, 100, 200 at the default host size; each value rounded to 2 decimals, half up, the same way as the doc test (so 0.355 → 0.36); `marginUsd = round2(price − round2(totalUsd))`, so total + margin = price on the page (review 1 N7). One rounding helper, exported from `pricing.ts`.
- `basis` of the rows: one value for the table (all rows share the pilot block). `estimate` shows a note: "Estimate: the measured data is too small." `measured` shows the measurement weeks from `pilotCost.weeks` and the date `measuredOn`. The page never shows `pilotCost.models` (P3: no model names).

**Test.**
1. `costRows()` has 3 rows, `mailsPerDay` 50, 100, 200 in this order.
2. With a pilot fixture equal to the base block (87 mails, $0.0914, 276 calls, 0 unpriced): totals 0.62, 0.83, 1.26; margins 24.38, 24.17, 23.74; basis `estimate`.
3. With a pilot of 1,000 mails, $1.00, 1,000 calls, 0 unpriced: basis `measured`; row 50 has LLM 1.50 and total 1.91 (1.5 + 0.355 + 0.05), margin 23.09.
4. With the real `costToRun`: every row equals the row of `docs/cost-model.md` § Cost per mailbox per month with 20 mailboxes per host, and its margin equals § Price; the § Price text says $25 = `PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH`.

Mutation: change the price constant to 26 → test 4 fails; round half to even → test 3 fails.

## Step 2 — The page

**Goal.** `/pricing/` shows the one plan, the banner and the cost to run.

**Files.** New `apps/docs/src/content/docs/pricing.mdx`, `apps/docs/src/components/CostTable.astro`, sidebar entry after security.

**Decisions.**
- No link to `/security/` here (the page may not exist yet); stage 04 adds it.
- Banner first: "Not for sale. This is a placeholder price for a product that is built to a sale standard; there is no checkout." Starlight `aside` (no new component).
- One plan card: $25 per mailbox per month, what it includes (the product as described on the home page), no tiers, no "contact sales", no form.
- Cost table columns: mails a day, AI, hosting, backup, total, margin at the placeholder price; a line that hosting assumes `costModel.mailboxesPerHost` mailboxes per host (read from the constant, not typed).
- No currency conversion; USD on the page.

**Test.**
5. Built HTML of `/pricing/`: each table cell equals the formatted `costRows()` value of its row and column (a renderer that shows the wrong field fails); the host-size line shows the constant.
6. Browser check: the banner text, the price `$25`, 3 body rows; axe zero violations.
7. The page holds no `<form>`, no `input` (browser check) and no `gemini` (case-insensitive).

**Check.** `bun test packages/core/src/site.test.ts apps/docs/src`, `bun run docs:build`, `flock /tmp/email-assistant-shared-tests.lock bun run docs:test`.

**Done when.** Tests 1–7 pass; Proof prints `PROOF_OK`.

**Out of scope.** Polish page (stage 05); any change to `costToRun` or `docs/cost-model.md` numbers.
