# Stage 10 results: changelog parser and web form schemas

Runs: `bash scripts/test-audit/mutation.sh /tmp/f154-s10/{before,after2} --mutate src/changelog.ts --mutate src/web/notify.ts --mutate src/web/delegation.ts --mutate src/web/replies.ts`. The before run used a copy of the tree at the stage start (no new tests). A first after run (`after`) showed 11 new cases that killed no before-survivor (compare-order rows, a valid date, the cap constant, a strict-object case, a last pair with no newline) and one case that did not kill the `/\r/` mutant (the carriage return sat next to a line-final one; `replace` without a global flag strips only the first). The cases were cut or fixed, and the second after run (`after2`) is the result below. `mutation-gaps.ts --before --after` exits 0.

## Before and after, per function

```
| file | function | before | after |
| --- | --- | --- | --- |
| changelog.ts | parseChangelog | 23 | 10 |
| web/notify.ts | (module level) | 21 | 10 |
| web/replies.ts | cleanReplyInstruction | 12 | 0 |
| web/delegation.ts | (module level) | 11 | 0 |
| changelog.ts | semverParts | 5 | 3 |
| changelog.ts | validDate | 3 | 0 |
| changelog.ts | compareSemver | 2 | 2 |
| changelog.ts | constructor | 1 | 0 |

| test file | case | kills |
| --- | --- | --- |
| changelog.test.ts | src/changelog.test.ts > compareSemver errors > 01.2.3 against 1.2.3 throws with the bad version in the message | 2 |
| changelog.test.ts | src/changelog.test.ts > compareSemver errors > 1.2 against 1.2.3 throws with the bad version in the message | 2 |
| changelog.test.ts | src/changelog.test.ts > compareSemver errors > 1.2.3 against 1.2.3-rc.1 throws with the bad version in the message | 2 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > For users lines before the first release heading are not read | 1 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > a blank line between the en line and the pl line breaks the item | 3 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > a carriage return inside an item line is not dropped: the line is no item | 1 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > a date with day 00 is changelog_date | 2 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > a date with month 00 is changelog_date | 3 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > a last item with no trailing newline is an error, not a silent drop | 1 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > a second Unreleased after a release below the first Unreleased is changelog_duplicate | 1 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > an indented comment line, a trailing space on the group heading and trailing spaces on an item are trimmed | 3 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > an open item at another group heading is not paired with a later pl line | 1 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > an open item at the next release heading is an error at the item line, before the heading is read | 1 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > the date 2026-01-01 is valid | 1 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > the date 2026-01-31 is valid | 1 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > the error carries its name, its code and the line in the message | 2 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > three releases: a version above the last release is checked against the last one | 1 |
| changelog.test.ts | src/changelog.test.ts > parseChangelog edge cases > three releases: the last release again is checked against the last one | 1 |
| web/delegation.test.ts | src/web/delegation.test.ts > delegatePatchBodySchema > a name of the raw maximum parses and one more character is refused | 6 |
| web/delegation.test.ts | src/web/delegation.test.ts > delegatePatchBodySchema > an empty body is refused with one issue that names the three fields | 4 |
| web/delegation.test.ts | src/web/delegation.test.ts > delegatePatchBodySchema > only a name parses | 6 |
| web/delegation.test.ts | src/web/delegation.test.ts > delegatePatchBodySchema > only active false parses | 4 |
| web/delegation.test.ts | src/web/delegation.test.ts > delegatePatchBodySchema > only active true parses | 4 |
| web/delegation.test.ts | src/web/delegation.test.ts > delegatePatchBodySchema > only an empty tag list parses | 6 |
| web/notify.test.ts | src/web/notify.test.ts > notifyPatchSchema issues > a window over 18 hours is quiet_too_long on quietEnd | 3 |
| web/notify.test.ts | src/web/notify.test.ts > notifyPatchSchema issues > an empty body is one custom issue for the whole body | 1 |
| web/notify.test.ts | src/web/notify.test.ts > notifyPatchSchema issues > channel: a mailbox with no channel is channel_required on reportChannel | 4 |
| web/notify.test.ts | src/web/notify.test.ts > notifyPatchSchema issues > channel: a null channel with a mailbox parses | 1 |
| web/notify.test.ts | src/web/notify.test.ts > notifyPatchSchema issues > channel: a null mailbox with no channel is channel_required on reportChannel | 4 |
| web/notify.test.ts | src/web/notify.test.ts > notifyPatchSchema issues > channel: telegram with a mailbox parses | 1 |
| web/notify.test.ts | src/web/notify.test.ts > notifyPatchSchema issues > quiet hours: a null start with a time end is quiet_pair on quietEnd | 3 |
| web/notify.test.ts | src/web/notify.test.ts > notifyPatchSchema issues > quiet hours: a start with no end is quiet_pair on quietEnd | 3 |
| web/notify.test.ts | src/web/notify.test.ts > notifyPatchSchema issues > quiet hours: a time start with a null end is quiet_pair on quietEnd | 3 |
| web/notify.test.ts | src/web/notify.test.ts > notifyPatchSchema issues > quiet hours: an end with no start is quiet_pair on quietEnd | 3 |
| web/notify.test.ts | src/web/notify.test.ts > notifyPatchSchema issues > quiet keys with a channel is one custom issue for the whole body | 1 |
| web/notify.test.ts | src/web/notify.test.ts > notifyPatchSchema issues > routes alone parse: a route key removed with null | 1 |
| web/notify.test.ts | src/web/notify.test.ts > notifyPatchSchema issues > routes alone parse: a route value | 1 |
| web/notify.test.ts | src/web/notify.test.ts > notifyPatchSchema issues > routes next to quiet keys are one group too many: the issue is on the whole body | 2 |
| web/replies.test.ts | src/web/replies.test.ts > cleanReplyInstruction > 300 characters is kept | 5 |
| web/replies.test.ts | src/web/replies.test.ts > cleanReplyInstruction > 300 emoji (the length counts code points) is kept | 5 |
| web/replies.test.ts | src/web/replies.test.ts > cleanReplyInstruction > 301 characters is null | 5 |
| web/replies.test.ts | src/web/replies.test.ts > cleanReplyInstruction > 301 emoji is null | 5 |
| web/replies.test.ts | src/web/replies.test.ts > cleanReplyInstruction > an empty line is null | 5 |
| web/replies.test.ts | src/web/replies.test.ts > cleanReplyInstruction > drops a direction mark and a control character | 4 |
| web/replies.test.ts | src/web/replies.test.ts > cleanReplyInstruction > joins two lines into one | 6 |
| web/replies.test.ts | src/web/replies.test.ts > cleanReplyInstruction > one character is kept | 5 |
| web/replies.test.ts | src/web/replies.test.ts > cleanReplyInstruction > only a direction mark is null | 5 |
| web/replies.test.ts | src/web/replies.test.ts > cleanReplyInstruction > only blanks is null | 5 |
| web/replies.test.ts | src/web/replies.test.ts > cleanReplyInstruction > trims the ends | 4 |

0 new cases kill no before-survivor
```

