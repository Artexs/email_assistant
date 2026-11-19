# Cost model v1

> Draft. The numbers come from `packages/core/src/metrics/cost-model.ts` (`costToRun`). The table below is checked against that function by `apps/server/src/cost-model-doc.test.ts`. A change of a number starts in the code, never in this file.

The model gives the cost to run one mailbox for one month at a mail volume. A month is 30 days. All amounts are US dollars.

## Measured data

The pilot measurement is in the F107 ticket folder (`pilot-cost.md`, stage 07). It is read-only on the VPS at release `v0.4.1`, on 2026-11-19. The scope is one organization with one mailbox (the pilot mailbox, real mail). The window is four finished weeks (Monday 2026-10-19, 2026-10-26, 2026-11-02, 2026-11-09). The sums come from `bun run stats:week`.

| Quantity                                         | Value                                 |
| ------------------------------------------------ | ------------------------------------- |
| Triaged mails (the "of" count of `m4_handled`)   | 87                                    |
| LLM cost of all priced calls (plan, draft, test) | $0.0914                               |
| LLM calls                                        | 276                                   |
| Unpriced calls                                   | 0                                     |
| Models                                           | `gemini-3.5-flash-lite`, `gpt-6-luna` |

The measured LLM cost per mail is $0.0914 ÷ 87 = about $0.00105. It is an upper bound: it divides all LLM calls (also plan, draft and test mail) by the real triaged mails only. The first two weeks show triaged mail and no priced LLM call, so the pilot window is short and uneven.

**Basis.** The model uses the measured value only when the pilot has at least 100 triaged mails and at most 5% unpriced calls. The pilot has 87 mails and 0 unpriced calls. So the basis is **estimate**: the LLM column below uses $0.000143 per mail (classifier only, measured by the E3 discovery, `docs/product/stage-2/epics/E03-discovery-notes.md` §4). The measured upper bound is about 7 times higher. The model switches to the measured value when a later window holds 100 mails.

## Cost per mailbox per month

Basis: estimate (see above). Hosting is the Hetzner CX23 reference divided by the mailboxes per host. Backup is a fixed share.

| Mails per day | Mailboxes per host | LLM  | Hosting | Backup | Total |
| ------------- | ------------------ | ---- | ------- | ------ | ----- |
| 50            | 20                 | 0.21 | 0.36    | 0.05   | 0.62  |
| 100           | 20                 | 0.43 | 0.36    | 0.05   | 0.83  |
| 200           | 20                 | 0.86 | 0.36    | 0.05   | 1.26  |
| 200           | 10                 | 0.86 | 0.71    | 0.05   | 1.62  |
| 200           | 5                  | 0.86 | 1.42    | 0.05   | 2.33  |

## Not yet in the measurement

These costs are not in the table. Both are estimates from the E3 discovery notes §4, per mailbox per month at 200 mails a day:

- Reply drafts (E6): about $0.35.
- Escalation to a larger model, if built: about $1.3.

The LLM cost of the pilot already includes the draft calls that ran in the window, so the draft estimate may count some of them twice. The classifier estimate is the only figure in the table.

## Price

The price is a placeholder: $25 per mailbox per month. It is not for sale; there is no billing and no public sign-up (ADR 0020). The margin is the price minus the total.

| Mails per day | Mailboxes per host | Total | Margin |
| ------------- | ------------------ | ----- | ------ |
| 50            | 20                 | 0.62  | 24.38  |
| 100           | 20                 | 0.83  | 24.17  |
| 200           | 20                 | 1.26  | 23.74  |
| 200           | 10                 | 1.62  | 23.38  |
| 200           | 5                  | 2.33  | 22.67  |

The cost target of the product is at most $5 per mailbox per month (PD-059). Every row is below it.

## Hosting

The reference is a Hetzner CX23 (€5.99, about $7.1 a month) shared by 20 mailboxes (PD-059). The assumption of 20 mailboxes per host holds until the load test (E8). The pilot runs on the home VPS of the owner; its cost is `<home VPS cost>` (to confirm, plan question Q8). Backup (Backblaze B2 and the domain) is $0.05 per mailbox per month, an assumption.

## Update rule

Each finished week of the E3 report can replace the measured block `pilotCost` in `packages/core/src/metrics/cost-model.ts`: add the week, sum the numbers, set `measuredOn`. Then run `bun test apps/server/src/cost-model-doc.test.ts` and change the numbers in this file until the test passes. The numbers change only in the code. The pricing page (E10b) reads `costToRun`.
