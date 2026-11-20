# Stage 13 results: text tables (notices, bot, minimal, loop taps)

Runs: `bash scripts/test-audit/mutation.sh /tmp/f154-s13/{before,after} --mutate src/texts/notices.ts --mutate src/texts/notices-en.ts --mutate src/texts/notices-pl.ts --mutate src/texts/bot.ts --mutate src/texts/bot-en.ts --mutate src/texts/bot-pl.ts --mutate src/texts/bot-common.ts --mutate src/texts/minimal.ts --mutate src/texts/loop-taps.ts`. The before run used a copy of the tree at the stage start (no new tests); the after run used the worktree at `c55cfc51`. `mutation-gaps.ts --before --after` exits 0.

A first after run showed 13 new cases that killed no before-survivor (the English `loops` rows, rows for one or no pending item that other tests already kill, the decimal-comma `urgent` row). They are cut; the second after run is the result below.

Functions in the stage table: all are at 0 counted mutants. The English `loops`, `loopsNone`, `urgent` and `cost`, and the Polish and English rows of `more`, `reviewInPanel`, `lastSync` and `approvalsLine`, each had fewer than 5 before mutants at this tree (the audit counts were from a run that tested more static mutants). Functions in the globs that were not in the table (`plReminders` 3, `lineOf` 2, `mailboxProblems` 2, `tried` 2, `setApproved` 1, `mailboxName` 1 each, Polish `weekly` 1) have fewer than 5 and are untouched.

The audit rows are one-per-locale now: `approvalsLine` in the table has no plural form (the code prints the count as a number), so the cases pin the three variants (no extras, oldest, held, both) instead of the plural forms 1, 2 and 5.

## Before and after, per function

| file | function | before | after |
| --- | --- | --- | --- |
| packages/core/src/texts/bot-en.ts | lastSync | 7 | 0 |
| packages/core/src/texts/bot-pl.ts | lastSync | 7 | 0 |
| packages/core/src/texts/minimal.ts | minimalTextTables.en.reviewInPanel | 6 | 0 |
| packages/core/src/texts/minimal.ts | minimalTextTables.pl.reviewInPanel | 6 | 0 |
| packages/core/src/texts/notices-pl.ts | loops | 6 | 0 |
| packages/core/src/texts/notices-pl.ts | loopsNone | 6 | 0 |
| packages/core/src/texts/notices-pl.ts | urgent | 5 | 0 |
| packages/core/src/texts/bot-en.ts | approvalsLine | 4 | 0 |
| packages/core/src/texts/bot-pl.ts | approvalsLine | 4 | 0 |
| packages/core/src/texts/loop-taps.ts | loopTapTexts.en.delegate.more | 4 | 0 |
| packages/core/src/texts/loop-taps.ts | loopTapTexts.pl.delegate.more | 4 | 0 |
| packages/core/src/texts/notices-pl.ts | staysInAiFolder | 4 | 0 |
| packages/core/src/texts/bot-pl.ts | plReminders | 3 | 3 |
| packages/core/src/texts/notices-en.ts | urgent | 3 | 0 |
| packages/core/src/texts/notices-pl.ts | cost | 3 | 0 |
| packages/core/src/texts/minimal.ts | lineOf | 2 | 2 |
| packages/core/src/texts/minimal.ts | minimalTextTables.en.mailboxProblems | 2 | 2 |
| packages/core/src/texts/notices-en.ts | tried | 2 | 2 |
| packages/core/src/texts/notices-en.ts | cost | 2 | 0 |
| packages/core/src/texts/notices-en.ts | loopsNone | 2 | 0 |
| packages/core/src/texts/bot-pl.ts | setApproved | 1 | 1 |
| packages/core/src/texts/minimal.ts | minimalTextTables.en.mailboxName | 1 | 1 |
| packages/core/src/texts/minimal.ts | minimalTextTables.pl.mailboxName | 1 | 1 |
| packages/core/src/texts/minimal.ts | minimalTextTables.pl.weekly | 1 | 1 |
| packages/core/src/texts/notices-en.ts | staysInAiFolder | 1 | 0 |

