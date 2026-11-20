# F154 stage 10 — changelog parser and web form schemas

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–09, 11–17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Count |
| --- | --- | --- |
| `changelog.ts` | `parseChangelog` | 23 (top 10) |
| `changelog.ts` | `semverParts` (private; through the exported semver compare) | 5 |
| `web/notify.ts` | (module level): the notify patch schema refinement | 21 |
| `web/delegation.ts` | (module level): the delegate patch schema refinement | 11 |
| `web/replies.ts` | `cleanReplyInstruction` | 12 |

Mutate globs: `src/changelog.ts`, `src/web/notify.ts`, `src/web/delegation.ts`, `src/web/replies.ts`.

Note: `changelog.test.ts` reads the repo `CHANGELOG.md`; `mutation.sh` copies it into the work folder. New cases use inline Markdown strings, not the repo file.

## Cases (fixed values)

`parseChangelog`, inline Markdown; each error row asserts the `ChangelogError` code and line number:
1. A valid file with `## Unreleased`, two releases newest first, a `<!-- … -->` comment block over three lines, and a "For users" item with `en` and `pl` lines → the exact release array.
2. CRLF line ends parse the same as LF (`\r` at line end dropped).
3. Errors, `test.each`: a heading with a bad version (`## [1.2] - 2026-01-01`) → `changelog_heading` at its line; a bad date (`2026-02-30`) → `changelog_date`; the same version twice → `changelog_duplicate`; an older version above a newer one → `changelog_order`; a For-users `en` item with no `pl` line at the end of the file → `changelog_for_users_item` at the `en` item's line; a `pl` line with no `en` item → `changelog_for_users_item` at that line.
4. The last line: a file whose last line is a pending item (no trailing newline) → the error, not a silent drop (kills the `index <= lines.length` and loop-bound mutants).
5. A comment that opens and closes on one line is skipped; text after `-->` on the closing line is the code's behaviour at `HEAD`.

Semver compare (exported function that calls `semverParts`):
6. `1.2.3` vs `1.2.3` → `0`; `1.10.0` vs `1.9.9` → `1`; `0.0.1` vs `0.1.0` → `-1`.
7. `1.2` → throws `compare_semver "1.2"`; `1.2.3-rc.1` → throws; `01.2.3` → throws (leading zero).

Notify patch schema (`safeParse`, exact issues):
8. `{}` → one issue `message: "notify_one_group"`; quiet fields and `routes` together → the same single issue; `{ routes: {…valid} }` → parses.
9. Quiet group: `quietStart` without `quietEnd`, both `null`, both set, and equal times → the exact issue or success at `HEAD`, one row each.
10. Channel group: `reportChannel: "mail"` without `reportMailboxId`, with one, `reportChannel: "telegram"` with a mailbox id → the exact issue or success at `HEAD`.

Delegate patch schema:
11. `{}` → issue `message: "name, tags or active is required"`; `{ active: false }` → parses; `{ email: "a@b.pl", name: "A" }` → fails (strict); a name of `DELEGATE_NAME_RAW_MAX` characters parses, one more fails.

`cleanReplyInstruction`:
12. `"  Odpisz uprzejmie  "` → `"Odpisz uprzejmie"`; `""` and `"‎"` → `null`; 300 characters → the same string; 301 → `null`; a string of 300 emoji (surrogate pairs) → kept (length counts code points); two lines → one line as `cleanUserText` makes it.

## Done when

- `results/stage-10.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- The changelog page of `apps/web`. The notify and delegation routes.
