# F154 stage 05: question for the coordinator

The stage meets the target for every function except two, and it cannot meet them with tests alone. The plan says: above the cap of 3 equivalent plus unreachable mutants per function, the stage stops and asks.

## Facts (from `results/stage-05.md`)

- `renderApprovalRequest`: 29 → 18 counted. 16 are equivalent or unreachable (11 unreachable: nine in the second rebuild after the body cut at source line 181, one in a `view.subject !== null` check, one in a `quote === null` check inside the shrink loop; five equivalent). 2 are the bug class: an empty quote on a too-long card gets a quote-cut note.
- `chatQuoteText`: 11 → 5 counted, all five equivalent (header line count and prefix split).
- Everything else in the stage is at or below the D5 limit, and every new case kills at least one before-survivor.

## Options

1. **Accept the classes as they stand** (proposed default). Record the 21 equivalent or unreachable mutants as the stage result, and raise the cap for this stage only. No code change.
2. **Allow a product change** in a follow-up ticket: delete the dead second rebuild (source line 181), the `view.subject !== null` check, the `quote === null` check in the loop, and the unused prefix arithmetic in `chatQuoteText`. This removes about 16 of the 23 mutants. The ticket forbids product changes today (plan P2).
3. **Pin the quote-cut note of an empty quote** to kill the two bug-class mutants. This pins wrong output (plan P3), so it is not advised.

Proposed default: option 1 now, option 2 as a separate small ticket.
