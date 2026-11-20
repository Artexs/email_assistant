# F149 scouts

Three scouts, all at base e8f6f2b1. Packets copied whole from each job log.

## Scout 1 · `2026-11-20-f149-scout-1-0b627869`

**Question:**

In packages/core/src/digest/callback.ts: list every Telegram callback kind, its wire prefix and data format, the type/enum that names the kinds, the encode and decode functions and their switch blocks, and every caller of them outside the file. Are there prefix overlaps or ordering dependencies in decode? Which tests cover encode/decode round trips?

**Packet:**

Packet: callback kinds, prefixes, encode/decode switches, outside callers, overlaps and round-trip tests in `packages/core/src/digest/callback.ts`
Base: e8f6f2b1
Verified: `rg -n "parseCallback|encodeCallback|is…Callback" --glob '*.ts' .` -> `./apps/server/src/modules/channels/callbacks.ts:61:  const callback = parseCallback(data);`
Unknowns: I ran no test, so I did not confirm that the round-trip tests pass. I searched only `*.ts` and `*.tsx` outside `spec/` and `node_modules`. `apps/web` was not checked separately; the search showed no hit there.

1. **Kind type (observed).** `Callback` (callback.ts:~63) is a union of 33 kinds. It has no enum and no registry. Sub-unions: `FeedbackCallback` (9), `AnsweredCallback` (2), `LoopCallback` (5), `DelegateCallback` (2), `ReplyCallback` (6). It also has 9 inline kinds. Each kind is a string literal on `kind`.

2. **Wire formats (observed).** `<UUID>` is the 36-character form. The data is at most 64 bytes.

| Kind | Wire format |
|---|---|
| `right` / `pick` | `fr:<c>:<UUID>` / `fc:<c>:<UUID>` |
| `edit` / `cancel` / `undo` | `fe:` / `fx:` / `fu:` + `<UUID>` |
| `review_right` / `review_pick` | `vr:<c>:<UUID>` / `vc:<c>:<UUID>` |
| `review_edit` / `review_cancel` | `ve:` / `vx:` + `<UUID>` |
| `approve` / `reject` | `ap:` / `ar:` + `<UUID>` |
| `approve_set` / `reject_set` | `as:` / `rs:` + `<UUID>` |
| `send_again` / `went_out` | `ag:` / `gw:` + `<UUID>` |
| `delegation_done` / `mistake` | `dd:` / `mk:` + `<UUID>` |
| `reject_reason` | `rw:<p\|c\|n>:<UUID>` |
| `answered_yes` / `answered_no` | `ay:` / `an:` + `<UUID>` |
| `loop_follow_up` / `loop_later` | `lf:` / `ll:` + `<UUID>` |
| `loop_done` / `loop_drop` / `loop_reopen` | `lc:` / `lx:` / `lr:` + `<UUID>` |
| `reply_review` | `rv` (no `afterId`) or `rv:<UUID>` |
| `reply_skip` | `rk:<UUID>` |
| `reply_redraft` / `reply_all` / `reply_use_reply_to` | `rd:` / `ra:` / `ru:` + `<UUID>` |
| `reply_draft` | `dr:<UUID>` |
| `delegate_open` | `dg:<UUID>` |
| `delegate_pick` | `dp:<b64url22>:<b64url22>` (48 bytes) |

   Category code `<c>`: `u`, `r`, `i`, `n`, `s`. The `vr` and `vc` prefixes also take `d`. `fr` and `fc` reject `d`.

3. **Encode (observed).** `encodeCallback` (about line 196) has one switch with 24 arms. Its `default` calls `encodeFeedback`, which has its own switch with 9 arms. `checkedId` throws `"bad id"`; `encodeFeedback` throws `"bad email id"`. Each prefix string is written by hand in the arm.

