# Review: `packages/core`, `apps/web`, `apps/docs`, `deploy/test`, `tools` (F125 stage 04)

Reader review by `plan.md` § Reader method and § Rules for the classes. Read-only on tests. Base of this review: `535e6f76` (branch head after the merge of master at the job start).

Notes for the reader:

- **Keys.** Keys are `file:line` at the base above, from a fresh `bun scripts/test-audit/scan-cli.ts` run (`/tmp/f125-s04/rescan/`), not from the committed `cases-static.tsv`. Reason: master changed 9 files of this area after the stage 03 data (`deploy/test/backup`, `compose-drill`, `release-identity`; new `check-server-env`, `compose-lib`, `docs-env-split`, `env-split`; `apps/docs/scripts/workflows`, `shots-build`, new `apps/docs/src/extra-pages`): the committed keys of these files are stale and the committed `groups.tsv` ids (`B`/`T` numbers) differ from the fresh ones. Group ids in this file are the fresh ones; each group row lists all its keys. Times come from `cases.tsv` joined by file and name; a case that is new since stage 02 has no time (0.000). Core keys, `mutation-tests.tsv` and `mutation-survived.tsv` stay valid: no core test file changed after the mutation run (`git diff 4ce3f351 HEAD -- packages/core` shows only `legal/subprocessors.ts`).
- **Items.** An item is one flagged case, or one B or T group whose first key is in this area, or one core test file with `S10` cases and no other flag. Order: (a) `S1`, `S7`, `not-run`, then `S8` by file and line; (b) `S2`/`S3`/`S4`; (c) B groups; (d) T groups; (e) core `S11` (one item per distinct call-site key), then core `S10` files; (f) `S9`. The area is `packages/core`, `apps/web/src`, `apps/web/integrations`, `apps/docs/src`, `apps/docs/integrations`, `apps/docs/scripts`, `deploy/test`, `tools/fake-telegram/src`, `tools/mail-oauth-spike` (unit only; `apps/web/e2e`, `apps/docs/e2e` and `tools/fake-telegram/test` belong to stage 06). A case that is in a group and has no other flag is read inside its group row only. A case with `S8` and a group flag (`deploy/test/compose-lib.test.ts` 4a, 4c, 4d) is read as its own item and its group stays in the `not read` list.
- **Cap.** The job reads 50 items of 664 (cap 150 per job). Tier (a) alone has 151 items, because it holds 1 `S1` case, 23 `not-run` cases of the spike kit and 127 `S8` cases of `deploy/test`, `apps/docs/scripts`, `apps/web`, `apps/docs/src` and `tools/fake-telegram`; so this job read only tier (a). No core item was read, and the plan's two continuations (450 items for the whole stage) cannot reach the core `S11` and `S10` items: 338 `S11` keys and 133 `S10` files. The coordinator decides whether to raise the cap for a core-only reader job (Decisions for the owner in the final message).
- **S8 is mostly a false positive in this area.** The flagged cases run a real script, parse a real Compose or workflow file, or test a fake of a test tool, so `S8` is expected (stage 04 rules). Every `S8` row is `KEEP` unless another flag applies. The K rule is named where one applies: K3 for deploy and secret rules, K2 for completeness checks.
- **Columns.** `Lines` = test lines the action removes (0 for KEEP, REWRITE-WEAK and FIX-NEVER-RUNS). `Time (s)` = JUnit time of the case at the stage 02 run (not time saved).
- **Unstable mutants.** Stage 03 found 6 status differences between two runs (`replies/digits.ts` 297:21, 368:17, 372:23; `testmail/batch.ts` 107:5; `triage/suspicious.ts` 342:7). GAP counts leave out those mutants (4 of them are in `mutation-survived.tsv`).


## Core

No core item was read in this job (see Cap). GAP rows come from `mutation-survived.tsv`.

### GAP

Functions with 5 or more survived or no-coverage mutants (`mutation-survived.tsv`, 122 functions; the 6 unstable mutants left out). `(module level)` is code outside a named function or `const` arrow in the file (a schema `.refine` or a top-level object). Not a cut: a gap that no test catches. Example mutants are `line:column mutator → replacement`.

