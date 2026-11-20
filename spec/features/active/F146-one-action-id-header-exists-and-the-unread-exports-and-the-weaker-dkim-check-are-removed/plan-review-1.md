PASS 9a6c83cab1d496aa4171dc4f4f6eb2f4175d0a03

HEAD matches the candidate. Nothing in the plan breaks a ticket acceptance bullet. The plan has two test-design holes, and two runs prove them: the moved DKIM cases can pass even when their guard is removed, and the scan test cannot see regex literals. Fix both before the build. There are also two small notes.

## Blocking findings

None.

## Unverified checks

- Lint, typecheck, `test:unit:ci` and `test:int:ci` were not run. This is a plan review: none of the planned code or tests exists yet, so a run would show nothing about the plan.

## Pre-mortem

- **The sync stored the system's own draft as foreign mail.** This would come from stage 01. The risk is a reader that gets `ACTION_ID_HEADER` (mixed case) where the map is lower case. The plan already catches that:
  - `mapper.test.ts:67-70` feeds `X-EA-Action-Id:` and expects `act-7`.
  - `fake.test.ts:300-317` feeds `X-Ea-Action-ID` and expects `act-1`.
  - The integration own-mail tests keep the literal header name (D4).
  - A wrong lookup key fails these tests. No gap.
- **One-click unsubscribe accepted a weaker DKIM proof.** Production already calls only `hasCoveredDkimPass` (`apps/server/src/modules/triage/newsletter-senders.ts:6,141`). Stage 02 forbids other production edits, and D7 adds an export guard. The real risk is lost regression coverage of the alignment rule. That is finding 1.
- **A parser case lost its test.** Stage 02 counts `expect` calls and stage 03 counts tests, so a deleted case shows. A case that still exists but checks nothing does not show. That is finding 1.

## Findings

1. **[proven] Stage 02: a moved negative case passes for the wrong reason when `SIGNED` has no signature for its `header.d`.** (`stages/stage-02-dkim-check.md` Step 1, items 1–2, and the break check; plan D6)
   - `hasCoveredDkimPass` returns false when the mail has no signature for the passing domain: `ofDomain.length > 0` at `packages/core/src/triage/dkim-pass.ts:101-103`.
   - So a false-expected case stays false even when the rule it tests is removed. Examples:
     - `pass("co.uk")` / `shop.co.uk` (`dkim-pass.test.ts:24`).
     - `pass(suffix)` / `evil.${suffix}` in the shared-suffix loop (`:122`).
     - `evilc.example` and `example` (`:23`, `:25`).
   - The temporary equality check in Step 1.2 cannot see this, because both functions return false.
   - The planned break check (comment stripping) uses `c.example`, which is surely in `SIGNED`, so it does not test this.
   - Probe (log: `probes.log` in the job folder):
     - Setup: a copy of `dkim-pass.ts` with `alignedDomains` changed to `floor = 1`, so the shared-suffix floor is gone.
     - With `SIGNED` missing `github.io` and `co.uk`, both cases still return `false`.
     - With those domains in `SIGNED`, both return `true`, so the case catches the break.
   - The domains of the suffix loop are built in code. The rule "a fixed list, not parsing the case strings" therefore leaves the worker to guess whether building `SIGNED` from the `suffixes` array is allowed.
   - Fix: add a lasting check, not a temporary one, that every `header.d=` value of each case input is in `SIGNED`. Two ways work: an assertion inside `covered()`, or one meta-test over the inputs. Allow building `SIGNED` from the `suffixes` array.
   - Add a second break check: set `floor` to 1 in `alignedDomains`. Then cases 2 (`co.uk`) and 8 (shared suffix) must fail.

2. **[proven] Stage 01: the scan test does not see regex literals.** (`plan.md` D3; stage 01 Step 2, test 5)
   - D3 checks string literals and template parts only.
   - Probe with the D3 node set: `const r = /^x-ea-action-id:\s*(.*)$/im;` gave 0 findings, and `"X-EA-Action-Id"` gave 1 (`probes.log`).
   - The one reader that parses raw header text already uses a regex (`apps/server/src/modules/mail/imap/probe-send.ts:124`). A later hand-written regex literal of the header would pass the scan, which goes against ticket Scope bullet 2 ("fails on a hand-spelled header name").
   - Fix: add `ts.isRegularExpressionLiteral` to D3 (match on `node.text`). Add a `test.each` row: `const r = /x-ea-action-id/i;` → 1.