4. **Decode (observed).** `parseCallback` (about line 261) is an if-chain of anchored regexes, not one switch. Seven blocks switch on the captured prefix:
   - `APPROVAL` (7 prefixes, `default` is `dd`)
   - `LOOP` (`default` is `lr`)
   - `REPLY_CARD` (`default` is `dr`)
   - `WITH_CODE` (`default` is `vc`)
   - `WITHOUT_CODE` (`default` is `vx`... see note below)
   - ANSWERED, REPLY_REVIEW, REPLY_SKIP, DELEGATE_OPEN, DELEGATE_PICK and REASON are single-kind or ternary and have no switch.
   
   Note on `WITHOUT_CODE`: its switch names `fe`, `fu`, `ve` and `vx`. Its `default` is `fx` (`cancel`). Four of the five arms are explicit.

5. **Overlaps and ordering (observed).** I found no prefix overlap. All 32 prefixes are distinct two-letter strings, and every regex is anchored with `^…$`. The same prefix never appears in two regexes. Decode order does not change the result, so there is no ordering dependency. One fragility exists: each `default` arm assumes the regex allows no other prefix. Adding a prefix to a regex without a `case` silently decodes as the default kind. `parseCallback` is also the only place that ties a prefix to its kind; `encodeCallback` repeats the same mapping by hand.

6. **Callers outside the file (observed).**
   - **Server.** `apps/server/src/modules/channels/callbacks.ts:61-71` calls `parseCallback`, then `isAnsweredCallback`, `isReplyCallback`, `isLoopCallback`, `isDelegateCallback` and `isFeedbackCallback` in a fixed order. The order matters: `isFeedbackCallback` is "has `emailId` and is none of answered, delegate or reply". It falls through to `handleApprovalCallback`. The same file also uses `encodeCallback` for `pick` and `cancel`. Other server callers: `review-taps.ts` (`review_pick`, `review_cancel`), `delegate-taps.ts` (`delegate_pick`), `loop-taps.ts` (`loop_follow_up`, `loop_later`) and `brief-line-edit.ts:30` (`parseCallback`).
   - **Core encoders.** `digest/approval-edit.ts`, `answered-check.ts`, `action-feedback.ts`, `review.ts`, `notices.ts`, `digest.ts`, `approvals.ts`, `approval-results.ts` and `loops/brief.ts` call `encodeCallback`.
   - **Core parsers.** `sim/live/executive.ts:166` calls `parseCallback`.
   - **Other imports.** `web/review.ts`, `web/activity.ts` and `web/index.ts` import only `labelCategories`, `reviewLabelCategories` and `isLabelCategory`. `isReviewCallback` has no caller outside the file and its tests.

7. **Round-trip tests (observed).**
   - `digest/callback.test.ts` has `test.each` round trips for feedback, review, answered and reject-reason kinds. It also checks the documented formats, bad-data rejections and the `"bad id"` throws.
   - `digest/callback-loop.test.ts` covers loop, delegate, reply, `rv` and `rk`. It has a registry check that no other kind uses `rv` or `rk`, and a `:64` byte limit check over every prefix.
   - The approve/reject/set/send_again/went_out/delegation_done kinds are round-tripped only in `callback.test.ts:68-70`, and they are also covered through `approvals.test.ts` (`parseCallback(...)` toEqual) and `approvals-follow-up.test.ts`.
   - Integration tests (`channels-loop-taps*.test.ts`, `channels-delegate-taps.test.ts`, `channels-card-sync.test.ts`) use `encodeCallback` to build tap data.
   - Nothing iterates all 33 kinds. The `:64` check uses a fixed list. A new kind with no test entry is not caught by a test.

8. **Prior record (observed).** `spec/quality/2026-11-20-pass-2.md:114` names the same code as finding 10: about 54 `case` arms across four switch blocks, plus the five `is…Callback` guards in `callbacks.ts:66-70`.

Checks: `callback.test.ts` and `callback-loop.test.ts` cover encode/decode round trips and rejections for most kinds; they do not cover every kind in one table, and I ran neither.

## Scout 2 · `2026-11-20-f149-scout-2-cd94cd8a`

**Question:**

How does apps/server/src/modules/channels/callbacks.ts handleCallback choose a handler (isAnsweredCallback, isReplyCallback, isLoopCallback, isDelegateCallback, isFeedbackCallback, approval, review, default digest taps)? For each family: predicate source, handler function and file, its deps/arguments, whether order of checks matters (could two predicates match one data string), feature flags or consent checks before dispatch, what happens on unknown data, and which tests cover the dispatch.