| Item | File | Function | Survived or no coverage | Example mutants |
| --- | --- | --- | --- | --- |
| GAP1 | `packages/core/src/replies/schema.ts` | `(module level)` | 42 | 20:32 BlockStatement → `{}` ; 21:9 ConditionalExpression → `true` |
| GAP2 | `packages/core/src/sim/checks.ts` | `checkSpread` | 38 | 195:7 ConditionalExpression → `false` ; 203:7 MethodExpression → `actualLength.every((v, i) => Math.abs(v - (planLength[i] as number)) > LENGTH_TOLERANCE)` |
| GAP3 | `packages/core/src/sim/sent-slot.ts` | `(module level)` | 33 | 77:55 StringLiteral → ```` ; 79:63 StringLiteral → `""` |
| GAP4 | `packages/core/src/digest/approvals.ts` | `renderApprovalRequest` | 29 | 124:7 ConditionalExpression → `true` ; 140:58 ConditionalExpression → `true` |
| GAP5 | `packages/core/src/triage/suspicious.ts` | `isOneEditApart` | 29 | 312:7 ConditionalExpression → `false` ; 312:7 ConditionalExpression → `false` |
| GAP6 | `packages/core/src/testmail/batch.ts` | `validateBatch` | 26 | 143:9 ConditionalExpression → `true` ; 151:68 StringLiteral → `""` |
| GAP7 | `packages/core/src/web/public-content.ts` | `ipv4Allowed` | 25 | 40:7 ConditionalExpression → `true` ; 40:7 LogicalOperator → `a === 172 \\|\\| b >= 16` |
| GAP8 | `packages/core/src/sim/checks.ts` | `checkCase` | 24 | 104:29 StringLiteral → `""` ; 109:7 StringLiteral → `""` |
| GAP9 | `packages/core/src/changelog.ts` | `parseChangelog` | 23 | 68:20 BooleanLiteral → `true` ; 76:23 EqualityOperator → `index <= lines.length` |
| GAP10 | `packages/core/src/replies/views.ts` | `deobfuscate` | 23 | 106:14 Regex → `/\s*[[({<]\S*(?:at\\|małpa\\|malpa)\s*[\])}>]\s*/gi` ; 107:14 Regex → `/\s*[[({<]\S*(?:dot\\|kropka)\s*[\])}>]\s*/gi` |
| GAP11 | `packages/core/src/sim/scenario.ts` | `validateScenario` | 23 | 161:32 ArrayDeclaration → `[]` ; 163:53 StringLiteral → ```` |
| GAP12 | `packages/core/src/triage/suspicious.ts` | `punycodeDecode` | 23 | 164:9 ConditionalExpression → `false` ; 164:9 EqualityOperator → `code > 0x80` |
| GAP13 | `packages/core/src/web/notify.ts` | `(module level)` | 21 | 59:20 ConditionalExpression → `false` ; 61:28 StringLiteral → `""` |
| GAP14 | `packages/core/src/triage/suspicious.ts` | `adapt` | 18 | 140:74 BlockStatement → `{}` ; 141:30 ArithmeticOperator → `delta * DAMP` |
| GAP15 | `packages/core/src/triage/eval-case.ts` | `prioritize` | 17 | 84:78 ArrayDeclaration → `[]` ; 84:79 StringLiteral → `""` |
| GAP16 | `packages/core/src/web/public-content.ts` | `r4ExternalAsset` | 17 | 71:26 ArrayDeclaration → `["Stryker was here"]` ; 72:33 Regex → `/\b(src\\|srcset)\s*=\s*(?:"([^"]*)"\\|'([^'])'\\|([^\s>"']+))/gi` |
| GAP17 | `packages/core/src/triage/suspicious.ts` | `digitValue` | 16 | 152:7 ConditionalExpression → `true` ; 152:7 EqualityOperator → `code > 48` |
| GAP18 | `packages/core/src/web/next-path.ts` | `safeNextPath` | 16 | 3:44 ConditionalExpression → `false` ; 3:52 StringLiteral → `"Stryker was here!"` |
| GAP19 | `packages/core/src/web/public-content.ts` | `parseAllowList` | 16 | 136:18 MethodExpression → `raw` ; 139:19 ConditionalExpression → `false` |
| GAP20 | `packages/core/src/texts/bot.ts` | `lastSync` | 14 | 235:47 ConditionalExpression → `true` ; 235:47 ConditionalExpression → `false` |
| GAP21 | `packages/core/src/triage/suspicious.ts` | `trustedAuthResults` | 14 | 366:7 ConditionalExpression → `false` ; 366:7 EqualityOperator → `semicolon <= 0` |
| GAP22 | `packages/core/src/digest/digest.ts` | `renderListed` | 13 | 315:48 ArrayDeclaration → `["Stryker was here"]` ; 319:24 StringLiteral → `"Stryker was here!"` |
| GAP23 | `packages/core/src/outgoing/sender.ts` | `approvalViewOf` | 13 | 56:7 ConditionalExpression → `false` ; 56:48 StringLiteral → `""` |
| GAP24 | `packages/core/src/sim/live/calendar-days.ts` | `isRealDate` | 13 | 14:7 ConditionalExpression → `false` ; 14:7 ConditionalExpression → `false` |
| GAP25 | `packages/core/src/testmail/target.ts` | `buildCompareRows` | 13 | 109:9 ConditionalExpression → `true` ; 112:23 MethodExpression → `[...emails]` |
| GAP26 | `packages/core/src/triage/dkim-pass.ts` | `trustedAlignedPassDomains` | 13 | 61:31 ConditionalExpression → `false` ; 61:31 MethodExpression → `fromDomain` |
| GAP27 | `packages/core/src/digest/notices.ts` | `renderActionFailedNotice` | 12 | 356:75 ConditionalExpression → `true` ; 356:92 StringLiteral → `""` |
| GAP28 | `packages/core/src/digest/weekly.ts` | `evidenceItems` | 12 | 64:39 ConditionalExpression → `true` ; 64:69 ConditionalExpression → `true` |
| GAP29 | `packages/core/src/notices/renderers.ts` | `full` | 12 | 120:27 StringLiteral → `""` ; 135:15 ObjectLiteral → `{}` |
| GAP30 | `packages/core/src/sim/checks.ts` | `openingOf` | 12 | 154:28 Regex → `/\r\n/` ; 155:16 MethodExpression → `(lines.length > 1 ? lines.slice(1).join(" ") : body).replace(/\s+/g, " ").trim().toUpperCase()` |
| GAP31 | `packages/core/src/texts/minimal.ts` | `reviewInPanel` | 12 | 94:29 StringLiteral → ```` ; 94:61 ConditionalExpression → `true` |
| GAP32 | `packages/core/src/web/replies.ts` | `cleanReplyInstruction` | 12 | 21:68 BlockStatement → `{}` ; 22:37 ObjectLiteral → `{}` |
| GAP33 | `packages/core/src/digest/approvals.ts` | `chatQuoteText` | 11 | 45:23 ConditionalExpression → `true` ; 45:23 ConditionalExpression → `false` |
| GAP34 | `packages/core/src/sim/fixtures.ts` | `sentFixtureText` | 11 | 186:7 ConditionalExpression → `true` ; 186:7 LogicalOperator → `slot.style.signature \\|\\| scenario.executive.signature !== ""` |
| GAP35 | `packages/core/src/web/delegation.ts` | `(module level)` | 11 | 48:21 ConditionalExpression → `true` ; 48:21 ConditionalExpression → `false` |
| GAP36 | `packages/core/src/digest/approvals.ts` | `replyRecipientLines` | 10 | 93:25 ArrayDeclaration → `[]` ; 94:37 StringLiteral → `""` |
| GAP37 | `packages/core/src/digest/digest.ts` | `sortItems` | 10 | 171:7 ArithmeticOperator → `b.receivedAt.getTime() + a.receivedAt.getTime()` ; 172:8 ConditionalExpression → `true` |
| GAP38 | `packages/core/src/notices/render.ts` | `renderNotice` | 10 | 24:7 ConditionalExpression → `false` ; 31:7 ConditionalExpression → `false` |
| GAP39 | `packages/core/src/outgoing/message.ts` | `buildOutgoingMessage` | 10 | 97:7 ConditionalExpression → `false` ; 97:52 StringLiteral → `""` |
| GAP40 | `packages/core/src/sim/lang.ts` | `detectLang` | 10 | 28:59 ArrayDeclaration → `["Stryker was here"]` ; 30:57 ArrowFunction → `() => undefined` |
| GAP41 | `packages/core/src/sim/live/executive.ts` | `cardsOf` | 10 | 168:9 ConditionalExpression → `false` ; 168:9 LogicalOperator → `callback === null && id === undefined` |
| GAP42 | `packages/core/src/testmail/target.ts` | `renderCompareTable` | 10 | 197:21 ConditionalExpression → `false` ; 197:37 ConditionalExpression → `true` |
| GAP43 | `packages/core/src/loops/replies.ts` | `messageIdsOf` | 9 | 49:25 ConditionalExpression → `false` ; 49:53 ArrayDeclaration → `["Stryker was here"]` |
| GAP44 | `packages/core/src/mail/providers.ts` | `serversFor` | 9 | 101:7 ConditionalExpression → `false` ; 101:7 ConditionalExpression → `false` |
| GAP45 | `packages/core/src/sim/draft-checks.ts` | `draftCodeChecks` | 9 | 23:41 OptionalChaining → `draft.to[0].toLowerCase` ; 25:42 ConditionalExpression → `false` |
| GAP46 | `packages/core/src/sim/live/date-shift.ts` | `shiftDatesInText` | 9 | 153:94 StringLiteral → `""` ; 161:39 BooleanLiteral → `false` |
| GAP47 | `packages/core/src/sim/live/executive.ts` | `kindOf` | 9 | 134:10 StringLiteral → `""` ; 135:10 StringLiteral → `""` |
| GAP48 | `packages/core/src/sim/manifest.ts` | `byId` | 9 | 86:57 ConditionalExpression → `true` ; 86:57 ConditionalExpression → `false` |
| GAP49 | `packages/core/src/testmail/send-log.ts` | `caseStates` | 9 | 108:36 ConditionalExpression → `true` ; 108:53 EqualityOperator → `Date.parse(line.at) <= Date.parse(sent.at)` |
| GAP50 | `packages/core/src/texts/approvals.ts` | `tries` | 9 | 253:64 ConditionalExpression → `false` ; 253:73 StringLiteral → `"Stryker was here!"` |
| GAP51 | `packages/core/src/texts/approvals.ts` | `softCap` | 9 | 257:63 ConditionalExpression → `false` ; 257:72 StringLiteral → `"Stryker was here!"` |
| GAP52 | `packages/core/src/triage/cost.ts` | `priceRowFor` | 9 | 47:82 StringLiteral → `""` ; 48:7 ConditionalExpression → `false` |
| GAP53 | `packages/core/src/triage/dkim-pass.ts` | `stripCommentsAndQuotes` | 9 | 23:19 EqualityOperator → `i <= text.length` ; 30:13 ConditionalExpression → `false` |
| GAP54 | `packages/core/src/triage/metrics.ts` | `simGoNoGo` | 9 | 201:21 MethodExpression → `llm` ; 201:41 ConditionalExpression → `true` |
| GAP55 | `packages/core/src/triage/settings.ts` | `describeSettings` | 9 | 111:72 BlockStatement → `{}` ; 113:10 ArrayDeclaration → `[]` |
| GAP56 | `packages/core/src/contacts/address.ts` | `caseFormTable` | 8 | 31:20 EqualityOperator → `cp < 0x10ffff` ; 32:9 ConditionalExpression → `false` |
| GAP57 | `packages/core/src/digest/local-time.ts` | `localInstants` | 8 | 126:68 ArithmeticOperator → `a + b` ; 129:26 ConditionalExpression → `true` |
| GAP58 | `packages/core/src/loops/extractor.ts` | `normalizeAnswer` | 8 | 46:7 ConditionalExpression → `false` ; 46:7 ConditionalExpression → `false` |
| GAP59 | `packages/core/src/sim/live/run-plan.ts` | `planLiveRun` | 8 | 91:22 EqualityOperator → `a.at <= b.at` ; 91:41 ConditionalExpression → `false` |
| GAP60 | `packages/core/src/sim/to-eval-case.ts` | `threadOf` | 8 | 67:32 ConditionalExpression → `true` ; 67:32 EqualityOperator → `parents.length >= 0` |
| GAP61 | `packages/core/src/texts/approvals.ts` | `contentSoft` | 8 | 255:62 ConditionalExpression → `false` ; 255:71 StringLiteral → `"Stryker was here!"` |
| GAP62 | `packages/core/src/texts/bot.ts` | `approvalsLine` | 8 | 244:53 ConditionalExpression → `false` ; 244:77 StringLiteral → `"Stryker was here!"` |
| GAP63 | `packages/core/src/texts/loop-taps.ts` | `more` | 8 | 87:23 ConditionalExpression → `true` ; 87:23 ConditionalExpression → `false` |
| GAP64 | `packages/core/src/texts/notices.ts` | `loopsNone` | 8 | 342:53 ConditionalExpression → `false` ; 342:67 StringLiteral → ```` |
| GAP65 | `packages/core/src/texts/notices.ts` | `urgent` | 8 | 353:124 ConditionalExpression → `true` ; 353:124 EqualityOperator → `withoutNotice >= 0` |
| GAP66 | `packages/core/src/triage/dkim-signature.ts` | `tagsOf` | 8 | 51:7 ConditionalExpression → `false` ; 51:7 EqualityOperator → `colon <= 0` |
| GAP67 | `packages/core/src/triage/suspicious.ts` | `skeleton` | 8 | 301:16 StringLiteral → `"Stryker was here!"` ; 303:9 ConditionalExpression → `false` |
| GAP68 | `packages/core/src/digest/digest.ts` | `cutToLimit` | 7 | 428:32 ArithmeticOperator → `end + 1` ; 429:7 ConditionalExpression → `false` |
| GAP69 | `packages/core/src/digest/notices.ts` | `renderUrgentNotice` | 7 | 70:27 StringLiteral → `""` ; 74:7 ConditionalExpression → `true` |
| GAP70 | `packages/core/src/digest/weekly.ts` | `autoItems` | 7 | 40:24 ConditionalExpression → `true` ; 40:46 ConditionalExpression → `false` |
| GAP71 | `packages/core/src/digest/weekly.ts` | `renderWeeklyReport` | 7 | 114:7 ConditionalExpression → `true` ; 114:7 LogicalOperator → `m1.important === 0 \\|\\| m4.triaged === 0` |
| GAP72 | `packages/core/src/loops/brief.ts` | `oldestFirst` | 7 | 100:73 ConditionalExpression → `false` ; 100:73 EqualityOperator → `id(a) <= id(b)` |
| GAP73 | `packages/core/src/replies/digits.ts` | `alnumStream` | 7 | 242:13 StringLiteral → `"Stryker was here!"` ; 243:78 ArrayDeclaration → `["Stryker was here"]` |
| GAP74 | `packages/core/src/replies/input.ts` | `cutChars` | 7 | 29:61 BlockStatement → `{}` ; 31:10 ConditionalExpression → `true` |
| GAP75 | `packages/core/src/sim/plan-bank.ts` | `buildSlot` | 7 | 204:44 StringLiteral → `""` ; 216:32 ConditionalExpression → `true` |
| GAP76 | `packages/core/src/triage/address.ts` | `splitAddress` | 7 | 6:45 MethodExpression → `value` ; 8:16 MethodExpression → `(match[1] ?? "").trim().replace(/^"(.*)"$/, "$1")` |
| GAP77 | `packages/core/src/triage/suspicious.ts` | `isRiskyAttachment` | 7 | 382:16 MethodExpression → `attachment.type.split(";")[0]` ; 382:16 OptionalChaining → `attachment.type.split(";")[0].trim` |
| GAP78 | `packages/core/src/triage/suspicious.ts` | `isDisplayNameSpoof` | 7 | 407:49 Regex → `/[.]$/` ; 407:58 StringLiteral → `"Stryker was here!"` |
| GAP79 | `packages/core/src/contacts/address.ts` | `addressCasedCodePoints` | 6 | 65:7 ConditionalExpression → `true` ; 66:29 ArrayDeclaration → `["Stryker was here"]` |
| GAP80 | `packages/core/src/digest/approvals.ts` | `renderApprovalSetRequest` | 6 | 250:26 StringLiteral → ```` ; 265:14 StringLiteral → `"Stryker was here!"` |
| GAP81 | `packages/core/src/digest/callback.ts` | `isReplyCallback` | 6 | 82:5 ConditionalExpression → `false` ; 82:5 ConditionalExpression → `false` |
| GAP82 | `packages/core/src/digest/callback.ts` | `base64UrlToUuid` | 6 | 168:7 ConditionalExpression → `false` ; 168:19 StringLiteral → ```` |
| GAP83 | `packages/core/src/digest/digest.ts` | `renderDigestWithBrief` | 6 | 436:60 ArrayDeclaration → `["Stryker was here"]` ; 446:9 EqualityOperator → `message.text.length < MESSAGE_MAX_CHARS` |
| GAP84 | `packages/core/src/digest/local-time.ts` | `lateMin` | 6 | 202:7 EqualityOperator → `toMs < fromMs` ; 204:7 ConditionalExpression → `true` |
| GAP85 | `packages/core/src/digest/review.ts` | `renderListed` | 6 | 45:7 StringLiteral → `"Stryker was here!"` ; 49:9 ConditionalExpression → `true` |
| GAP86 | `packages/core/src/loops/replies.ts` | `isAutoReply` | 6 | 90:55 StringLiteral → `"Stryker was here!"` ; 93:43 StringLiteral → `"Stryker was here!"` |
| GAP87 | `packages/core/src/notices/views.ts` | `trustUrl` | 6 | 360:13 BlockStatement → `{}` ; 361:14 BooleanLiteral → `true` |
| GAP88 | `packages/core/src/outgoing/message.ts` | `uniqueIds` | 6 | 91:22 MethodExpression → `ids` ; 91:55 ConditionalExpression → `true` |
| GAP89 | `packages/core/src/replies/digits.ts` | `numberKeys` | 6 | 200:26 ArrayDeclaration → `["Stryker was here"]` ; 201:15 StringLiteral → `"Stryker was here!"` |
| GAP90 | `packages/core/src/sim/live/env-guard.ts` | `sendAddressesAllowed` | 6 | 32:61 MethodExpression → `address` ; 33:10 MethodExpression → `(raw ?? "").split(",").map(entry => entry.trim().toLowerCase())` |
| GAP91 | `packages/core/src/sim/sent-manifest.ts` | `byId` | 6 | 54:57 EqualityOperator → `a.id <= b.id` ; 54:57 EqualityOperator → `a.id >= b.id` |
| GAP92 | `packages/core/src/sim/sent-slot.ts` | `labelIssues` | 6 | 34:60 StringLiteral → `""` ; 34:67 StringLiteral → `""` |
| GAP93 | `packages/core/src/sim/slot.ts` | `(module level)` | 6 | 72:13 StringLiteral → `""` ; 72:30 StringLiteral → `""` |
| GAP94 | `packages/core/src/testmail/batch.ts` | `(module level)` | 6 | 37:22 ObjectLiteral → `{}` ; 37:30 StringLiteral → `""` |
| GAP95 | `packages/core/src/texts/approvals.ts` | `rejected` | 6 | 185:53 ConditionalExpression → `true` ; 185:76 StringLiteral → ```` |
| GAP96 | `packages/core/src/texts/notices.ts` | `loops` | 6 | 540:55 ConditionalExpression → `true` ; 540:55 ConditionalExpression → `false` |
| GAP97 | `packages/core/src/triage/suspicious.ts` | `isLookalike` | 6 | 330:101 ArrayDeclaration → `["Stryker was here"]` ; 332:7 ConditionalExpression → `false` |
| GAP98 | `packages/core/src/triage/suspicious.ts` | `foldName` | 6 | 393:10 MethodExpression → `name.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replaceAll("ł", "l").replaceAll("đ", "d").replaceAll("ø", "o").replace(/\s+/g, " ")` ; 393:10 MethodExpression → `name.normalize("NFKD").replace(/\p{M}+/gu, "").toUpperCase()` |
| GAP99 | `packages/core/src/changelog.ts` | `semverParts` | 5 | 38:7 ConditionalExpression → `false` ; 38:39 StringLiteral → ```` |
| GAP100 | `packages/core/src/contacts/suggestions.ts` | `byRank` | 5 | 152:6 EqualityOperator → `a.candidate.key <= b.candidate.key` ; 152:47 ConditionalExpression → `true` |
| GAP101 | `packages/core/src/digest/digest.ts` | `renderDigestMinimal` | 5 | 232:7 ConditionalExpression → `true` ; 232:7 EqualityOperator → `facts.mailboxProblems >= 0` |
| GAP102 | `packages/core/src/digest/digest.ts` | `briefOptions` | 5 | 295:9 ConditionalExpression → `false` ; 295:9 ConditionalExpression → `true` |
| GAP103 | `packages/core/src/digest/schedule.ts` | `dueDigestSlot` | 5 | 54:37 EqualityOperator → `key >= lateKey` ; 54:72 ConditionalExpression → `false` |
| GAP104 | `packages/core/src/mail/providers.ts` | `presetForAddress` | 5 | 77:7 ConditionalExpression → `false` ; 77:7 EqualityOperator → `at <= 0` |
| GAP105 | `packages/core/src/metrics/fixtures.ts` | `hiddenMoveRow` | 5 | 57:21 StringLiteral → `""` ; 58:25 StringLiteral → `""` |
| GAP106 | `packages/core/src/outgoing/report-mail.ts` | `isLinkOfBase` | 5 | 49:33 Regex → `/\/$/` ; 50:7 ConditionalExpression → `false` |
| GAP107 | `packages/core/src/send-limits.ts` | `windowUntil` | 5 | 40:7 ConditionalExpression → `false` ; 41:17 MethodExpression → `counted.map(startedAt => startedAt.getTime())` |
| GAP108 | `packages/core/src/sim/checks.ts` | `wordCount` | 5 | 74:10 MethodExpression → `text.split(/\s+/)` ; 74:21 Regex → `/\s/` |
| GAP109 | `packages/core/src/sim/hard-cases.ts` | `(module level)` | 5 | 175:11 ArrayDeclaration → `[]` ; 176:13 ObjectLiteral → `{}` |
| GAP110 | `packages/core/src/sim/live/calendar-days.ts` | `formatDay` | 5 | 29:77 BlockStatement → `{}` ; 30:10 StringLiteral → ```` |
| GAP111 | `packages/core/src/sim/live/message.ts` | `parseLabMessageId` | 5 | 47:19 MethodExpression → `raw` ; 48:21 LogicalOperator → `trimmed.startsWith("<") \\|\\| trimmed.endsWith(">")` |
| GAP112 | `packages/core/src/sim/manifest.ts` | `freezeIssues` | 5 | 130:26 StringLiteral → ```` ; 139:50 StringLiteral → ```` |
| GAP113 | `packages/core/src/sim/sent-checks.ts` | `wordCount` | 5 | 53:10 MethodExpression → `text.split(/\s+/)` ; 53:21 Regex → `/\s/` |
| GAP114 | `packages/core/src/sim/sent-checks.ts` | `checkSentCase` | 5 | 85:44 ConditionalExpression → `true` ; 85:58 StringLiteral → `"Stryker was here!"` |
| GAP115 | `packages/core/src/testmail/blind.ts` | `(module level)` | 5 | 37:22 ObjectLiteral → `{}` ; 37:30 StringLiteral → `""` |
| GAP116 | `packages/core/src/testmail/plan.ts` | `planSends` | 5 | 41:37 ObjectLiteral → `{}` ; 41:45 StringLiteral → `""` |
| GAP117 | `packages/core/src/texts/notices.ts` | `staysInAiFolder` | 5 | 254:67 StringLiteral → `""` ; 452:9 ConditionalExpression → `false` |
| GAP118 | `packages/core/src/texts/notices.ts` | `cost` | 5 | 356:118 ConditionalExpression → `true` ; 356:149 StringLiteral → `""` |
| GAP119 | `packages/core/src/triage/eval-case.ts` | `byId` | 5 | 73:10 EqualityOperator → `a.id <= b.id` ; 73:29 ConditionalExpression → `true` |
| GAP120 | `packages/core/src/triage/payloads.ts` | `sendPayloadFor` | 5 | 134:7 ConditionalExpression → `true` ; 135:7 ConditionalExpression → `true` |
| GAP121 | `packages/core/src/triage/suspicious.ts` | `domainOfAddress` | 5 | 254:7 ConditionalExpression → `false` ; 254:7 EqualityOperator → `at <= 0` |
| GAP122 | `packages/core/src/web/csp.ts` | `parseDirectives` | 5 | 41:10 MethodExpression → `content.split(";").map(part => part.trim())` ; 44:23 ConditionalExpression → `true` |

