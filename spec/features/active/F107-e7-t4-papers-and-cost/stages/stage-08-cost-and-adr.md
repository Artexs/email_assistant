# F107 stage 08 — Cost model v1, ADR 0020, docs

Part of [`../plan.md`](../plan.md). Decisions P7, P8, D10, D13. Needs stage 07 (`pilot-cost.md` in this folder).

## Step 1 — `costToRun` and the measured block

**Goal.** One pure function gives the cost per mailbox per month at a mail volume, from the pilot measurement, for `docs/cost-model.md` and the E10b pricing page.

**Files.** `packages/core/src/metrics/cost-model.ts` (exported from the `@ea/core` root, like `unitCost`) and its unit test.

**Interfaces.** D10: `costToRun(mailsPerDay, opts?)` and `pilotCost = { measuredOn: string; weeks: readonly string[]; triagedMails: number; llmUsd: number; llmCalls: number; unpricedCalls: number; models: readonly string[] }`, the sums of the four `stats:week` runs of `pilot-cost.md` (one window, one scope: the organization). `llmUsdPerMail = llmUsd / triagedMails`: all LLM calls (plan, draft, test mail) over the real triaged mails, so it is an upper bound; the doc says so.

**Decisions.**
- The hosting and backup shares come from one helper that `unitCost` (M7) also calls; M7 results do not change (its tests stay green unchanged).
- `basis: "measured"` when `triagedMails >= 100` and `unpricedCalls <= 0.05 × llmCalls`; else `"estimate"` with `E3_ESTIMATE_USD_PER_MAIL = 0.000143` (E3 notes §4, classifier only). The doc names the unpriced calls in both cases.
- `opts.mailboxesPerHost` defaults to `costModel.mailboxesPerHost` (20); `mailsPerDay` and `mailboxesPerHost` must be > 0, else the function throws a `RangeError`.
- Month = 30 days (the `monthlyCost` rule).

**Test.** With a test block of `triagedMails: 1000, llmUsd: 0.5, llmCalls: 1200, unpricedCalls: 0` (`$0.0005` per mail):
1. `costToRun(100).llmUsd` = `0.0005 × 100 × 30` = `1.5`; `hostingUsd` = `7.1 / 20` = `0.355`; `backupUsd` = `0.05`; `totalUsd` = `1.905`; `basis` = `measured`.
2. `costToRun(100, { mailboxesPerHost: 5 }).hostingUsd` = `1.42`.
3. With `triagedMails: 99`, or with `unpricedCalls: 61`, `basis` = `estimate` and `costToRun(100).llmUsd` = `0.000143 × 100 × 30` = `0.429`; with `unpricedCalls: 60`, `measured`.
4. `costToRun(0)` and `costToRun(50, { mailboxesPerHost: 0 })` throw `RangeError`.
5. `unitCost` gives the same `hostingUsdMonth` and `backupUsdMonth` as `costToRun` for the default host size.

(Compare with `toBeCloseTo`, 6 digits. Inject the block for the tests; the exported `pilotCost` holds the real numbers of `pilot-cost.md`; the code and the doc cite "the F107 ticket folder", not a path, because the folder moves at close.)

## Step 2 — `docs/cost-model.md`

**Goal.** The owner and an auditor read the cost from measured data.

**Decisions.** Sections: Measured data (from `pilot-cost.md`: dates, mails, LLM cost, models, unpriced calls; no ids); Cost per mailbox per month (table: rows 50, 100, 200 mails a day; columns LLM, hosting, backup, total; at 20 mailboxes per host, plus one line per 5 and 10 mailboxes per host at 200 mails); Not yet in the measurement (reply drafts about $0.35, escalation about $1.3, from E3 notes §4, as estimates); Price (`$25` per mailbox per month, a placeholder, not for sale; margin at each row); Hosting (Hetzner CX23 reference, PD-059; the home VPS cost `<home VPS cost>`, Q8); Update rule (each finished E3 report week can replace the measured block; the numbers change only in `cost-model.ts`).

**Test.**
6. A unit test (next to the capability map test) reads the table of `docs/cost-model.md` and checks every cell against `costToRun` rounded to 2 decimals.

## Step 3 — ADR 0020 and pointers

**Decisions.**
- `docs/decisions/0020-accounts-invite-plan-consent-deletion.md`, status accepted, date of the commit: Context (local production, no outside customer, P16–P19); Decision (invite only, plan state `trial`/`active`/`suspended` without payment, consent by mailbox mode and the Telegram consent, terms acceptance by version, organization delete and export, data requests on instruction); Consequences (papers stay drafts; a public sign-up or billing needs a new ADR). Sources: `docs/capabilities/tenancy-and-plans.md`, `account-data.md`, `web-panel.md`.
- `docs/decisions/README.md`: row 0020 with the title and status; 0018 and 0019 stay reserved.
- D13: new `docs/capabilities/papers.md` (template of `docs/capabilities/README.md`; the pages, the registries, the guards, `costToRun`, the seams of D12) and its index row; `docs/architecture.md` §7 "Papers" row; `docs/product-brief.md` and `docs/roadmap.md` link `docs/legal/README.md` and `docs/cost-model.md`.

**Test.**
7. The capability map test passes with the new page.

**Check.** `bun test packages/core/src/metrics`, the new doc test, the capability map test.

**Done when.** Tests 1–7 pass and the Proof prints `PROOF_OK`. Then the coordinator closes the ticket (`limen ticket done F107`).

**Out of scope.** M7 changes, new prices in `llmPrices`, the pricing page (E10b).