**Packet:**

Packet: How `handleCallback` picks a handler for each Telegram callback family (predicate, handler, deps, order, flags, unknown data, tests)
Base: e8f6f2b1
Verified: `read apps/server/src/modules/channels/callbacks.ts` -> `if (isAnsweredCallback(callback))` is the first dispatch check after `parseCallback` (the file has 102 lines). I ran no tests.
Unknowns: I did not read the body of `channels-callbacks.test.ts` past its test titles. The mapping from each family to a test file comes from file names and titles only. I did not check that review-picker taps (`review_*`) have a dedicated dispatch test beyond test "the review taps record the source review" (line 197).

1. `callbacks.ts:55-71`, `handleCallback(deps, link, data, tapSource)` — observed.
   - **Parse:** `parseCallback(data)` (`packages/core/src/digest/callback.ts:267`) turns the string into a `Callback` or `null`.
   - **Context:** `texts = textsFor(link.locale)` and `ctx = {orgId, userId}` come from the link.
   - **Unknown data:** `null` returns `{answer: taps.invalid}`. This is the only unknown-data path; there is no `else` branch. A data string that parses but matches no family falls through to the approval handler.
   - **Suspended org:** it is checked before `handleCallback`, in `commands.ts:176-184` (`callback:` handler, `isOrgSuspended`). It answers `accountPaused` and never reaches `callbacks.ts`.

2. Dispatch order is a hand-written if-chain, `callbacks.ts:62-67` — observed. The predicates are TypeScript type guards, each a `kind` comparison in `callback.ts:76-110`:

   | # | Family | Predicate | Handler (file) | Arguments |
   |---|---|---|---|---|
   | 1 | answered (`answered_yes`/`answered_no`) | `isAnsweredCallback` | `handleAnsweredTap` (`answered-taps.ts`) | `{db, ctx, link, now: deps.now(), texts}`, callback |
   | 2 | reply (6 kinds) | `isReplyCallback` | `handleReplyCallback` (`reply-taps.ts`) | deps, link, ctx, callback, texts, tapSource |
   | 3 | loop (5 kinds) | `isLoopCallback` | `handleLoopCallback` (`loop-taps.ts`) | deps, link, ctx, callback, texts, tapSource |
   | 4 | delegate (`delegate_open`/`delegate_pick`) | `isDelegateCallback` | `handleDelegateCallback` (`delegate-taps.ts`) | deps, link, ctx, callback, texts (no tapSource) |
   | 5 | approval (`approve`, `reject`, `approve_set`, `reject_set`, `send_again`, `went_out`, `delegation_done`, `reject_reason`, `mistake`) | no predicate: it is the fallthrough `if (!isFeedbackCallback(callback))` | `handleApprovalCallback` (`approval-taps.ts`) | deps, link, ctx, callback, texts, tapSource |
   | 6 | feedback (`right`, `edit`, `undo`, `pick`, `cancel`, `review_right`, `review_pick`, `review_edit`, `review_cancel`) | `isFeedbackCallback` | inline in `handleCallback`, `callbacks.ts:68-101` | uses `feedbackTap`, `getLabelTarget`, `recordFeedback`, `undoWithFeedback`, `pickerMessage` or `reviewPickerMessage` |

   - Rows 1 to 5 each return directly.
   - There is no separate "review" handler: `feedbackTap(callback)` (`review-taps.ts`) maps `review_*` kinds to the plain kinds plus `source: "review"`. The digest-row taps `right`, `pick`, `edit`, `undo` and `cancel` also go through the same inline code, with source `digest`.
   - `isReviewCallback` exists in `callback.ts:~110` but `callbacks.ts` does not use it.

