# Cut stage 12: five cases a kept case may cover

Base: `e2bfbc7c`. Rows: five (`DELETE-DUP`, owner `ok`). Result: one row cut, four deferred.

Open branches (`git branch --no-merged master --list 'limen/*'`): five; none changes a file of these rows.

## Pairs

Keys come from `cut-keys.ts` on a fresh scan at the base (`/tmp/f125-s12/scan`). Four of the five deleted keys resolved. The rules CLI case was renamed (`deferred-none` under its old name); I found it by its new name. A kept case is named `<file>::<name>`.

| Deleted case | Kept case | Same input class | At least as strict | Result |
| --- | --- | --- | --- | --- |
| `apps/web/integrations/changelog-releases.test.ts:46` `the real CHANGELOG.md parses` | `changelog-releases.test.ts::it serves the virtual module from the real file` (now `:68`) | yes: both call `panelReleases` on the real `CHANGELOG.md` | yes: the deleted case asserts only `not.toThrow()`; the kept case calls the same function first, so a throw fails it, and then compares the exact output | cut |
| `apps/server/test/integration/rules-cli.test.ts` `a pattern without a local part and a domain is a usage error: exit 2 and the usage` (was `:71`, renamed) | `packages/core/src/triage/rules.test.ts` `refuses everything else` (now `:158`) | yes: `@x.pl` and `@firma.test` both have no local part | no: the kept case checks only that `isValidSenderPattern` returns false. It does not pin that `rules:add` refuses the pattern, the exit code 2 or the usage line | deferred |
| `apps/server/test/integration/testmail-cli.test.ts:262` `10. a live lock stops send` | `apps/server/src/modules/testmail/lock.test.ts` `a second acquire with a live pid throws` (now `:20`) | yes: a lock held by a live pid | no: the kept case has the exact message but calls `acquireSendLock` alone. Only the CLI case shows that `send` takes the lock before it sends (`fake.sent` stays empty) and exits 1. `testmail.ts` is the only caller in a tested path | deferred |
| `apps/server/test/integration/org-export-cli.test.ts:123` `4. a bad recipient or a missing argument: exit 2 with the usage text, nothing written` | `apps/server/src/scripts/org-export-args.test.ts` `a missing or bad argument throws a usage error` (now `:18`) | yes: the same three bad inputs | no: the kept case asserts a bare `toThrow()`; the CLI case pins exit 2, the exact usage prefix and that no file is written | deferred |
| `apps/server/test/integration/mailbox-settings-urgency-cli.test.ts:131` `a bad file prints the usage and issue paths on stderr, writes nothing, exits 1` | `apps/server/src/scripts/mailbox-settings-args.test.ts` `parseUrgencyFile: a profile; not JSON; schema errors as paths without values` (now `:138`) | yes for the not-JSON and schema inputs; no for a missing file, which only the CLI case uses | no: the kept case checks the parser result. The CLI case pins what the CLI prints (usage line, `urgency file: not JSON`, the issue paths, no value on stderr, the read-failure line) and exit 1 | deferred |

Each deferred pair fails the second fact: the CLI case pins an exit code, a printed text or a wiring step that the kept case does not. The stage rule forbids strengthening a kept case here (that is a rewrite, another group). Nothing in a deferred file changed.

Note for the coordinator (a proposal, not done): for the rules pair a stronger kept case exists, `apps/server/src/scripts/rules-args.test.ts` `a pattern with no local part and no domain is a usage error` (a `test.each` row, same `@…` input, asserts `UsageError`), and `apps/server/src/platform/cli.test.ts` `a UsageError returns 2 with the message and the usage line` pins exit 2 and the usage line. With those two as the kept cases the rules CLI case would be a true duplicate. The owner's row names `rules.test.ts` instead, so I did not change the kept key.

## Deferred rows

- `rules-cli.test.ts` (rules CLI usage case): kept case is weaker (see above).
- `testmail-cli.test.ts:262`: the CLI wiring has no other test.
- `org-export-cli.test.ts:123`: kept case is a bare `toThrow()`.
- `mailbox-settings-urgency-cli.test.ts:131`: the CLI output has no other test.

## Edit

Deleted the one case in `apps/web/integrations/changelog-releases.test.ts` (5 lines). No helper or import became unused: `readFileSync` and `fileURLToPath` are still used by the kept case.

## Break once

| Kept case | Break | Result |
| --- | --- | --- |
| `changelog-releases.test.ts` `it serves the virtual module from the real file` | the first release line of `CHANGELOG.md` gets the date `2026-13-01` (the parser refuses it) | the kept case fails (`bun test`: 4 pass, 1 fail); `CHANGELOG.md` restored with `git checkout` |
| `rules.test.ts` `refuses everything else` | not done: row deferred | — |
| `lock.test.ts` `a second acquire with a live pid throws` | not done: row deferred | — |
| `org-export-args.test.ts` `a missing or bad argument throws a usage error` | not done: row deferred | — |
| `mailbox-settings-args.test.ts` `parseUrgencyFile: …` | not done: row deferred | — |

## Proof

Files run: `apps/web/integrations/changelog-releases.test.ts` (the one file changed; it holds the kept case). Before: two runs; after: one run. The lane is unit only. No spawning CLI case was cut, so the lcov note for spawned processes does not apply.

## Cut proof: changelog-releases.test.ts

Before: `/tmp/f125-s12/before-1`, `/tmp/f125-s12/before-2`. After: `/tmp/f125-s12/after`. Expected: unit=-1, int=+0.

| lane | cases before | cases after | serial time before | serial time after |
| --- | --- | --- | --- | --- |
| unit | 6 | 5 | 1.30 s | 0.32 s |
| int | 0 | 0 | 0.00 s | 0.00 s |

- Case counts: pass.
- Covered lines: pass; 1 noise files skipped.
- Mutants: not checked (no mutation.json on both sides); 0 on one side only.

Result: PASS

