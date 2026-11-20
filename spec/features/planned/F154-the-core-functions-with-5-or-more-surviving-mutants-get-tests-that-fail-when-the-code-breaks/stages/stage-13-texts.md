# F154 stage 13 — text tables: notices, bot, minimal, loop taps

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–12, 14–17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File at the audit | Function | Count |
| --- | --- | --- |
| `texts/notices.ts` | `loopsNone`, `urgent`, `loops`, `staysInAiFolder`, `cost` | 8, 8, 6, 5, 5 |
| `texts/bot.ts` | `lastSync`, `approvalsLine` | 14, 8 |
| `texts/minimal.ts` | `reviewInPanel` | 12 |
| `texts/loop-taps.ts` | `more` | 8 |

At `HEAD`, `texts/notices.ts` and `texts/bot.ts` are split into `-en.ts` and `-pl.ts` files (plan D9): each function now exists once per locale. Measure and cover both locale files; the results table names the function per file.

Mutate globs: `src/texts/notices.ts`, `src/texts/notices-en.ts`, `src/texts/notices-pl.ts`, `src/texts/bot.ts`, `src/texts/bot-en.ts`, `src/texts/bot-pl.ts`, `src/texts/bot-common.ts`, `src/texts/minimal.ts`, `src/texts/loop-taps.ts`. No test file in a glob.

## Cases (fixed values)

Each case is a `test.each` over both locales with the exact string at `HEAD`. A string that reads wrong in Polish (case, number form) is a P3 question, not an expected value.

1. `lastSync`: never synced (`null`), synced just now, synced 1 minute ago, 5 minutes ago, 2 hours ago → exact text (kills the two conditional mutants at the branch).
2. `approvalsLine`: 0, 1, 2 and 5 pending approvals → exact text (Polish plural forms 1, 2, 5).
3. `loopsNone`, `loops`: 0, 1 and 3 open loops → exact text.
4. `urgent`: `withoutNotice` 0 and 1 → exact text (kills `>= 0`).
5. `cost`: the branch with and without a limit; exact text.
6. `staysInAiFolder`: each branch; exact text.
7. `reviewInPanel`: count 1 and count 3, with and without a link → exact text.
8. `more` (loop taps): 0 hidden → the code's text or none at `HEAD`; 1 and 4 hidden → exact text.

## Done when

- `results/stage-13.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- Any text change. The `texts/index` registry tests.