3. Order matters in one place: `isFeedbackCallback` depends on the other predicates — observed.
   - **Definition:** `callback.ts:105`. It is true when `"emailId" in callback` and the callback is not answered, delegate or reply. It does not exclude loop or approval.
   - **Overlap:** answered, delegate and `reply_draft` all have `emailId`, so without the exclusions they would count as feedback.
   - **Why the feedback check comes after the others:** loop and approval kinds carry `loopId`, `actionId`, `setId` or `delegationId`, never `emailId`, so they are not feedback. Approval is reached only because it is tested as "not feedback".
   - **Exclusive kinds:** the answered, reply, loop and delegate predicates each match a disjoint `kind` set, so no data string matches two of them. A `kind` string is unique per variant. The `parseCallback` regexes pick one variant per string, and that function checks them in sequence (approval, answered, loop, reply review/skip/card, delegate, reason, with-code, without-code), returning at the first match.
   - **Consequence for a registry:** adding a family with an `emailId` field means also editing `isFeedbackCallback`, or it is silently routed as feedback. A new family with no `emailId` falls into approval by default.

4. Flags, consent and role before dispatch — observed.
   - **In `callbacks.ts`:** none. There is no flag, consent or role check in `handleCallback` itself.
   - **Inside the handlers:**
     - answered: `isFeatureOn(db, ctx, "answered_check")`, otherwise `answers.off` (`answered-taps.ts:23`).
     - reply: owner role, then `isFeatureOn(..., "reply_drafts")` (otherwise `taps.featureOff`), then `replyConsentOf(...)` (otherwise a consent message), at `reply-taps.ts:60-72`.
     - loop: `OWNER_ONLY` role check first, before any query (`loop-taps.ts:29`). There is no feature flag in this file.
     - delegate: owner role (`delegate-taps.ts:39`), then `isFeatureOn(..., "delegate_button")` (`delegate-taps.ts:77`).
     - approval: owner role for every kind except `delegation_done` (`approval-taps.ts:103`). `isFeatureOn("mistake_capture")` only picks the reason buttons (`approval-taps.ts:207`).
     - feedback: none. `texts.bot.taps.notFound` covers an unknown or cross-organization mail.

5. Tests — observed by file name and `grep`, not read in full.
   - **Core:** `packages/core/src/digest/callback.test.ts` and `callback-loop.test.ts` cover `parseCallback` and the predicates.
   - **Integration, `handleCallback` paths:**
     - `apps/server/test/integration/channels-callbacks.test.ts` — feedback and review taps (lines 78-197), approval taps (`describe("approval taps")` at 373), "junk data is not valid" (178), "(10) forged data is not valid" (1236), the suspended-organization group (1410).
     - `channels-delegate-taps.test.ts`
     - `channels-loop-taps.test.ts` and `channels-loop-taps-answers.test.ts`
     - `channels-reply-review.test.ts`, `channels-reply-redraft.test.ts` and `channels-reply-redraft-repair.test.ts`
     - `triage-answered-check.test.ts`
   - There is no test that checks dispatch routing as such (one data string per family reaching the right handler). Routing is covered only through handler behavior.

Checks: `channels-callbacks.test.ts` covers feedback, approval, invalid data and suspended-org taps; the handler files have their own integration tests. They miss a table test that checks that each `Callback` kind reaches exactly one family, and a test that a new `emailId` kind is not routed as feedback by mistake.

## Scout 3 · `2026-11-20-f149-scout-3-8aa7f5ad`

**Question:**

Besides packages/core/src/digest/callback.ts and apps/server/src/modules/channels/callbacks.ts, where else is Telegram callback_data built or parsed (telegram adapter, fake channel, lab bots in apps/server/src/modules/lab, push/web taps, tests)? Which active or planned tickets in spec/features/active and spec/features/planned name these files or callback families in their stages (for example F143 file splits, F115 reply drafts, F147)?

**Packet:**

Packet: Where else Telegram callback_data is built or parsed, and which active or planned tickets name those files or callback families.
Base: e8f6f2b1
Verified: `rg -n "parseCallback|encodeCallback" apps/server/src/modules/channels` -> `modules/channels/callbacks.ts:61:  const callback = parseCallback(data);`
Unknowns:
- I did not read every F125 audit data file. They list test cases only and do not plan work on these files.
- I did not read the whole text of `spec/quality/2026-11-20-pass-2.md`, the source of F149. F149's `ticket.md` is an empty template, so it names no files.
- `apps/server/src/modules/lab` has no direct `callback_data` build or parse. It matches button text and `ar:` / `rw:` prefixes by string (item 4).