All of `replies.ts` `cleanReplyInstruction` (12 no coverage), `delegation.ts` (module level, 11 no coverage) and `changelog.ts` `validDate`, `constructor` fall to 0. `semverParts` (3) and `compareSemver` (2) end below 5, so D5 needs no class for them; the rows are listed below anyway. `parseChangelog` (10) and the notify schema (10) stay at 10.

## Self-classed

Every row is a mutant that no input can tell from the original code. Key: file, line:column, mutator, replacement.

| Function | Key | Class | Reason |
| --- | --- | --- | --- |
| parseChangelog | changelog.ts 78:34 StringLiteral `"Stryker was here!"` | equivalent | The tool marker on the `?? ""` fallback of `lines[index]`; the index is always inside the array |
| parseChangelog | changelog.ts 104:39 StringLiteral marker | equivalent | Tool marker on `match?.[1] ?? ""`; a null match throws the heading error either way |
| parseChangelog | changelog.ts 105:36 StringLiteral marker | equivalent | Same, for the date |
| parseChangelog | changelog.ts 136:61 StringLiteral marker | equivalent | Tool marker on `pl[1] ?? ""`; the regex group always exists |
| parseChangelog | changelog.ts 142:31 StringLiteral marker | equivalent | Same, for `en[1]` |
| parseChangelog | changelog.ts 68:20 BooleanLiteral `true` | equivalent | `inForUsers` starts false; every release heading resets it, and no line reads it before one (`current === null` continues first) |
| parseChangelog | changelog.ts 76:23 EqualityOperator `index <= lines.length` | equivalent | The extra pass reads an empty line: it throws the same item error at the same pending line as the `closeItem()` after the loop |
| parseChangelog | changelog.ts 106:13 ConditionalExpression `false` | equivalent | With a null match the version is `""`, and `SEMVER.test("")` fails: the same heading error |
| parseChangelog | changelog.ts 112:15 EqualityOperator `order >= 0` | equivalent | `order === 0` already threw the duplicate error one line above |
| parseChangelog | changelog.ts 129:11 ConditionalExpression `true` | equivalent | `closeItem` tests `pending` itself, so calling it with null changes nothing |
| semverParts | changelog.ts 39:30, 39:55, 39:80 StringLiteral `""` | unreachable | Fallbacks of `match[n] ?? "0"`; the regex has three groups, so none is ever undefined |
| compareSemver | changelog.ts 46:23 EqualityOperator `index <= 3` | equivalent | Index 3 reads two `undefined` values that both fall back to `0n`: equal |
| compareSemver | changelog.ts 49:25 EqualityOperator `x >= y` | equivalent | The branch runs only when `x !== y` |
| notify schema | notify.ts 64:9 ConditionalExpression `false` | equivalent | `routes` alone with no `if (routes) return` falls through all later branches and adds no issue |
| notify schema | notify.ts 75:7 (2 ConditionalExpression `true`, 3 LogicalOperator) | equivalent | The `quiet && start/end non-null` guard repeats what the pair check above it has already returned on: a start without an end, or one null and one time, never reaches it |
| notify schema | notify.ts 76:7, 77:7, 78:7, 79:7 ConditionalExpression `true` | equivalent | Each conjunct is covered by its partner: after the pair check, a start is null exactly when the end is null, and neither is undefined |

Count of `equivalent` or `unreachable`: `parseChangelog` 10 (5 are tool markers), notify schema 10. This is above the cap of 3 per function and 10 per stage. `questions-stage-10.md` in this ticket folder asks the coordinator how to rule on it.

## New cases

The `--before/--after` table above lists every new case with its kills; none has 0. Cases added: `changelog.test.ts` (error name and message, dates with month or day 00, a valid January date, last item with no newline, blank line inside an item, open item at a release heading and at another group heading, a second Unreleased below a release, three releases checked against the last, For users lines before the first release, trimming, a carriage return inside a line, the exact `compareSemver` error text), `web/notify.test.ts` (full issues: code, path, message, for every refinement branch, routes alone), `web/delegation.test.ts` (new file), `web/replies.test.ts` (`cleanReplyInstruction`).

## Bugs

None. One quirk, not pinned: a comment line `<!-->` opens a comment that nothing closes (`includes("-->", 4)` finds no end), so the rest of the file is skipped silently.