3. **[proven, minor] Stage 03: the steps do not say what to do with every hit that the Done-when `rg` finds.**
   - `rg -w renderDigest` also hits the describe titles at `packages/core/src/digest/digest.test.ts:409` and `:764`.
   - It also hits two prose mentions in rule 6 of `docs/capabilities/digest-and-notices.md:45`. Step 3 names only rule 4 and the function table. These hits are in `claims.log`.
   - The Done-when check catches these, so nothing ships wrong. The worker must still guess the new describe titles. Name them in Step 1, for example `renderDigestWithBrief (no brief)`.

4. **[proven] The plan's "Not verified" item about string-built header names is settled.** `rg -niI 'x-ea-\$\{|"x-ea-"'` over `apps/*/src packages/*/src scripts` (tests excluded) found no header name built from parts. The other production `x-ea-` literals are `X-EA-Testmail`, `X-EA-Seed` and `X-EA-Probe`. Stage 01 can keep the `rg` step as a re-check.

## Notes

- **[plausible, minor]** Stage 02 Step 1 puts a file-level helper `covered(authResults, fromDomain)` into `dkim-pass.test.ts`. That file already has a helper `covered(signatures, auth, from)` inside the `hasCoveredDkimPass` describe block (`:139`). The new one is hidden inside that block, and two helpers with one name and different arguments confuse a reader. Give the new helper another name, for example `alignedCovered`.
- **Plan claims checked against HEAD** (excerpts in `claims.log`):
  - Every reader compares the header name without case (`fake/index.ts:85-91`; the `i` flag at `probe-send.ts:124`; the lower-case parser map at `mapper.ts:60`).
  - nodemailer writes `X-Ea-Action-ID` (`compose.test.ts:116`).
  - `REPORT_MAIL_ID_HEADER` has no reader.
  - `routeOfKind` is the composition of `noticeGroupOf` and `effectiveRoute` (`routes.ts:74-87`), which matches stage 03's helper.
  - `MailReportKind` has no reader. The `reportMailKinds` and `ReportMailKind` imports of `report-members.ts:3,6` are used only by the two aliases.
  - `@ea/core` re-exports `./outgoing` (`packages/core/src/index.ts:8`).
  - The three stages share no code file. Stages 02 and 03 both edit `docs/capabilities/trust.md` (rule 21 and rule 19), as the plan says.
- **Stage size:** each stage is one job of 1–3 hours. None is too big.

## Checks run

- `git rev-parse HEAD`: `9a6c83cab1d496aa4171dc4f4f6eb2f4175d0a03`, the candidate. The tree was clean.
- `bun install --frozen-lockfile`: 991 packages installed.
- `rg` sweeps over `apps packages scripts tools docs` for the header name, the seven names to delete, and string-built `x-ea-` names. The excerpts are saved in `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-20-f146-plan-review-42bfe71c/claims.log`.
- `bun test ./probe.test.ts` (Bun 1.4.4, the same as `.bun-version`) in a temporary folder in the worktree, deleted after the run. Result: 2 pass, 0 fail. Log: `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-20-f146-plan-review-42bfe71c/probes.log`.
- Lint, typecheck, unit and integration suites: not run (see Unverified checks).

## Note check

- HEAD equals the candidate: proven. `git rev-parse HEAD && test "$(git rev-parse HEAD)" = 9a6c83cab1d496aa4171dc4f4f6eb2f4175d0a03` exited 0.
- Plan claims checked against code at HEAD with file and line: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-20-f146-plan-review-42bfe71c/claims.log` (59 lines of `sed`/`rg` excerpts).
- Pre-mortem answered for own draft, weaker DKIM and lost parser case: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-20-f146-plan-review-42bfe71c/probes.log` (2 pass) and `claims.log` support the mapping in § Pre-mortem.
- Easy-to-miss rule ("Missing code detail … is not a finding"): followed. Each finding names a missing test guard (1, 2), a missing decision (3), or a settled open item (4). None asks for line numbers, edit text or file lists.
- Project reminder (merge master, then typecheck, lint and unit before the final message): not applicable. This job is a review and commits no product code. Nothing was committed.