1. Core build and parse: `packages/core/src/digest/callback.ts` has `encodeCallback` (l.182) and `parseCallback` (l.267). It also has the `is*Callback` guards (l.76–114). Other callers in core, observed:
   - `loops/brief.ts:290` builds buttons with `encodeCallback`.
   - `sim/live/executive.ts:166` parses with `parseCallback`.
   - `digest/{digest,review,approvals,approval-edit,approval-results,notices,answered-check,action-feedback}.ts` mention callback types or data.
2. Server dispatch, all in `apps/server/src/modules/channels/`:
   - `callbacks.ts` builds the picker (l.42, l.49) and parses at l.61.
   - Build only: `review-taps.ts` (l.47, l.56), `delegate-taps.ts` (l.86), `loop-taps.ts` (l.53, l.90).
   - Parse only: `brief-line-edit.ts:30`.
   - Family handlers: `approval-taps.ts` and `action-feedback-taps.ts`.
   - Transport: `telegram/bot.ts:140` passes `ctx.callbackQuery.data` to `handlers.callback`. `telegram/api.ts:25,44` maps `button.data` to `callback_data` and checks the 64-byte limit. `telegram/polling.ts` also matches.
3. Fake channel and e2e: `tools/fake-telegram/src/state.ts` (l.95 build, l.172–196 `pressButton` and `callback_query`) and `server.ts` (l.48, l.61; 64-byte check). Its tests include `lab-executive.test.ts`. `apps/web/e2e/lib/demo/notice.ts:39` maps `button.data` to `callback_data`.
4. Lab bots: `apps/server/src/modules/lab/executive.ts` (`buttonsOf` l.166, `data.startsWith("ar:")` l.229, `"rw:"` after the reject) and `lab/fake-tg.ts:15` (`FakeButton`). There is no encode or parse call. The only code-prefix coupling outside core is the `ar:` and `rw:` strings. Push and web taps: I found no `callback_data` in `apps/web/src`.
5. Tickets, observed:
   - F143 (file splits): `stages/stage-08-server-parts.md:48` says F149 "may edit `createUpdateHandlers`". The overlap is advisory: start the stage, and on a land conflict use D6. `stage-06-cards-and-views.md` splits `digest/approvals.ts` and `digest/digest.ts` and re-exports every moved name. `plan-review-1.md:103` notes F149 has no spawn rule.
   - F115 (reply drafts): `interfaces.md:38` adds `reply_review`, `reply_skip`, `reply_redraft`, `reply_all`, `reply_use_reply_to` and `reply_draft`, with unique two-letter codes (`rd`, `ra`, `ru`, `dr`) checked by a test. `stage-13-telegram-redraft.md` adds the Telegram redraft taps. `stage-17-docs.md:39` says old releases parse these codes to null.
   - F147 (operator alerts): `scouts.md` mentions only `notify()` in `channels/operator.ts`. It names no callback family.
   - `planned/triage-2026-11-13.md:28` lists F030 (picker "Already saved") on `channels/callbacks.ts` and `digest/answers.ts`. It is not built.
   - F125 (test audit): its audit data lists callback tests only.

Checks: `packages/core/src/digest/callback.test.ts` and `callback-loop.test.ts` cover encode and parse round trips. `channels-loop-taps*.test.ts`, `channels-delegate-taps.test.ts`, `channels-card-sync.test.ts` and `telegram-router.test.ts` cover dispatch. The fake-telegram tests cover the 64-byte limit. None of these checks that the lab `ar:` and `rw:` strings match core codes. I ran no tests.

## Planner notes on the packets

- Scout 1 counts 32 prefixes; the code has 33 kinds and 33 prefixes (feedback 9, answered 2, loop 5, delegate 2, reply 6, approval 9). Checked by reading `callback.ts` at e8f6f2b1.
- Scout 3 item 4: `lab/executive.ts` builds `rw:${then}:${actionId}` by hand next to `startsWith("ar:")` (line 231 at e8f6f2b1); line 252 `rw:` is a reference, not callback data. The plan leaves the lab and the simulator out of scope (D12).