| test file | case | kills |
| --- | --- | --- |
| packages/core/src/texts/bot.test.ts | src/texts/bot.test.ts > status lines > approvalsLine: en held only | 2 |
| packages/core/src/texts/bot.test.ts | src/texts/bot.test.ts > status lines > approvalsLine: en none waiting | 4 |
| packages/core/src/texts/bot.test.ts | src/texts/bot.test.ts > status lines > approvalsLine: en oldest only | 2 |
| packages/core/src/texts/bot.test.ts | src/texts/bot.test.ts > status lines > approvalsLine: pl held only | 2 |
| packages/core/src/texts/bot.test.ts | src/texts/bot.test.ts > status lines > approvalsLine: pl oldest and held | 4 |
| packages/core/src/texts/bot.test.ts | src/texts/bot.test.ts > status lines > approvalsLine: pl oldest only | 2 |
| packages/core/src/texts/bot.test.ts | src/texts/bot.test.ts > status lines > lastSync: en late | 4 |
| packages/core/src/texts/bot.test.ts | src/texts/bot.test.ts > status lines > lastSync: en never synced | 3 |
| packages/core/src/texts/bot.test.ts | src/texts/bot.test.ts > status lines > lastSync: en never synced and late | 3 |
| packages/core/src/texts/bot.test.ts | src/texts/bot.test.ts > status lines > lastSync: en on time | 4 |
| packages/core/src/texts/bot.test.ts | src/texts/bot.test.ts > status lines > lastSync: pl late | 4 |
| packages/core/src/texts/bot.test.ts | src/texts/bot.test.ts > status lines > lastSync: pl never synced | 3 |
| packages/core/src/texts/bot.test.ts | src/texts/bot.test.ts > status lines > lastSync: pl never synced and late | 3 |
| packages/core/src/texts/bot.test.ts | src/texts/bot.test.ts > status lines > lastSync: pl on time | 4 |
| packages/core/src/texts/loop-taps.test.ts | src/texts/loop-taps.test.ts > loop tap texts > the delegate picker more line: en a link | 2 |
| packages/core/src/texts/loop-taps.test.ts | src/texts/loop-taps.test.ts > loop tap texts > the delegate picker more line: en no link | 3 |
| packages/core/src/texts/loop-taps.test.ts | src/texts/loop-taps.test.ts > loop tap texts > the delegate picker more line: pl a link | 2 |
| packages/core/src/texts/loop-taps.test.ts | src/texts/loop-taps.test.ts > loop tap texts > the delegate picker more line: pl no link | 3 |
| packages/core/src/texts/minimal.test.ts | src/texts/minimal.test.ts > minimal texts > reviewInPanel: en a link | 4 |
| packages/core/src/texts/minimal.test.ts | src/texts/minimal.test.ts > minimal texts > reviewInPanel: en no link | 4 |
| packages/core/src/texts/minimal.test.ts | src/texts/minimal.test.ts > minimal texts > reviewInPanel: pl a link | 4 |
| packages/core/src/texts/minimal.test.ts | src/texts/minimal.test.ts > minimal texts > reviewInPanel: pl no link | 4 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > action failed notice > staysInAiFolder: en no folder | 1 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > action failed notice > staysInAiFolder: pl a folder | 2 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > action failed notice > staysInAiFolder: pl no folder | 3 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > cost: en two unpriced calls | 2 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > cost: pl no unpriced calls | 3 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > loops: pl five still open | 3 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > loops: pl none still open | 4 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > loops: pl one still open | 3 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > loops: pl three still open | 3 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > loopsNone: en one still open | 2 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > loopsNone: en three still open | 2 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > loopsNone: pl five still open | 3 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > loopsNone: pl none still open | 4 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > loopsNone: pl one still open | 3 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > loopsNone: pl three still open | 3 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > urgent: en no p90 and no notices | 3 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > urgent: en one notice | 3 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > urgent: pl five notices | 3 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > urgent: pl no p90 and no notices | 5 |
| packages/core/src/texts/notices.test.ts | src/texts/notices.test.ts > weekly notice lines with a count > urgent: pl one notice | 3 |

0 new cases kill no before-survivor

## Self-classed

None.

## Bugs

None.