### Not read (497)

| Item | Keys | Flags |
| --- | --- | --- |
| `packages/core/src/notices/encode.test.ts:100` | `packages/core/src/notices/encode.test.ts:100` | S2 |
| `packages/core/src/notices/encode.test.ts:104` | `packages/core/src/notices/encode.test.ts:104` | S2 |
| B5 | `packages/core/src/digest/answered-check.test.ts:109`, `packages/core/src/features.test.ts:128` | S5 |
| B6 | `packages/core/src/digest/callback-loop.test.ts:88`, `packages/core/src/digest/callback.test.ts:42`, `packages/core/src/digest/callback.test.ts:73`, `packages/core/src/digest/callback.test.ts:98`, `packages/core/src/digest/callback.test.ts:143`, `packages/core/src/digest/callback.test.ts:173` | S5 |
| T18 | `packages/core/src/digest/ai-text.test.ts:17`, `packages/core/src/digest/ai-text.test.ts:21`, `packages/core/src/digest/ai-text.test.ts:27` | S6 |
| T19 | `packages/core/src/digest/llm-pause.test.ts:10`, `packages/core/src/digest/llm-pause.test.ts:17`, `packages/core/src/digest/llm-pause.test.ts:24` | S6 |
| T20 | `packages/core/src/digest/local-time.test.ts:62`, `packages/core/src/digest/local-time.test.ts:66`, `packages/core/src/digest/local-time.test.ts:70` | S6 |
| T21 | `packages/core/src/digest/local-time.test.ts:123`, `packages/core/src/digest/local-time.test.ts:127`, `packages/core/src/digest/local-time.test.ts:136` | S6 |
| T22 | `packages/core/src/digest/local-time.test.ts:142`, `packages/core/src/digest/local-time.test.ts:146`, `packages/core/src/digest/local-time.test.ts:160`, `packages/core/src/digest/local-time.test.ts:164` | S6 |
| T23 | `packages/core/src/digest/schedule.test.ts:43`, `packages/core/src/digest/schedule.test.ts:56`, `packages/core/src/digest/schedule.test.ts:64` | S6 |
| T24 | `packages/core/src/digest/text.test.ts:15`, `packages/core/src/digest/text.test.ts:19`, `packages/core/src/digest/text.test.ts:33` | S6 |
| T25 | `packages/core/src/metrics/week.test.ts:9`, `packages/core/src/metrics/week.test.ts:13`, `packages/core/src/metrics/week.test.ts:17` | S6 |
| T26 | `packages/core/src/metrics/week.test.ts:53`, `packages/core/src/metrics/week.test.ts:57`, `packages/core/src/metrics/week.test.ts:61`, `packages/core/src/metrics/week.test.ts:65`, `packages/core/src/metrics/week.test.ts:74` | S6 |
| T27 | `packages/core/src/ops/alert-step.test.ts:19`, `packages/core/src/ops/alert-step.test.ts:23`, `packages/core/src/ops/alert-step.test.ts:27` | S6 |
| T28 | `packages/core/src/ops/alert-step.test.ts:31`, `packages/core/src/ops/alert-step.test.ts:35`, `packages/core/src/ops/alert-step.test.ts:39` | S6 |
| T29 | `packages/core/src/ops/alert-step.test.ts:43`, `packages/core/src/ops/alert-step.test.ts:47`, `packages/core/src/ops/alert-step.test.ts:51`, `packages/core/src/ops/alert-step.test.ts:55`, `packages/core/src/ops/alert-step.test.ts:59` | S6 |
| T30 | `packages/core/src/outgoing/user-text.test.ts:6`, `packages/core/src/outgoing/user-text.test.ts:14`, `packages/core/src/outgoing/user-text.test.ts:18`, `packages/core/src/outgoing/user-text.test.ts:22`, `packages/core/src/outgoing/user-text.test.ts:26` | S6 |
| T31 | `packages/core/src/replies/checks.test.ts:58`, `packages/core/src/replies/checks.test.ts:193`, `packages/core/src/replies/checks.test.ts:239`, `packages/core/src/replies/checks.test.ts:395`, `packages/core/src/replies/checks.test.ts:523` | S6 |
| T32 | `packages/core/src/site.test.ts:6`, `packages/core/src/site.test.ts:10`, `packages/core/src/site.test.ts:14`, `packages/core/src/site.test.ts:18`, `packages/core/src/site.test.ts:52` | S6 |
| T33 | `packages/core/src/triage/cost.test.ts:6`, `packages/core/src/triage/cost.test.ts:10`, `packages/core/src/triage/cost.test.ts:14`, `packages/core/src/triage/cost.test.ts:18` | S6 |
| T34 | `packages/core/src/triage/untrusted-text.test.ts:6`, `packages/core/src/triage/untrusted-text.test.ts:36`, `packages/core/src/triage/untrusted-text.test.ts:41`, `packages/core/src/triage/untrusted-text.test.ts:65` | S6 |
| T35 | `packages/core/src/triage/untrusted-text.test.ts:17`, `packages/core/src/triage/untrusted-text.test.ts:53`, `packages/core/src/triage/untrusted-text.test.ts:57`, `packages/core/src/triage/untrusted-text.test.ts:61` | S6 |
| T36 | `packages/core/src/trust/history.test.ts:20`, `packages/core/src/trust/history.test.ts:23`, `packages/core/src/trust/history.test.ts:26` | S6 |
| T37 | `packages/core/src/web/csp.test.ts:28`, `packages/core/src/web/csp.test.ts:31`, `packages/core/src/web/csp.test.ts:34`, `packages/core/src/web/csp.test.ts:47`, `packages/core/src/web/csp.test.ts:52`, `packages/core/src/web/csp.test.ts:57` | S6 |
| T38 | `packages/core/src/web/errors.test.ts:19`, `packages/core/src/web/errors.test.ts:33`, `packages/core/src/web/errors.test.ts:37`, `packages/core/src/web/errors.test.ts:41` | S6 |
| `packages/core/src/contacts/address.test.ts:41` | `packages/core/src/contacts/address.test.ts:41` | S11 |
| `packages/core/src/contacts/address.test.ts:52` | `packages/core/src/contacts/address.test.ts:52` | S11 |
| `packages/core/src/contacts/address.test.ts:61` | `packages/core/src/contacts/address.test.ts:61` | S11 |
| `packages/core/src/contacts/address.test.ts:67` | `packages/core/src/contacts/address.test.ts:67` | S11 |
| `packages/core/src/contacts/address.test.ts:72` | `packages/core/src/contacts/address.test.ts:72` | S11 |
| `packages/core/src/contacts/address.test.ts:168` | `packages/core/src/contacts/address.test.ts:168` | S11 |
| `packages/core/src/digest/answered-check.test.ts:109` | `packages/core/src/digest/answered-check.test.ts:109` | S11 |
| `packages/core/src/digest/answers.test.ts:10` | `packages/core/src/digest/answers.test.ts:10` | S11 |
| `packages/core/src/digest/approvals-follow-up.test.ts:156` | `packages/core/src/digest/approvals-follow-up.test.ts:156` | S11 |
| `packages/core/src/digest/approvals-follow-up.test.ts:221` | `packages/core/src/digest/approvals-follow-up.test.ts:221` | S11 |
| `packages/core/src/digest/approvals-follow-up.test.ts:225` | `packages/core/src/digest/approvals-follow-up.test.ts:225` | S11 |
| `packages/core/src/digest/approvals-follow-up.test.ts:226` | `packages/core/src/digest/approvals-follow-up.test.ts:226` | S11 |
| `packages/core/src/digest/approvals.test.ts:390` | `packages/core/src/digest/approvals.test.ts:390` | S11 |
| `packages/core/src/digest/local-time.test.ts:32` | `packages/core/src/digest/local-time.test.ts:32` | S11 |
| `packages/core/src/digest/local-time.test.ts:43` | `packages/core/src/digest/local-time.test.ts:43` | S11 |
| `packages/core/src/digest/local-time.test.ts:247` | `packages/core/src/digest/local-time.test.ts:247` | S11 |
| `packages/core/src/digest/notices.test.ts:680` | `packages/core/src/digest/notices.test.ts:680` | S11 |
| `packages/core/src/digest/review.test.ts:93` | `packages/core/src/digest/review.test.ts:93` | S11 |
| `packages/core/src/digest/weekly.test.ts:321` | `packages/core/src/digest/weekly.test.ts:321` | S11 |
| `packages/core/src/digest/weekly.test.ts:383` | `packages/core/src/digest/weekly.test.ts:383` | S11 |
| `packages/core/src/features.test.ts:15` | `packages/core/src/features.test.ts:15` | S11 |
| `packages/core/src/features.test.ts:26` | `packages/core/src/features.test.ts:26` | S11 |
| `packages/core/src/features.test.ts:38` | `packages/core/src/features.test.ts:38` | S11 |
| `packages/core/src/features.test.ts:47` | `packages/core/src/features.test.ts:47` | S11 |
| `packages/core/src/features.test.ts:54` | `packages/core/src/features.test.ts:54` | S11 |
| `packages/core/src/features.test.ts:60` | `packages/core/src/features.test.ts:60` | S11 |
| `packages/core/src/features.test.ts:66` | `packages/core/src/features.test.ts:66` | S11 |
| `packages/core/src/features.test.ts:73` | `packages/core/src/features.test.ts:73` | S11 |
| `packages/core/src/features.test.ts:79` | `packages/core/src/features.test.ts:79` | S11 |
| `packages/core/src/features.test.ts:89` | `packages/core/src/features.test.ts:89` | S11 |
| `packages/core/src/features.test.ts:96` | `packages/core/src/features.test.ts:96` | S11 |
| `packages/core/src/features.test.ts:102` | `packages/core/src/features.test.ts:102` | S11 |
| `packages/core/src/features.test.ts:109` | `packages/core/src/features.test.ts:109` | S11 |
| `packages/core/src/features.test.ts:128` | `packages/core/src/features.test.ts:128` | S11 |
| `packages/core/src/features.test.ts:134` | `packages/core/src/features.test.ts:134` | S11 |
| `packages/core/src/legal/data-categories.test.ts:6` | `packages/core/src/legal/data-categories.test.ts:6` | S11 |
| `packages/core/src/legal/data-categories.test.ts:11` | `packages/core/src/legal/data-categories.test.ts:11` | S11 |
| `packages/core/src/legal/data-categories.test.ts:24` | `packages/core/src/legal/data-categories.test.ts:24` | S11 |
| `packages/core/src/legal/data-categories.test.ts:49` | `packages/core/src/legal/data-categories.test.ts:49` | S11 |
| `packages/core/src/legal/data-categories.test.ts:55` | `packages/core/src/legal/data-categories.test.ts:55` | S11 |
| `packages/core/src/legal/data-categories.test.ts:60` | `packages/core/src/legal/data-categories.test.ts:60` | S11 |
| `packages/core/src/legal/subprocessors.test.ts:6` | `packages/core/src/legal/subprocessors.test.ts:6` | S11 |
| `packages/core/src/legal/subprocessors.test.ts:11` | `packages/core/src/legal/subprocessors.test.ts:11` | S11 |
| `packages/core/src/legal/subprocessors.test.ts:25` | `packages/core/src/legal/subprocessors.test.ts:25` | S11 |
| `packages/core/src/legal/subprocessors.test.ts:34` | `packages/core/src/legal/subprocessors.test.ts:34` | S11 |
| `packages/core/src/llm-roles.test.ts:6` | `packages/core/src/llm-roles.test.ts:6` | S11 |
| `packages/core/src/llm-roles.test.ts:17` | `packages/core/src/llm-roles.test.ts:17` | S11 |
| `packages/core/src/loops/brief.test.ts:93` | `packages/core/src/loops/brief.test.ts:93` | S11 |
| `packages/core/src/loops/dates.test.ts:25` | `packages/core/src/loops/dates.test.ts:25` | S11 |
| `packages/core/src/loops/dates.test.ts:37` | `packages/core/src/loops/dates.test.ts:37` | S11 |
| `packages/core/src/loops/dates.test.ts:47` | `packages/core/src/loops/dates.test.ts:47` | S11 |
| `packages/core/src/loops/dates.test.ts:53` | `packages/core/src/loops/dates.test.ts:53` | S11 |
| `packages/core/src/loops/dates.test.ts:57` | `packages/core/src/loops/dates.test.ts:57` | S11 |
| `packages/core/src/loops/dates.test.ts:62` | `packages/core/src/loops/dates.test.ts:62` | S11 |
| `packages/core/src/loops/dates.test.ts:68` | `packages/core/src/loops/dates.test.ts:68` | S11 |
| `packages/core/src/loops/dates.test.ts:84` | `packages/core/src/loops/dates.test.ts:84` | S11 |
| `packages/core/src/loops/extractor.test.ts:184` | `packages/core/src/loops/extractor.test.ts:184` | S11 |
| `packages/core/src/mail/providers.test.ts:6` | `packages/core/src/mail/providers.test.ts:6` | S11 |
| `packages/core/src/mail/providers.test.ts:13` | `packages/core/src/mail/providers.test.ts:13` | S11 |
| `packages/core/src/mail/sync-folders.test.ts:54` | `packages/core/src/mail/sync-folders.test.ts:54` | S11 |
| `packages/core/src/mail/sync-folders.test.ts:60` | `packages/core/src/mail/sync-folders.test.ts:60` | S11 |
| `packages/core/src/mail/sync-folders.test.ts:66` | `packages/core/src/mail/sync-folders.test.ts:66` | S11 |
| `packages/core/src/metrics/cost-model.test.ts:57` | `packages/core/src/metrics/cost-model.test.ts:57` | S11 |
| `packages/core/src/metrics/m1.test.ts:44` | `packages/core/src/metrics/m1.test.ts:44` | S11 |
| `packages/core/src/metrics/m2.test.ts:57` | `packages/core/src/metrics/m2.test.ts:57` | S11 |
| `packages/core/src/metrics/m4.test.ts:21` | `packages/core/src/metrics/m4.test.ts:21` | S11 |
| `packages/core/src/metrics/m5.test.ts:44` | `packages/core/src/metrics/m5.test.ts:44` | S11 |
| `packages/core/src/metrics/reply-drafts.test.ts:30` | `packages/core/src/metrics/reply-drafts.test.ts:30` | S11 |
| `packages/core/src/metrics/week-stats.test.ts:106` | `packages/core/src/metrics/week-stats.test.ts:106` | S11 |
| `packages/core/src/metrics/week.test.ts:23` | `packages/core/src/metrics/week.test.ts:23` | S11 |
| `packages/core/src/metrics/week.test.ts:29` | `packages/core/src/metrics/week.test.ts:29` | S11 |
| `packages/core/src/metrics/week.test.ts:36` | `packages/core/src/metrics/week.test.ts:36` | S11 |
| `packages/core/src/notices/digest-view.test.ts:12` | `packages/core/src/notices/digest-view.test.ts:12` | S11 |
| `packages/core/src/notices/digest-view.test.ts:19` | `packages/core/src/notices/digest-view.test.ts:19` | S11 |
| `packages/core/src/notices/digest-view.test.ts:35` | `packages/core/src/notices/digest-view.test.ts:35` | S11 |
| `packages/core/src/notices/digest-view.test.ts:42` | `packages/core/src/notices/digest-view.test.ts:42` | S11 |
| `packages/core/src/notices/encode.test.ts:32` | `packages/core/src/notices/encode.test.ts:32` | S11 |
| `packages/core/src/notices/encode.test.ts:42` | `packages/core/src/notices/encode.test.ts:42` | S11 |
| `packages/core/src/notices/encode.test.ts:100` | `packages/core/src/notices/encode.test.ts:100` | S11 |
| `packages/core/src/notices/encode.test.ts:104` | `packages/core/src/notices/encode.test.ts:104` | S11 |
| `packages/core/src/notices/encode.test.ts:130` | `packages/core/src/notices/encode.test.ts:130` | S11 |
| `packages/core/src/notices/push.test.ts:41` | `packages/core/src/notices/push.test.ts:41` | S11 |
| `packages/core/src/notices/push.test.ts:55` | `packages/core/src/notices/push.test.ts:55` | S11 |
| `packages/core/src/notices/push.test.ts:61` | `packages/core/src/notices/push.test.ts:61` | S11 |
| `packages/core/src/notices/registry.test.ts:350` | `packages/core/src/notices/registry.test.ts:350` | S11 |
| `packages/core/src/notices/registry.test.ts:356` | `packages/core/src/notices/registry.test.ts:356` | S11 |
| `packages/core/src/notices/registry.test.ts:364` | `packages/core/src/notices/registry.test.ts:364` | S11 |
| `packages/core/src/notices/registry.test.ts:370` | `packages/core/src/notices/registry.test.ts:370` | S11 |
| `packages/core/src/notices/registry.test.ts:376` | `packages/core/src/notices/registry.test.ts:376` | S11 |
| `packages/core/src/notices/registry.test.ts:407` | `packages/core/src/notices/registry.test.ts:407` | S11 |
| `packages/core/src/notices/registry.test.ts:418` | `packages/core/src/notices/registry.test.ts:418` | S11 |
| `packages/core/src/notices/registry.test.ts:468` | `packages/core/src/notices/registry.test.ts:468` | S11 |
| `packages/core/src/notices/registry.test.ts:505` | `packages/core/src/notices/registry.test.ts:505` | S11 |
| `packages/core/src/notices/registry.test.ts:545` | `packages/core/src/notices/registry.test.ts:545` | S11 |
| `packages/core/src/notices/registry.test.ts:659` | `packages/core/src/notices/registry.test.ts:659` | S11 |
| `packages/core/src/notices/reply-views.test.ts:14` | `packages/core/src/notices/reply-views.test.ts:14` | S11 |
| `packages/core/src/notices/reply-views.test.ts:23` | `packages/core/src/notices/reply-views.test.ts:23` | S11 |
| `packages/core/src/notices/reply-views.test.ts:34` | `packages/core/src/notices/reply-views.test.ts:34` | S11 |
| `packages/core/src/notices/reply-views.test.ts:38` | `packages/core/src/notices/reply-views.test.ts:38` | S11 |
| `packages/core/src/notices/reply-views.test.ts:47` | `packages/core/src/notices/reply-views.test.ts:47` | S11 |
| `packages/core/src/notices/reply-views.test.ts:53` | `packages/core/src/notices/reply-views.test.ts:53` | S11 |
| `packages/core/src/notices/reply-views.test.ts:59` | `packages/core/src/notices/reply-views.test.ts:59` | S11 |
| `packages/core/src/notices/routes.test.ts:113` | `packages/core/src/notices/routes.test.ts:113` | S11 |
| `packages/core/src/replies/checks.test.ts:231` | `packages/core/src/replies/checks.test.ts:231` | S11 |
| `packages/core/src/replies/digits.test.ts:763` | `packages/core/src/replies/digits.test.ts:763` | S11 |
| `packages/core/src/security-log.test.ts:6` | `packages/core/src/security-log.test.ts:6` | S11 |
| `packages/core/src/sim/audit.test.ts:83` | `packages/core/src/sim/audit.test.ts:83` | S11 |
| `packages/core/src/sim/files.test.ts:25` | `packages/core/src/sim/files.test.ts:25` | S11 |
| `packages/core/src/sim/files.test.ts:41` | `packages/core/src/sim/files.test.ts:41` | S11 |
| `packages/core/src/sim/hard-cases.test.ts:31` | `packages/core/src/sim/hard-cases.test.ts:31` | S11 |
| `packages/core/src/sim/hard-cases.test.ts:39` | `packages/core/src/sim/hard-cases.test.ts:39` | S11 |
| `packages/core/src/sim/hard-cases.test.ts:46` | `packages/core/src/sim/hard-cases.test.ts:46` | S11 |
| `packages/core/src/sim/hard-cases.test.ts:57` | `packages/core/src/sim/hard-cases.test.ts:57` | S11 |
| `packages/core/src/sim/hard-cases.test.ts:64` | `packages/core/src/sim/hard-cases.test.ts:64` | S11 |
| `packages/core/src/sim/hard-cases.test.ts:78` | `packages/core/src/sim/hard-cases.test.ts:78` | S11 |
| `packages/core/src/sim/hard-cases.test.ts:87` | `packages/core/src/sim/hard-cases.test.ts:87` | S11 |
| `packages/core/src/sim/live/env-guard.test.ts:43` | `packages/core/src/sim/live/env-guard.test.ts:43` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:38` | `packages/core/src/sim/plan-bank.test.ts:38` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:42` | `packages/core/src/sim/plan-bank.test.ts:42` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:53` | `packages/core/src/sim/plan-bank.test.ts:53` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:59` | `packages/core/src/sim/plan-bank.test.ts:59` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:73` | `packages/core/src/sim/plan-bank.test.ts:73` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:83` | `packages/core/src/sim/plan-bank.test.ts:83` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:100` | `packages/core/src/sim/plan-bank.test.ts:100` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:122` | `packages/core/src/sim/plan-bank.test.ts:122` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:136` | `packages/core/src/sim/plan-bank.test.ts:136` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:146` | `packages/core/src/sim/plan-bank.test.ts:146` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:157` | `packages/core/src/sim/plan-bank.test.ts:157` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:163` | `packages/core/src/sim/plan-bank.test.ts:163` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:179` | `packages/core/src/sim/plan-bank.test.ts:179` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:191` | `packages/core/src/sim/plan-bank.test.ts:191` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:208` | `packages/core/src/sim/plan-bank.test.ts:208` | S11 |
| `packages/core/src/sim/plan-bank.test.ts:227` | `packages/core/src/sim/plan-bank.test.ts:227` | S11 |
| `packages/core/src/sim/plan-sent.test.ts:32` | `packages/core/src/sim/plan-sent.test.ts:32` | S11 |
| `packages/core/src/sim/plan-sent.test.ts:54` | `packages/core/src/sim/plan-sent.test.ts:54` | S11 |
| `packages/core/src/sim/plan-sent.test.ts:59` | `packages/core/src/sim/plan-sent.test.ts:59` | S11 |
| `packages/core/src/sim/plan-sent.test.ts:72` | `packages/core/src/sim/plan-sent.test.ts:72` | S11 |
| `packages/core/src/sim/plan-sent.test.ts:86` | `packages/core/src/sim/plan-sent.test.ts:86` | S11 |
| `packages/core/src/sim/plan-sent.test.ts:100` | `packages/core/src/sim/plan-sent.test.ts:100` | S11 |
| `packages/core/src/sim/plan-sent.test.ts:106` | `packages/core/src/sim/plan-sent.test.ts:106` | S11 |
| `packages/core/src/sim/plan-sent.test.ts:113` | `packages/core/src/sim/plan-sent.test.ts:113` | S11 |
| `packages/core/src/sim/plan-sent.test.ts:132` | `packages/core/src/sim/plan-sent.test.ts:132` | S11 |
| `packages/core/src/sim/plan-sent.test.ts:155` | `packages/core/src/sim/plan-sent.test.ts:155` | S11 |
| `packages/core/src/sim/plan-sent.test.ts:171` | `packages/core/src/sim/plan-sent.test.ts:171` | S11 |
| `packages/core/src/sim/plan-sent.test.ts:183` | `packages/core/src/sim/plan-sent.test.ts:183` | S11 |
| `packages/core/src/sim/plan-week.test.ts:45` | `packages/core/src/sim/plan-week.test.ts:45` | S11 |
| `packages/core/src/sim/plan-week.test.ts:51` | `packages/core/src/sim/plan-week.test.ts:51` | S11 |
| `packages/core/src/sim/plan-week.test.ts:68` | `packages/core/src/sim/plan-week.test.ts:68` | S11 |
| `packages/core/src/sim/plan-week.test.ts:95` | `packages/core/src/sim/plan-week.test.ts:95` | S11 |
| `packages/core/src/sim/plan-week.test.ts:113` | `packages/core/src/sim/plan-week.test.ts:113` | S11 |
| `packages/core/src/sim/plan-week.test.ts:130` | `packages/core/src/sim/plan-week.test.ts:130` | S11 |
| `packages/core/src/sim/plan-week.test.ts:151` | `packages/core/src/sim/plan-week.test.ts:151` | S11 |
| `packages/core/src/sim/plan-week.test.ts:168` | `packages/core/src/sim/plan-week.test.ts:168` | S11 |
| `packages/core/src/sim/plan-week.test.ts:182` | `packages/core/src/sim/plan-week.test.ts:182` | S11 |
| `packages/core/src/sim/plan-week.test.ts:191` | `packages/core/src/sim/plan-week.test.ts:191` | S11 |
| `packages/core/src/sim/plan-week.test.ts:200` | `packages/core/src/sim/plan-week.test.ts:200` | S11 |
| `packages/core/src/sim/plan-week.test.ts:210` | `packages/core/src/sim/plan-week.test.ts:210` | S11 |
| `packages/core/src/sim/plan-week.test.ts:223` | `packages/core/src/sim/plan-week.test.ts:223` | S11 |
| `packages/core/src/sim/plan-week.test.ts:231` | `packages/core/src/sim/plan-week.test.ts:231` | S11 |
| `packages/core/src/sim/random.test.ts:6` | `packages/core/src/sim/random.test.ts:6` | S11 |
| `packages/core/src/sim/random.test.ts:12` | `packages/core/src/sim/random.test.ts:12` | S11 |
| `packages/core/src/sim/random.test.ts:30` | `packages/core/src/sim/random.test.ts:30` | S11 |
| `packages/core/src/sim/random.test.ts:38` | `packages/core/src/sim/random.test.ts:38` | S11 |
| `packages/core/src/sim/random.test.ts:46` | `packages/core/src/sim/random.test.ts:46` | S11 |
| `packages/core/src/sim/scenario.test.ts:22` | `packages/core/src/sim/scenario.test.ts:22` | S11 |
| `packages/core/src/sim/sent-hard-cases.test.ts:6` | `packages/core/src/sim/sent-hard-cases.test.ts:6` | S11 |
| `packages/core/src/sim/sent-hard-cases.test.ts:45` | `packages/core/src/sim/sent-hard-cases.test.ts:45` | S11 |
| `packages/core/src/sim/sent-slot.test.ts:37` | `packages/core/src/sim/sent-slot.test.ts:37` | S11 |
| `packages/core/src/sim/sent-slot.test.ts:91` | `packages/core/src/sim/sent-slot.test.ts:91` | S11 |
| `packages/core/src/sim/sent-slot.test.ts:99` | `packages/core/src/sim/sent-slot.test.ts:99` | S11 |
| `packages/core/src/sim/sent-slot.test.ts:104` | `packages/core/src/sim/sent-slot.test.ts:104` | S11 |
| `packages/core/src/site.test.ts:63` | `packages/core/src/site.test.ts:63` | S11 |
| `packages/core/src/tenancy.test.ts:6` | `packages/core/src/tenancy.test.ts:6` | S11 |
| `packages/core/src/tenancy.test.ts:11` | `packages/core/src/tenancy.test.ts:11` | S11 |
| `packages/core/src/tenancy.test.ts:18` | `packages/core/src/tenancy.test.ts:18` | S11 |
| `packages/core/src/testmail/batch.test.ts:156` | `packages/core/src/testmail/batch.test.ts:156` | S11 |
| `packages/core/src/testmail/batch.test.ts:180` | `packages/core/src/testmail/batch.test.ts:180` | S11 |
| `packages/core/src/testmail/batch.test.ts:195` | `packages/core/src/testmail/batch.test.ts:195` | S11 |
| `packages/core/src/testmail/target.test.ts:235` | `packages/core/src/testmail/target.test.ts:235` | S11 |
| `packages/core/src/texts/bot.test.ts:22` | `packages/core/src/texts/bot.test.ts:22` | S11 |
| `packages/core/src/texts/bot.test.ts:37` | `packages/core/src/texts/bot.test.ts:37` | S11 |
| `packages/core/src/texts/bot.test.ts:55` | `packages/core/src/texts/bot.test.ts:55` | S11 |
| `packages/core/src/texts/bot.test.ts:66` | `packages/core/src/texts/bot.test.ts:66` | S11 |
| `packages/core/src/texts/bot.test.ts:73` | `packages/core/src/texts/bot.test.ts:73` | S11 |
| `packages/core/src/texts/bot.test.ts:86` | `packages/core/src/texts/bot.test.ts:86` | S11 |
| `packages/core/src/texts/bot.test.ts:209` | `packages/core/src/texts/bot.test.ts:209` | S11 |
| `packages/core/src/texts/bot.test.ts:227` | `packages/core/src/texts/bot.test.ts:227` | S11 |
| `packages/core/src/texts/bot.test.ts:238` | `packages/core/src/texts/bot.test.ts:238` | S11 |
| `packages/core/src/texts/brief.test.ts:45` | `packages/core/src/texts/brief.test.ts:45` | S11 |
| `packages/core/src/texts/index.test.ts:101` | `packages/core/src/texts/index.test.ts:101` | S11 |
| `packages/core/src/texts/index.test.ts:139` | `packages/core/src/texts/index.test.ts:139` | S11 |
| `packages/core/src/time.test.ts:6` | `packages/core/src/time.test.ts:6` | S11 |
| `packages/core/src/time.test.ts:13` | `packages/core/src/time.test.ts:13` | S11 |
| `packages/core/src/time.test.ts:23` | `packages/core/src/time.test.ts:23` | S11 |
| `packages/core/src/time.test.ts:32` | `packages/core/src/time.test.ts:32` | S11 |
| `packages/core/src/triage/analysis.test.ts:19` | `packages/core/src/triage/analysis.test.ts:19` | S11 |
| `packages/core/src/triage/analysis.test.ts:23` | `packages/core/src/triage/analysis.test.ts:23` | S11 |
| `packages/core/src/triage/analysis.test.ts:28` | `packages/core/src/triage/analysis.test.ts:28` | S11 |
| `packages/core/src/triage/analysis.test.ts:33` | `packages/core/src/triage/analysis.test.ts:33` | S11 |
| `packages/core/src/triage/analysis.test.ts:37` | `packages/core/src/triage/analysis.test.ts:37` | S11 |
| `packages/core/src/triage/analysis.test.ts:41` | `packages/core/src/triage/analysis.test.ts:41` | S11 |
| `packages/core/src/triage/analysis.test.ts:48` | `packages/core/src/triage/analysis.test.ts:48` | S11 |
| `packages/core/src/triage/analysis.test.ts:53` | `packages/core/src/triage/analysis.test.ts:53` | S11 |
| `packages/core/src/triage/analysis.test.ts:61` | `packages/core/src/triage/analysis.test.ts:61` | S11 |
| `packages/core/src/triage/analysis.test.ts:67` | `packages/core/src/triage/analysis.test.ts:67` | S11 |
| `packages/core/src/triage/cost.test.ts:32` | `packages/core/src/triage/cost.test.ts:32` | S11 |
| `packages/core/src/triage/cost.test.ts:51` | `packages/core/src/triage/cost.test.ts:51` | S11 |
| `packages/core/src/triage/dkim-signature.test.ts:92` | `packages/core/src/triage/dkim-signature.test.ts:92` | S11 |
| `packages/core/src/triage/draft-kinds.test.ts:24` | `packages/core/src/triage/draft-kinds.test.ts:24` | S11 |
| `packages/core/src/triage/draft-kinds.test.ts:72` | `packages/core/src/triage/draft-kinds.test.ts:72` | S11 |
| `packages/core/src/triage/draft-kinds.test.ts:94` | `packages/core/src/triage/draft-kinds.test.ts:94` | S11 |
| `packages/core/src/triage/eval-case.test.ts:123` | `packages/core/src/triage/eval-case.test.ts:123` | S11 |
| `packages/core/src/triage/eval-case.test.ts:133` | `packages/core/src/triage/eval-case.test.ts:133` | S11 |
| `packages/core/src/triage/eval-case.test.ts:149` | `packages/core/src/triage/eval-case.test.ts:149` | S11 |
| `packages/core/src/triage/eval-case.test.ts:158` | `packages/core/src/triage/eval-case.test.ts:158` | S11 |
| `packages/core/src/triage/eval-case.test.ts:162` | `packages/core/src/triage/eval-case.test.ts:162` | S11 |
| `packages/core/src/triage/eval-case.test.ts:166` | `packages/core/src/triage/eval-case.test.ts:166` | S11 |
| `packages/core/src/triage/payloads.test.ts:39` | `packages/core/src/triage/payloads.test.ts:39` | S11 |
| `packages/core/src/triage/payloads.test.ts:43` | `packages/core/src/triage/payloads.test.ts:43` | S11 |
| `packages/core/src/triage/payloads.test.ts:49` | `packages/core/src/triage/payloads.test.ts:49` | S11 |
| `packages/core/src/triage/payloads.test.ts:56` | `packages/core/src/triage/payloads.test.ts:56` | S11 |
| `packages/core/src/triage/payloads.test.ts:98` | `packages/core/src/triage/payloads.test.ts:98` | S11 |
| `packages/core/src/triage/payloads.test.ts:104` | `packages/core/src/triage/payloads.test.ts:104` | S11 |
| `packages/core/src/triage/planners.test.ts:162` | `packages/core/src/triage/planners.test.ts:162` | S11 |
| `packages/core/src/triage/planners.test.ts:279` | `packages/core/src/triage/planners.test.ts:279` | S11 |
| `packages/core/src/triage/policy.test.ts:180` | `packages/core/src/triage/policy.test.ts:180` | S11 |
| `packages/core/src/triage/quota-day.test.ts:10` | `packages/core/src/triage/quota-day.test.ts:10` | S11 |
| `packages/core/src/triage/sender-history.test.ts:8` | `packages/core/src/triage/sender-history.test.ts:8` | S11 |
| `packages/core/src/triage/sender-history.test.ts:12` | `packages/core/src/triage/sender-history.test.ts:12` | S11 |
| `packages/core/src/triage/sender-history.test.ts:16` | `packages/core/src/triage/sender-history.test.ts:16` | S11 |
| `packages/core/src/triage/sender-history.test.ts:21` | `packages/core/src/triage/sender-history.test.ts:21` | S11 |
| `packages/core/src/triage/sender-history.test.ts:49` | `packages/core/src/triage/sender-history.test.ts:49` | S11 |
| `packages/core/src/triage/sender-history.test.ts:74` | `packages/core/src/triage/sender-history.test.ts:74` | S11 |
| `packages/core/src/triage/settings.test.ts:9` | `packages/core/src/triage/settings.test.ts:9` | S11 |
| `packages/core/src/triage/suspicious.test.ts:295` | `packages/core/src/triage/suspicious.test.ts:295` | S11 |
| `packages/core/src/triage/suspicious.test.ts:343` | `packages/core/src/triage/suspicious.test.ts:343` | S11 |
| `packages/core/src/triage/urgency-profile.test.ts:6` | `packages/core/src/triage/urgency-profile.test.ts:6` | S11 |
| `packages/core/src/triage/urgency-profile.test.ts:10` | `packages/core/src/triage/urgency-profile.test.ts:10` | S11 |
| `packages/core/src/triage/urgency-profile.test.ts:18` | `packages/core/src/triage/urgency-profile.test.ts:18` | S11 |
| `packages/core/src/triage/urgency-profile.test.ts:29` | `packages/core/src/triage/urgency-profile.test.ts:29` | S11 |
| `packages/core/src/trust/evidence.test.ts:155` | `packages/core/src/trust/evidence.test.ts:155` | S11 |
| `packages/core/src/web/activity.test.ts:16` | `packages/core/src/web/activity.test.ts:16` | S11 |
| `packages/core/src/web/activity.test.ts:32` | `packages/core/src/web/activity.test.ts:32` | S11 |
| `packages/core/src/web/activity.test.ts:39` | `packages/core/src/web/activity.test.ts:39` | S11 |
| `packages/core/src/web/activity.test.ts:50` | `packages/core/src/web/activity.test.ts:50` | S11 |
| `packages/core/src/web/activity.test.ts:87` | `packages/core/src/web/activity.test.ts:87` | S11 |
| `packages/core/src/web/activity.test.ts:91` | `packages/core/src/web/activity.test.ts:91` | S11 |
| `packages/core/src/web/activity.test.ts:99` | `packages/core/src/web/activity.test.ts:99` | S11 |
| `packages/core/src/web/activity.test.ts:104` | `packages/core/src/web/activity.test.ts:104` | S11 |
| `packages/core/src/web/activity.test.ts:111` | `packages/core/src/web/activity.test.ts:111` | S11 |
| `packages/core/src/web/approvals.test.ts:42` | `packages/core/src/web/approvals.test.ts:42` | S11 |
| `packages/core/src/web/approvals.test.ts:48` | `packages/core/src/web/approvals.test.ts:48` | S11 |
| `packages/core/src/web/approvals.test.ts:58` | `packages/core/src/web/approvals.test.ts:58` | S11 |
| `packages/core/src/web/approvals.test.ts:64` | `packages/core/src/web/approvals.test.ts:64` | S11 |
| `packages/core/src/web/approvals.test.ts:70` | `packages/core/src/web/approvals.test.ts:70` | S11 |
| `packages/core/src/web/errors.test.ts:6` | `packages/core/src/web/errors.test.ts:6` | S11 |
| `packages/core/src/web/errors.test.ts:10` | `packages/core/src/web/errors.test.ts:10` | S11 |
| `packages/core/src/web/errors.test.ts:15` | `packages/core/src/web/errors.test.ts:15` | S11 |
| `packages/core/src/web/errors.test.ts:19` | `packages/core/src/web/errors.test.ts:19` | S11 |
| `packages/core/src/web/errors.test.ts:23` | `packages/core/src/web/errors.test.ts:23` | S11 |
| `packages/core/src/web/errors.test.ts:28` | `packages/core/src/web/errors.test.ts:28` | S11 |
| `packages/core/src/web/errors.test.ts:33` | `packages/core/src/web/errors.test.ts:33` | S11 |
| `packages/core/src/web/errors.test.ts:37` | `packages/core/src/web/errors.test.ts:37` | S11 |
| `packages/core/src/web/errors.test.ts:41` | `packages/core/src/web/errors.test.ts:41` | S11 |
| `packages/core/src/web/loops.test.ts:12` | `packages/core/src/web/loops.test.ts:12` | S11 |
| `packages/core/src/web/loops.test.ts:20` | `packages/core/src/web/loops.test.ts:20` | S11 |
| `packages/core/src/web/loops.test.ts:33` | `packages/core/src/web/loops.test.ts:33` | S11 |
| `packages/core/src/web/loops.test.ts:38` | `packages/core/src/web/loops.test.ts:38` | S11 |
| `packages/core/src/web/loops.test.ts:44` | `packages/core/src/web/loops.test.ts:44` | S11 |
| `packages/core/src/web/loops.test.ts:51` | `packages/core/src/web/loops.test.ts:51` | S11 |
| `packages/core/src/web/mail-oauth.test.ts:7` | `packages/core/src/web/mail-oauth.test.ts:7` | S11 |
| `packages/core/src/web/mail-oauth.test.ts:14` | `packages/core/src/web/mail-oauth.test.ts:14` | S11 |
| `packages/core/src/web/mail-oauth.test.ts:21` | `packages/core/src/web/mail-oauth.test.ts:21` | S11 |
| `packages/core/src/web/mailboxes.test.ts:99` | `packages/core/src/web/mailboxes.test.ts:99` | S11 |
| `packages/core/src/web/mailboxes.test.ts:103` | `packages/core/src/web/mailboxes.test.ts:103` | S11 |
| `packages/core/src/web/mailboxes.test.ts:111` | `packages/core/src/web/mailboxes.test.ts:111` | S11 |
| `packages/core/src/web/mailboxes.test.ts:124` | `packages/core/src/web/mailboxes.test.ts:124` | S11 |
| `packages/core/src/web/me.test.ts:54` | `packages/core/src/web/me.test.ts:54` | S11 |
| `packages/core/src/web/me.test.ts:58` | `packages/core/src/web/me.test.ts:58` | S11 |
| `packages/core/src/web/me.test.ts:64` | `packages/core/src/web/me.test.ts:64` | S11 |
| `packages/core/src/web/me.test.ts:68` | `packages/core/src/web/me.test.ts:68` | S11 |
| `packages/core/src/web/me.test.ts:72` | `packages/core/src/web/me.test.ts:72` | S11 |
| `packages/core/src/web/me.test.ts:83` | `packages/core/src/web/me.test.ts:83` | S11 |
| `packages/core/src/web/me.test.ts:90` | `packages/core/src/web/me.test.ts:90` | S11 |
| `packages/core/src/web/me.test.ts:94` | `packages/core/src/web/me.test.ts:94` | S11 |
| `packages/core/src/web/me.test.ts:99` | `packages/core/src/web/me.test.ts:99` | S11 |
| `packages/core/src/web/notify.test.ts:18` | `packages/core/src/web/notify.test.ts:18` | S11 |
| `packages/core/src/web/organization.test.ts:38` | `packages/core/src/web/organization.test.ts:38` | S11 |
| `packages/core/src/web/organization.test.ts:43` | `packages/core/src/web/organization.test.ts:43` | S11 |
| `packages/core/src/web/organization.test.ts:59` | `packages/core/src/web/organization.test.ts:59` | S11 |
| `packages/core/src/web/organization.test.ts:63` | `packages/core/src/web/organization.test.ts:63` | S11 |
| `packages/core/src/web/password.test.ts:13` | `packages/core/src/web/password.test.ts:13` | S11 |
| `packages/core/src/web/password.test.ts:18` | `packages/core/src/web/password.test.ts:18` | S11 |
| `packages/core/src/web/password.test.ts:23` | `packages/core/src/web/password.test.ts:23` | S11 |
| `packages/core/src/web/password.test.ts:72` | `packages/core/src/web/password.test.ts:72` | S11 |
| `packages/core/src/web/password.test.ts:76` | `packages/core/src/web/password.test.ts:76` | S11 |
| `packages/core/src/web/replies.test.ts:16` | `packages/core/src/web/replies.test.ts:16` | S11 |
| `packages/core/src/web/replies.test.ts:20` | `packages/core/src/web/replies.test.ts:20` | S11 |
| `packages/core/src/web/replies.test.ts:36` | `packages/core/src/web/replies.test.ts:36` | S11 |
| `packages/core/src/web/replies.test.ts:49` | `packages/core/src/web/replies.test.ts:49` | S11 |
| `packages/core/src/web/replies.test.ts:63` | `packages/core/src/web/replies.test.ts:63` | S11 |
| `packages/core/src/web/rules.test.ts:22` | `packages/core/src/web/rules.test.ts:22` | S11 |
| `packages/core/src/web/rules.test.ts:30` | `packages/core/src/web/rules.test.ts:30` | S11 |
| `packages/core/src/web/rules.test.ts:39` | `packages/core/src/web/rules.test.ts:39` | S11 |
| `packages/core/src/web/rules.test.ts:50` | `packages/core/src/web/rules.test.ts:50` | S11 |
| `packages/core/src/web/sender-context.test.ts:8` | `packages/core/src/web/sender-context.test.ts:8` | S11 |
| `packages/core/src/web/sender-context.test.ts:13` | `packages/core/src/web/sender-context.test.ts:13` | S11 |
| `packages/core/src/web/sender-context.test.ts:29` | `packages/core/src/web/sender-context.test.ts:29` | S11 |
| `packages/core/src/web/sender-context.test.ts:33` | `packages/core/src/web/sender-context.test.ts:33` | S11 |
| `packages/core/src/web/sessions.test.ts:37` | `packages/core/src/web/sessions.test.ts:37` | S11 |
| `packages/core/src/web/settings.test.ts:36` | `packages/core/src/web/settings.test.ts:36` | S11 |
| `packages/core/src/web/settings.test.ts:40` | `packages/core/src/web/settings.test.ts:40` | S11 |
| `packages/core/src/web/settings.test.ts:46` | `packages/core/src/web/settings.test.ts:46` | S11 |
| `packages/core/src/web/settings.test.ts:56` | `packages/core/src/web/settings.test.ts:56` | S11 |
| `packages/core/src/web/settings.test.ts:69` | `packages/core/src/web/settings.test.ts:69` | S11 |
| `packages/core/src/web/settings.test.ts:105` | `packages/core/src/web/settings.test.ts:105` | S11 |
| `packages/core/src/web/settings.test.ts:113` | `packages/core/src/web/settings.test.ts:113` | S11 |
| `packages/core/src/web/settings.test.ts:122` | `packages/core/src/web/settings.test.ts:122` | S11 |
| `packages/core/src/web/settings.test.ts:129` | `packages/core/src/web/settings.test.ts:129` | S11 |
| `packages/core/src/web/settings.test.ts:135` | `packages/core/src/web/settings.test.ts:135` | S11 |
| `packages/core/src/web/settings.test.ts:145` | `packages/core/src/web/settings.test.ts:145` | S11 |
| `packages/core/src/web/stats.test.ts:40` | `packages/core/src/web/stats.test.ts:40` | S11 |
| `packages/core/src/web/stats.test.ts:45` | `packages/core/src/web/stats.test.ts:45` | S11 |
| `packages/core/src/web/stats.test.ts:62` | `packages/core/src/web/stats.test.ts:62` | S11 |
| `packages/core/src/web/stats.test.ts:67` | `packages/core/src/web/stats.test.ts:67` | S11 |
| `packages/core/src/web/stats.test.ts:73` | `packages/core/src/web/stats.test.ts:73` | S11 |
| `packages/core/src/web/stats.test.ts:77` | `packages/core/src/web/stats.test.ts:77` | S11 |
| `packages/core/src/web/telegram.test.ts:32` | `packages/core/src/web/telegram.test.ts:32` | S11 |
| `packages/core/src/web/telegram.test.ts:41` | `packages/core/src/web/telegram.test.ts:41` | S11 |
| `packages/core/src/web/terms.test.ts:6` | `packages/core/src/web/terms.test.ts:6` | S11 |
| `packages/core/src/web/terms.test.ts:10` | `packages/core/src/web/terms.test.ts:10` | S11 |
| `packages/core/src/web/terms.test.ts:18` | `packages/core/src/web/terms.test.ts:18` | S11 |
| `packages/core/src/web/terms.test.ts:24` | `packages/core/src/web/terms.test.ts:24` | S11 |
| `packages/core/src/web/terms.test.ts:31` | `packages/core/src/web/terms.test.ts:31` | S11 |
| `packages/core/src/web/terms.test.ts:36` | `packages/core/src/web/terms.test.ts:36` | S11 |
| `packages/core/src/web/two-factor.test.ts:6` | `packages/core/src/web/two-factor.test.ts:6` | S11 |
| `packages/core/src/web/two-factor.test.ts:15` | `packages/core/src/web/two-factor.test.ts:15` | S11 |
| `packages/core/src/web/zod.test.ts:8` | `packages/core/src/web/zod.test.ts:8` | S11 |
| `packages/core/src/changelog.test.ts` (S10 file) | 6 cases of the file | S10 |
| `packages/core/src/contacts/address.test.ts` (S10 file) | 13 cases of the file | S10 |
| `packages/core/src/contacts/pattern.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/contacts/suggestions.test.ts` (S10 file) | 18 cases of the file | S10 |
| `packages/core/src/contacts/wait.test.ts` (S10 file) | 4 cases of the file | S10 |
| `packages/core/src/digest/ai-text.test.ts` (S10 file) | 5 cases of the file | S10 |
| `packages/core/src/digest/answered-check.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/digest/answers.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/digest/approvals-follow-up.test.ts` (S10 file) | 10 cases of the file | S10 |
| `packages/core/src/digest/approvals.test.ts` (S10 file) | 50 cases of the file | S10 |
| `packages/core/src/digest/attachment-line.test.ts` (S10 file) | 7 cases of the file | S10 |
| `packages/core/src/digest/callback-loop.test.ts` (S10 file) | 5 cases of the file | S10 |
| `packages/core/src/digest/callback.test.ts` (S10 file) | 10 cases of the file | S10 |
| `packages/core/src/digest/digest.test.ts` (S10 file) | 39 cases of the file | S10 |
| `packages/core/src/digest/labels.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/digest/llm-pause.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/digest/local-time.test.ts` (S10 file) | 21 cases of the file | S10 |
| `packages/core/src/digest/notices.test.ts` (S10 file) | 36 cases of the file | S10 |
| `packages/core/src/digest/review.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/digest/schedule.test.ts` (S10 file) | 13 cases of the file | S10 |
| `packages/core/src/digest/text.test.ts` (S10 file) | 11 cases of the file | S10 |
| `packages/core/src/digest/undo.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/digest/weekly.test.ts` (S10 file) | 11 cases of the file | S10 |
| `packages/core/src/digest/why-line.test.ts` (S10 file) | 5 cases of the file | S10 |
| `packages/core/src/digest/would-do.test.ts` (S10 file) | 17 cases of the file | S10 |
| `packages/core/src/features.test.ts` (S10 file) | 5 cases of the file | S10 |
| `packages/core/src/loopback.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/loops/brief-keyboard.test.ts` (S10 file) | 8 cases of the file | S10 |
| `packages/core/src/loops/brief.test.ts` (S10 file) | 12 cases of the file | S10 |
| `packages/core/src/loops/dates.test.ts` (S10 file) | 4 cases of the file | S10 |
| `packages/core/src/loops/extractor.test.ts` (S10 file) | 5 cases of the file | S10 |
| `packages/core/src/loops/replies.test.ts` (S10 file) | 19 cases of the file | S10 |
| `packages/core/src/mail/providers.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/mail/sync-folders.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/metrics/cost-model.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/metrics/m1.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/metrics/m2.test.ts` (S10 file) | 9 cases of the file | S10 |
| `packages/core/src/metrics/m3.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/metrics/m5.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/metrics/m7.test.ts` (S10 file) | 5 cases of the file | S10 |
| `packages/core/src/metrics/reply-drafts.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/metrics/week-stats.test.ts` (S10 file) | 4 cases of the file | S10 |
| `packages/core/src/metrics/week.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/notices/detail.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/notices/encode.test.ts` (S10 file) | 5 cases of the file | S10 |
| `packages/core/src/notices/minimal.test.ts` (S10 file) | 15 cases of the file | S10 |
| `packages/core/src/notices/push.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/notices/registry.test.ts` (S10 file) | 26 cases of the file | S10 |
| `packages/core/src/notices/reply-views.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/notices/routes.test.ts` (S10 file) | 11 cases of the file | S10 |
| `packages/core/src/notices/trust.test.ts` (S10 file) | 21 cases of the file | S10 |
| `packages/core/src/outgoing/follow-up.test.ts` (S10 file) | 4 cases of the file | S10 |
| `packages/core/src/outgoing/message.test.ts` (S10 file) | 15 cases of the file | S10 |
| `packages/core/src/outgoing/quote.test.ts` (S10 file) | 7 cases of the file | S10 |
| `packages/core/src/outgoing/report-mail.test.ts` (S10 file) | 5 cases of the file | S10 |
| `packages/core/src/outgoing/sender.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/outgoing/user-text.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/replies/checks.test.ts` (S10 file) | 38 cases of the file | S10 |
| `packages/core/src/replies/copy-key.test.ts` (S10 file) | 6 cases of the file | S10 |
| `packages/core/src/replies/digits.test.ts` (S10 file) | 65 cases of the file | S10 |
| `packages/core/src/replies/eligibility.test.ts` (S10 file) | 8 cases of the file | S10 |
| `packages/core/src/replies/profile.test.ts` (S10 file) | 4 cases of the file | S10 |
| `packages/core/src/replies/quote.test.ts` (S10 file) | 6 cases of the file | S10 |
| `packages/core/src/replies/recipients.test.ts` (S10 file) | 15 cases of the file | S10 |
| `packages/core/src/replies/style-form.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/send-limits.test.ts` (S10 file) | 13 cases of the file | S10 |
| `packages/core/src/sim/audit.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/sim/checks.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/sim/draft-checks.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/sim/files.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/sim/live/bot.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/sim/live/date-shift.test.ts` (S10 file) | 5 cases of the file | S10 |
| `packages/core/src/sim/live/env-guard.test.ts` (S10 file) | 4 cases of the file | S10 |
| `packages/core/src/sim/live/executive.test.ts` (S10 file) | 18 cases of the file | S10 |
| `packages/core/src/sim/live/message.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/sim/live/run-plan.test.ts` (S10 file) | 10 cases of the file | S10 |
| `packages/core/src/sim/plan-bank.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/sim/plan-sent.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/sim/plan-spec.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/sim/plan-week.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/sim/scenario.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/sim/sent-blind.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/sim/sent-checks.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/sim/sent-hard-cases.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/sim/sent-manifest.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/sim/sent-slot.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/sim/slot.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/sim/to-eval-case.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/site.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/testmail/batch.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/testmail/blind.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/testmail/delivery.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/testmail/plan.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/testmail/request.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/testmail/send-log.test.ts` (S10 file) | 9 cases of the file | S10 |
| `packages/core/src/testmail/target.test.ts` (S10 file) | 5 cases of the file | S10 |
| `packages/core/src/texts/bot.test.ts` (S10 file) | 4 cases of the file | S10 |
| `packages/core/src/texts/brief.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/texts/index.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/texts/operator.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/texts/push.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/triage/address.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/triage/cost.test.ts` (S10 file) | 8 cases of the file | S10 |
| `packages/core/src/triage/dkim-pass.test.ts` (S10 file) | 10 cases of the file | S10 |
| `packages/core/src/triage/dkim-signature.test.ts` (S10 file) | 5 cases of the file | S10 |
| `packages/core/src/triage/draft-kinds.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/triage/eval-case.test.ts` (S10 file) | 5 cases of the file | S10 |
| `packages/core/src/triage/metrics.test.ts` (S10 file) | 21 cases of the file | S10 |
| `packages/core/src/triage/payloads.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/triage/planners.test.ts` (S10 file) | 9 cases of the file | S10 |
| `packages/core/src/triage/policy.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/triage/quota-day.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/triage/rules.test.ts` (S10 file) | 24 cases of the file | S10 |
| `packages/core/src/triage/settings.test.ts` (S10 file) | 12 cases of the file | S10 |
| `packages/core/src/triage/suspicious.test.ts` (S10 file) | 31 cases of the file | S10 |
| `packages/core/src/triage/threshold.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/triage/untrusted-text.test.ts` (S10 file) | 4 cases of the file | S10 |
| `packages/core/src/trust/evidence.test.ts` (S10 file) | 12 cases of the file | S10 |
| `packages/core/src/trust/history.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/trust/tripwire.test.ts` (S10 file) | 4 cases of the file | S10 |
| `packages/core/src/web/csp.test.ts` (S10 file) | 11 cases of the file | S10 |
| `packages/core/src/web/mailboxes.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/web/next-path.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/web/notify.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/web/onboarding.test.ts` (S10 file) | 5 cases of the file | S10 |
| `packages/core/src/web/org-name.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/web/organization.test.ts` (S10 file) | 4 cases of the file | S10 |
| `packages/core/src/web/password.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/web/public-content.test.ts` (S10 file) | 10 cases of the file | S10 |
| `packages/core/src/web/rules.test.ts` (S10 file) | 3 cases of the file | S10 |
| `packages/core/src/web/stats.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/web/telegram.test.ts` (S10 file) | 2 cases of the file | S10 |
| `packages/core/src/web/zod.test.ts` (S10 file) | 1 cases of the file | S10 |
| `packages/core/src/digest/local-time.test.ts:305` | `packages/core/src/digest/local-time.test.ts:305` | S9 |

## Web


### Not read (11)

| Item | Keys | Flags |
| --- | --- | --- |
| `apps/web/integrations/pwa-shell.test.ts:28` | `apps/web/integrations/pwa-shell.test.ts:28` | S8 |
| `apps/web/integrations/pwa-shell.test.ts:34` | `apps/web/integrations/pwa-shell.test.ts:34` | S8 |
| `apps/web/integrations/pwa-shell.test.ts:51` | `apps/web/integrations/pwa-shell.test.ts:51` | S8 |
| `apps/web/integrations/pwa-shell.test.ts:57` | `apps/web/integrations/pwa-shell.test.ts:57` | S8 |
| `apps/web/integrations/pwa-shell.test.ts:69` | `apps/web/integrations/pwa-shell.test.ts:69` | S8 |
| `apps/web/src/i18n/islands.test.ts:12` | `apps/web/src/i18n/islands.test.ts:12` | S8 |
| `apps/web/src/i18n/islands.test.ts:16` | `apps/web/src/i18n/islands.test.ts:16` | S8 |
| `apps/web/src/i18n/islands.test.ts:25` | `apps/web/src/i18n/islands.test.ts:25` | S8 |
| `apps/web/integrations/changelog-releases.test.ts:46` | `apps/web/integrations/changelog-releases.test.ts:46` | S2 |
| B4 | `apps/web/src/lib/legal-terms-dpa.test.ts:78`, `apps/web/src/lib/legal-terms-dpa.test.ts:113` | S5 |
| T16 | `apps/web/src/lib/two-factor-flow.test.ts:18`, `apps/web/src/lib/two-factor-flow.test.ts:22`, `apps/web/src/lib/two-factor-flow.test.ts:26` | S6 |

## Docs

### Read (26)

| Item | Keys | Flags | Action | Rule | Kept key | Evidence | Lines | Time (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `apps/docs/scripts/workflows.test.ts:55` | `apps/docs/scripts/workflows.test.ts:55` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. Pins the job list of `ci.yml`. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:59` | `apps/docs/scripts/workflows.test.ts:59` | S8 | KEEP | K3 | – | S8 expected for a workflow test: reads the YAML text and parses it. Least privilege: `contents: read` and no job widens it. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:64` | `apps/docs/scripts/workflows.test.ts:64` | S8 | KEEP | K3 | – | S8 expected for a workflow test: reads the YAML text and parses it. The docs job has no service and `secrets.` appears nowhere in `ci.yml`. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:69` | `apps/docs/scripts/workflows.test.ts:69` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. First four steps of the docs job: checkout, pinned Bun, Node 24, frozen install. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:77` | `apps/docs/scripts/workflows.test.ts:77` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. Order of build and stale check; no `--strict` in CI. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:85` | `apps/docs/scripts/workflows.test.ts:85` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. Order of install, build and browser check; upload of results on failure only. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:108` | `apps/docs/scripts/workflows.test.ts:108` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. `workflow_call` and `workflow_dispatch` are present (the deploy gate depends on it). No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:113` | `apps/docs/scripts/workflows.test.ts:113` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. The docs job has no `if`. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:128` | `apps/docs/scripts/workflows.test.ts:128` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. Pins the job list of `docs-deploy.yml`. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:132` | `apps/docs/scripts/workflows.test.ts:132` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. Triggers of the deploy workflow. The case name says "with no input" but the body asserts one boolean input `publish_held_pages` with default false: the name is stale, the body is right (a rename, not a cut). No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0 |
| `apps/docs/scripts/workflows.test.ts:141` | `apps/docs/scripts/workflows.test.ts:141` | S8 | KEEP | K3 | – | S8 expected for a workflow test: reads the YAML text and parses it. Only the deploy job has `pages: write` and `id-token: write` (least privilege, counted in the text). No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:151` | `apps/docs/scripts/workflows.test.ts:151` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. Environment name and URL on the deploy job only. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:157` | `apps/docs/scripts/workflows.test.ts:157` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. Concurrency group `pages`, no cancel-in-progress. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:163` | `apps/docs/scripts/workflows.test.ts:163` | S8 | KEEP | K3 | – | S8 expected for a workflow test: reads the YAML text and parses it. The release gate step cannot be skipped or made non-blocking. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:170` | `apps/docs/scripts/workflows.test.ts:170` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. Text pin of the header comment (the comment is the owner's runbook). Brittle, but it states the failure mode of the deploy until the owner acts. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:176` | `apps/docs/scripts/workflows.test.ts:176` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. Gate and build jobs set up Bun and Node the same way as `ci.yml`. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:190` | `apps/docs/scripts/workflows.test.ts:190` | S8 | KEEP | K3 | – | S8 expected for a workflow test: reads the YAML text and parses it. The GitHub context enters only through env, never a script text (`${{` absent from every `run`): injection guard. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:209` | `apps/docs/scripts/workflows.test.ts:209` | S8 | KEEP | K3 | – | S8 expected for a workflow test: reads the YAML text and parses it. Every later job runs only with `deploy=true` (the held-pages gate). No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:218` | `apps/docs/scripts/workflows.test.ts:218` | S8 | KEEP | K3 | – | S8 expected for a workflow test: reads the YAML text and parses it. The checks job calls `ci.yml` with no input and no secret. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:226` | `apps/docs/scripts/workflows.test.ts:226` | S8 | KEEP | K3 | – | S8 expected for a workflow test: reads the YAML text and parses it. No shot is made before every CI check passed. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:230` | `apps/docs/scripts/workflows.test.ts:230` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. Services and env equal the e2e job of `ci.yml`. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:237` | `apps/docs/scripts/workflows.test.ts:237` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. Order of the build steps (stale, migrate, build, install, shots, docs build, browser check, upload). No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:271` | `apps/docs/scripts/workflows.test.ts:271` | S8 | KEEP | K3 | – | S8 expected for a workflow test: reads the YAML text and parses it. No `continue-on-error` and no `if` on the build steps except the failure artifact: a failed check cannot publish. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:279` | `apps/docs/scripts/workflows.test.ts:279` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. `DOCS_SHOTS` is set only for the docs build step. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:289` | `apps/docs/scripts/workflows.test.ts:289` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. Artifact name, paths and 7 days retention on failure. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |
| `apps/docs/scripts/workflows.test.ts:300` | `apps/docs/scripts/workflows.test.ts:300` | S8 | KEEP | none | – | S8 expected for a workflow test: reads the YAML text and parses it. The pages artifact is the last build step and the deploy job takes it. No other test asserts these workflow properties: a grep for `docs-deploy` finds only `deploy-gate.ts` and this file; `check-migrations.test.ts` reads `ci.yml` for another rule. | 0 | 0.000 |

### Not read (13)

| Item | Keys | Flags |
| --- | --- | --- |
| `apps/docs/scripts/workflows.test.ts:308` | `apps/docs/scripts/workflows.test.ts:308` | S8 |
| `apps/docs/scripts/workflows.test.ts:318` | `apps/docs/scripts/workflows.test.ts:318` | S8 |
| `apps/docs/src/how-to.test.ts:29` | `apps/docs/src/how-to.test.ts:29` | S8 |
| `apps/docs/src/how-to.test.ts:35` | `apps/docs/src/how-to.test.ts:35` | S8 |
| `apps/docs/integrations/csp-finalize.test.ts:104` | `apps/docs/integrations/csp-finalize.test.ts:104` | S2 |
| T1 | `apps/docs/integrations/link-check.test.ts:33`, `apps/docs/integrations/link-check.test.ts:109`, `apps/docs/integrations/link-check.test.ts:114` | S6 |
| T2 | `apps/docs/integrations/link-check.test.ts:38`, `apps/docs/integrations/link-check.test.ts:76`, `apps/docs/integrations/link-check.test.ts:105` | S6 |
| T3 | `apps/docs/src/in-place.test.ts:21`, `apps/docs/src/in-place.test.ts:26`, `apps/docs/src/in-place.test.ts:55`, `apps/docs/src/in-place.test.ts:100` | S6 |
| `apps/docs/scripts/shots-build.test.ts:133` | `apps/docs/scripts/shots-build.test.ts:133` | S9 |
| `apps/docs/scripts/shots-build.test.ts:105` | `apps/docs/scripts/shots-build.test.ts:105` | S9 |
| `apps/docs/scripts/shots-build.test.ts:92` | `apps/docs/scripts/shots-build.test.ts:92` | S9 |
| `apps/docs/scripts/shots-build.test.ts:82` | `apps/docs/scripts/shots-build.test.ts:82` | S9 |
| `apps/docs/scripts/browser-check.test.ts:86` | `apps/docs/scripts/browser-check.test.ts:86` | S9 |

## Deploy


### Not read (75)

| Item | Keys | Flags |
| --- | --- | --- |
| `deploy/test/backup.test.ts:97` | `deploy/test/backup.test.ts:97` | S8 |
| `deploy/test/backup.test.ts:117` | `deploy/test/backup.test.ts:117` | S8 |
| `deploy/test/backup.test.ts:136` | `deploy/test/backup.test.ts:136` | S8 |
| `deploy/test/backup.test.ts:150` | `deploy/test/backup.test.ts:150` | S8 |
| `deploy/test/backup.test.ts:159` | `deploy/test/backup.test.ts:159` | S8 |
| `deploy/test/backup.test.ts:168` | `deploy/test/backup.test.ts:168` | S8 |
| `deploy/test/backup.test.ts:176` | `deploy/test/backup.test.ts:176` | S8 |
| `deploy/test/backup.test.ts:186` | `deploy/test/backup.test.ts:186` | S8 |
| `deploy/test/backup.test.ts:197` | `deploy/test/backup.test.ts:197` | S8 |
| `deploy/test/backup.test.ts:207` | `deploy/test/backup.test.ts:207` | S8 |
| `deploy/test/backup.test.ts:216` | `deploy/test/backup.test.ts:216` | S8 |
| `deploy/test/backup.test.ts:226` | `deploy/test/backup.test.ts:226` | S8 |
| `deploy/test/backup.test.ts:260` | `deploy/test/backup.test.ts:260` | S8 |
| `deploy/test/backup.test.ts:271` | `deploy/test/backup.test.ts:271` | S8 |
| `deploy/test/backup.test.ts:294` | `deploy/test/backup.test.ts:294` | S8 |
| `deploy/test/check-server-env.test.ts:61` | `deploy/test/check-server-env.test.ts:61` | S8 |
| `deploy/test/check-server-env.test.ts:68` | `deploy/test/check-server-env.test.ts:68` | S8 |
| `deploy/test/check-server-env.test.ts:80` | `deploy/test/check-server-env.test.ts:80` | S8 |
| `deploy/test/check-server-env.test.ts:87` | `deploy/test/check-server-env.test.ts:87` | S8 |
| `deploy/test/check-server-env.test.ts:93` | `deploy/test/check-server-env.test.ts:93` | S8 |
| `deploy/test/check-server-env.test.ts:107` | `deploy/test/check-server-env.test.ts:107` | S8 |
| `deploy/test/check-server-env.test.ts:112` | `deploy/test/check-server-env.test.ts:112` | S8 |
| `deploy/test/check-server-env.test.ts:119` | `deploy/test/check-server-env.test.ts:119` | S8 |
| `deploy/test/compose-backup-status.test.ts:16` | `deploy/test/compose-backup-status.test.ts:16` | S8 |
| `deploy/test/compose-backup-status.test.ts:22` | `deploy/test/compose-backup-status.test.ts:22` | S8 |
| `deploy/test/compose-backup-status.test.ts:28` | `deploy/test/compose-backup-status.test.ts:28` | S8 |
| `deploy/test/compose-drill.test.ts:100` | `deploy/test/compose-drill.test.ts:100` | S8 |
| `deploy/test/compose-drill.test.ts:106` | `deploy/test/compose-drill.test.ts:106` | S8 |
| `deploy/test/compose-drill.test.ts:110` | `deploy/test/compose-drill.test.ts:110` | S8 |
| `deploy/test/compose-drill.test.ts:125` | `deploy/test/compose-drill.test.ts:125` | S8 |
| `deploy/test/compose-drill.test.ts:134` | `deploy/test/compose-drill.test.ts:134` | S8 |
| `deploy/test/compose-drill.test.ts:141` | `deploy/test/compose-drill.test.ts:141` | S8 |
| `deploy/test/compose-drill.test.ts:151` | `deploy/test/compose-drill.test.ts:151` | S8 |
| `deploy/test/compose-drill.test.ts:172` | `deploy/test/compose-drill.test.ts:172` | S8 |
| `deploy/test/compose-drill.test.ts:180` | `deploy/test/compose-drill.test.ts:180` | S8 |
| `deploy/test/compose-drill.test.ts:194` | `deploy/test/compose-drill.test.ts:194` | S8 |
| `deploy/test/compose-lib.test.ts:30` | `deploy/test/compose-lib.test.ts:30` | S8 |
| `deploy/test/compose-lib.test.ts:36` | `deploy/test/compose-lib.test.ts:36` | S8 |
| `deploy/test/compose-lib.test.ts:46` | `deploy/test/compose-lib.test.ts:46` | S8 |
| `deploy/test/compose-lib.test.ts:54` | `deploy/test/compose-lib.test.ts:54` | S6,S8 |
| `deploy/test/compose-lib.test.ts:60` | `deploy/test/compose-lib.test.ts:60` | S8 |
| `deploy/test/compose-lib.test.ts:67` | `deploy/test/compose-lib.test.ts:67` | S6,S8 |
| `deploy/test/compose-lib.test.ts:73` | `deploy/test/compose-lib.test.ts:73` | S6,S8 |
| `deploy/test/compose-lib.test.ts:79` | `deploy/test/compose-lib.test.ts:79` | S8 |
| `deploy/test/compose-lib.test.ts:84` | `deploy/test/compose-lib.test.ts:84` | S8 |
| `deploy/test/compose-lib.test.ts:93` | `deploy/test/compose-lib.test.ts:93` | S8 |
| `deploy/test/docs-env-split.test.ts:46` | `deploy/test/docs-env-split.test.ts:46` | S8 |
| `deploy/test/docs-env-split.test.ts:52` | `deploy/test/docs-env-split.test.ts:52` | S8 |
| `deploy/test/docs-env-split.test.ts:57` | `deploy/test/docs-env-split.test.ts:57` | S8 |
| `deploy/test/docs-env-split.test.ts:63` | `deploy/test/docs-env-split.test.ts:63` | S8 |
| `deploy/test/docs-env-split.test.ts:68` | `deploy/test/docs-env-split.test.ts:68` | S8 |
| `deploy/test/docs-env-split.test.ts:73` | `deploy/test/docs-env-split.test.ts:73` | S8 |
| `deploy/test/docs-env-split.test.ts:88` | `deploy/test/docs-env-split.test.ts:88` | S8 |
| `deploy/test/env-split.test.ts:84` | `deploy/test/env-split.test.ts:84` | S8 |
| `deploy/test/env-split.test.ts:96` | `deploy/test/env-split.test.ts:96` | S8 |
| `deploy/test/env-split.test.ts:107` | `deploy/test/env-split.test.ts:107` | S8 |
| `deploy/test/env-split.test.ts:117` | `deploy/test/env-split.test.ts:117` | S8 |
| `deploy/test/env-split.test.ts:128` | `deploy/test/env-split.test.ts:128` | S8 |
| `deploy/test/env-split.test.ts:139` | `deploy/test/env-split.test.ts:139` | S8 |
| `deploy/test/env-split.test.ts:152` | `deploy/test/env-split.test.ts:152` | S8 |
| `deploy/test/env-split.test.ts:163` | `deploy/test/env-split.test.ts:163` | S8 |
| `deploy/test/env-split.test.ts:176` | `deploy/test/env-split.test.ts:176` | S8 |
| `deploy/test/env-split.test.ts:197` | `deploy/test/env-split.test.ts:197` | S8 |
| `deploy/test/env-split.test.ts:216` | `deploy/test/env-split.test.ts:216` | S8 |
| `deploy/test/env-split.test.ts:230` | `deploy/test/env-split.test.ts:230` | S8 |
| `deploy/test/env-split.test.ts:248` | `deploy/test/env-split.test.ts:248` | S8 |
| `deploy/test/env-split.test.ts:267` | `deploy/test/env-split.test.ts:267` | S8 |
| `deploy/test/release-identity.test.ts:19` | `deploy/test/release-identity.test.ts:19` | S8 |
| `deploy/test/release-identity.test.ts:25` | `deploy/test/release-identity.test.ts:25` | S8 |
| `deploy/test/release-identity.test.ts:32` | `deploy/test/release-identity.test.ts:32` | S8 |
| `deploy/test/release-identity.test.ts:43` | `deploy/test/release-identity.test.ts:43` | S8 |
| `deploy/test/release-identity.test.ts:50` | `deploy/test/release-identity.test.ts:50` | S8 |
| T17 | `deploy/test/compose-lib.test.ts:54`, `deploy/test/compose-lib.test.ts:67`, `deploy/test/compose-lib.test.ts:73` | S6 |
| `deploy/test/backup.test.ts:226` | `deploy/test/backup.test.ts:226` | S9 |
| `deploy/test/backup.test.ts:207` | `deploy/test/backup.test.ts:207` | S9 |

## Tools

### Read (24)

| Item | Keys | Flags | Action | Rule | Kept key | Evidence | Lines | Time (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tools/fake-telegram/src/compat.test.ts:44` | `tools/fake-telegram/src/compat.test.ts:44` | S1 | REWRITE-WEAK | none | – | S1: no `expect`; the only check is that `channel.edit` does not throw. Propose `await expect(channel.edit(DEFAULT_CHAT_ID, messageId, { text: "text", buttons: [] })).resolves.toBeUndefined();` (the port returns `Promise<void>`) and `expect(fake.state.messages(DEFAULT_CHAT_ID)[messageId - 1]?.edits).toEqual([])` so a swallowed not-modified error shows. Not a duplicate of the first case (that one reads the raw error through `isNotModified`). | 0 | 0.003 |
| `tools/mail-oauth-spike/probe.test.ts:54` | `tools/mail-oauth-spike/probe.test.ts:54` | S8,not-run | FIX-NEVER-RUNS | K3 | – | Secret guard: a refused evidence row gives no file and exit 1. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:71` | `tools/mail-oauth-spike/probe.test.ts:71` | S8,not-run | FIX-NEVER-RUNS | K3 | – | Secret guard: a non-string evidence counts as a bad row. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:78` | `tools/mail-oauth-spike/probe.test.ts:78` | S8,not-run | FIX-NEVER-RUNS | K3 | – | The owner address is masked in the result file. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:99` | `tools/mail-oauth-spike/probe.test.ts:99` | S8,not-run | FIX-NEVER-RUNS | K3 | – | A thrown message never reaches the file (codes only). `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:115` | `tools/mail-oauth-spike/probe.test.ts:115` | S8,not-run | FIX-NEVER-RUNS | K3 | – | OAuth `state` check of the callback server: 400 on a wrong or missing state. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:146` | `tools/mail-oauth-spike/probe.test.ts:146` | S8,not-run | FIX-NEVER-RUNS | none | – | Callback wait timeout. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:201` | `tools/mail-oauth-spike/probe.test.ts:201` | S8,not-run | FIX-NEVER-RUNS | K3 | – | No token, code, state, client secret or address reaches the file or the screen; PKCE S256 binds the verifier. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:260` | `tools/mail-oauth-spike/probe.test.ts:260` | S8,not-run | FIX-NEVER-RUNS | none | – | CLI argument parsing. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:267` | `tools/mail-oauth-spike/probe.test.ts:267` | S8,not-run | FIX-NEVER-RUNS | K3 | – | `readEnv` names missing variables and never echoes a value. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:287` | `tools/mail-oauth-spike/probe.test.ts:287` | S8,not-run | FIX-NEVER-RUNS | K3 | – | A known secret value in evidence is refused. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:323` | `tools/mail-oauth-spike/probe.test.ts:323` | S8,not-run | FIX-NEVER-RUNS | K3 | – | Boundary of the known-secret guard (short values pass, a clean row passes). `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:348` | `tools/mail-oauth-spike/probe.test.ts:348` | S8,not-run | FIX-NEVER-RUNS | K3 | – | The callback server binds loopback only, on both families. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:367` | `tools/mail-oauth-spike/probe.test.ts:367` | S8,not-run | FIX-NEVER-RUNS | K3 | – | A port held by another process on 127.0.0.1 or ::1 stops the start (no hijack of the callback). `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:410` | `tools/mail-oauth-spike/probe.test.ts:410` | S8,not-run | FIX-NEVER-RUNS | none | – | Big LIST edge case of the IMAP row. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:498` | `tools/mail-oauth-spike/probe.test.ts:498` | S8,not-run | FIX-NEVER-RUNS | K3 | – | Send targets: mail goes to the plus-address only (no third party). `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:514` | `tools/mail-oauth-spike/probe.test.ts:514` | S8,not-run | FIX-NEVER-RUNS | K3 | – | Send targets: mail goes to the plus-address only. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/probe.test.ts:527` | `tools/mail-oauth-spike/probe.test.ts:527` | S8,not-run | FIX-NEVER-RUNS | K3 | – | Send targets over SMTP (RCPT TO and headers). `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/redact.test.ts:15` | `tools/mail-oauth-spike/redact.test.ts:15` | S8,not-run | FIX-NEVER-RUNS | K3 | – | `assertSafeEvidence` refuses each token shape and an address. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/redact.test.ts:31` | `tools/mail-oauth-spike/redact.test.ts:31` | S8,not-run | FIX-NEVER-RUNS | K3 | – | Guard edge: non-string and too long values. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/redact.test.ts:37` | `tools/mail-oauth-spike/redact.test.ts:37` | S8,not-run | FIX-NEVER-RUNS | K3 | – | The refusal never holds the refused text. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/redact.test.ts:48` | `tools/mail-oauth-spike/redact.test.ts:48` | S8,not-run | FIX-NEVER-RUNS | K3 | – | The guard accepts what a row legitimately writes (no over-blocking). `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/redact.test.ts:66` | `tools/mail-oauth-spike/redact.test.ts:66` | S8,not-run | FIX-NEVER-RUNS | K3 | – | `maskAddresses` hides an address and its plus forms. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |
| `tools/mail-oauth-spike/redact.test.ts:73` | `tools/mail-oauth-spike/redact.test.ts:73` | S8,not-run | FIX-NEVER-RUNS | K3 | – | `word` quotes a short plain word, hides everything else. `not-run`: `bun test tools/mail-oauth-spike` passes 23 of 23 in 0.45 s now, but the path is in no suite of `package.json` (`test:unit` lists no `tools/mail-oauth-spike`), so CI never runs it. Proposal: add `tools/mail-oauth-spike` to the `test:unit` paths, or delete the kit with its tests together. The kit is temporary by its README (the dropped F117 stage 19 would have deleted it) and `spec/quality/2026-11-20-pass-2.md` asks the owner to keep or drop it, so the choice is the owner's.  | 0 | 0.000 |

### Not read (18)

| Item | Keys | Flags |
| --- | --- | --- |
| `tools/fake-telegram/src/compose-health.test.ts:31` | `tools/fake-telegram/src/compose-health.test.ts:31` | S8 |
| `tools/fake-telegram/src/compose-health.test.ts:39` | `tools/fake-telegram/src/compose-health.test.ts:39` | S8 |
| `tools/fake-telegram/src/state.test.ts:8` | `tools/fake-telegram/src/state.test.ts:8` | S8 |
| `tools/fake-telegram/src/state.test.ts:16` | `tools/fake-telegram/src/state.test.ts:16` | S8 |
| `tools/fake-telegram/src/state.test.ts:24` | `tools/fake-telegram/src/state.test.ts:24` | S8 |
| `tools/fake-telegram/src/state.test.ts:33` | `tools/fake-telegram/src/state.test.ts:33` | S8 |
| `tools/fake-telegram/src/state.test.ts:41` | `tools/fake-telegram/src/state.test.ts:41` | S8 |
| `tools/fake-telegram/src/state.test.ts:55` | `tools/fake-telegram/src/state.test.ts:55` | S8 |
| `tools/fake-telegram/src/state.test.ts:63` | `tools/fake-telegram/src/state.test.ts:63` | S8 |
| `tools/fake-telegram/src/view.test.ts:26` | `tools/fake-telegram/src/view.test.ts:26` | S8 |
| `tools/fake-telegram/src/view.test.ts:34` | `tools/fake-telegram/src/view.test.ts:34` | S8 |
| `tools/fake-telegram/src/view.test.ts:49` | `tools/fake-telegram/src/view.test.ts:49` | S8 |
| `tools/fake-telegram/src/view.test.ts:68` | `tools/fake-telegram/src/view.test.ts:68` | S8 |
| `tools/fake-telegram/src/view.test.ts:80` | `tools/fake-telegram/src/view.test.ts:80` | S8 |
| `tools/fake-telegram/src/view.test.ts:90` | `tools/fake-telegram/src/view.test.ts:90` | S8 |
| `tools/fake-telegram/src/view.test.ts:98` | `tools/fake-telegram/src/view.test.ts:98` | S8 |
| `tools/fake-telegram/src/view.test.ts:107` | `tools/fake-telegram/src/view.test.ts:107` | S8 |
| `tools/fake-telegram/src/server.test.ts:73` | `tools/fake-telegram/src/server.test.ts:73` | S9 |

## Summary

- Items selected by § Reader method step 2: 664. Items in this file: 664 (50 read rows + 614 `not read` rows). Read: 50. Not read: 614.
- GAP rows: 122 (information, not items).

| Section | Read | Not read |
| --- | --- | --- |
| Core | 0 | 497 |
| Web | 0 | 11 |
| Docs | 26 | 13 |
| Deploy | 0 | 75 |
| Tools | 24 | 18 |

| Action | Rows | Lines | Time of cases (s) |
| --- | --- | --- | --- |
| KEEP | 26 | 0 | 0.000 |
| DELETE-DUP | 0 | 0 | 0.000 |
| MERGE-TABLE | 0 | 0 | 0.000 |
| REWRITE-WEAK | 1 | 0 | 0.003 |
| DELETE-STALE | 0 | 0 | 0.000 |
| MOVE-TO-UNIT | 0 | 0 | 0.000 |
| FIX-NEVER-RUNS | 23 | 0 | 0.000 |

KEEP and FIX-NEVER-RUNS by rule: K3 29, none 21.
