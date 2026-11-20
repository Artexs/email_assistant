# F149 stage 02 — Server family dispatch

Needs stage 01: the family names and types of `@ea/core` (`callbackFamilies`, `CallbackOfFamily`, `callbackFamilyOf`, `isCallbackOfFamily`).

Part of [`../plan.md`](../plan.md). Decisions D7, D9–D11, D14, D15.

## Step 1 — the feedback handler

- **Goal:** the feedback body of `handleCallback` (cancel, undo, edit, right, pick, for the digest and the `/review` source) moves out, with no change in behaviour.
- **Files:** new `apps/server/src/modules/channels/feedback-taps.ts`.
- **Interfaces:** `handleFeedbackCallback(deps: CallbackDeps, link: LinkedChat, ctx: TenantContext, callback: FeedbackCallback, texts: CoreTexts): Promise<CallbackResult>`. `pickerMessage` moves here and keeps its name and its export through `channels/index.ts`.
- **Done when:** each feedback kind answers as at the plan base (the integration tests below).

## Step 2 — the family record and the dispatch

- **Goal:** `handleCallback` has no if-chain over families.
- **Files:** `apps/server/src/modules/channels/callbacks.ts`.
- **Interfaces:**
  - `type TapInput = { deps: CallbackDeps; link: LinkedChat; ctx: TenantContext; texts: CoreTexts; tapSource: TapSource }`.
  - `type CallbackHandler<F extends CallbackFamily> = (input: TapInput, callback: CallbackOfFamily<F>) => Promise<CallbackResult>`.
  - `const callbackHandlers: { [F in CallbackFamily]: CallbackHandler<F> }`: six thin adapters to `handleFeedbackCallback`, `handleAnsweredTap` (it takes `{ db, ctx, link, now, texts }`; `now` is `deps.now()` at the tap), `handleReplyCallback`, `handleLoopCallback`, `handleDelegateCallback` (no `tapSource`, as today) and `handleApprovalCallback`. Handler signatures do not change.
  - `export function dispatchCallback(handlers: { [F in CallbackFamily]: CallbackHandler<F> }, input: TapInput, callback: Callback): Promise<CallbackResult>`. At most one cast, here, with a one-line comment why it is safe.
  - `handleCallback(deps, link, data, tapSource)` keeps its signature and its `null` → `taps.invalid` answer; it builds `TapInput` once and calls `dispatchCallback(callbackHandlers, …)`.
  - `callbacks.ts` exports `callbackHandlers`, `dispatchCallback` and the two types for the test; `channels/index.ts` exports nothing new.
- **Decisions:** D10: role, flag and consent checks stay in the handlers.
- **Done when:** a new family in `callbackFamilies` fails `bun run typecheck` in `callbacks.ts` until it has a handler.

## Step 3 — remove the old predicates, docs

- **Goal:** one family API (D7).
- Remove `isAnsweredCallback`, `isReplyCallback`, `isLoopCallback`, `isDelegateCallback`, `isFeedbackCallback` and `isReviewCallback` from core. Move each caller to `isCallbackOfFamily` or `callbackFamilyOf`: `digest.test.ts`, `callback.test.ts`, `callback-loop.test.ts`. Keep the truth value of each assert: `isFeedbackCallback(x)` becomes `isCallbackOfFamily(x, "feedback")`; an `isReviewCallback` assert becomes a check that the kind starts with `review_` and the family is `feedback`. 
- **Docs (D15):** in `docs/capabilities/digest-and-notices.md`, rule 10 says: the prefixes and codecs are in `callbackKinds` (name its file); a new kind is one entry there and one golden row; a new family also needs one `callbackHandlers` entry in `callbacks.ts`. The Telegram rows of the table point to rule 10 instead of a short prefix list; the `pickerMessage` row names `feedback-taps.ts`. Add the new test files to its tests list. `docs/capabilities/open-loops.md` rule 9 names the file that holds `callbackKinds`.
- **Done when:** the six names above give no match in `apps/`, `packages/` and `tools/`; this check must find nothing.

## Tests

New unit file `apps/server/src/modules/channels/callbacks-dispatch.test.ts`, no DB (if loading `callbacks.ts` needs one, put it in `apps/server/test/integration/` and say so). Recording handlers: each pushes `[family, callback]` to one array and returns `{ answer: family }`. Use `ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"`; `input` holds stub values.

1. `test.each`, 7 rows: data → family: `` `fr:u:${ID}` `` → feedback; `` `vx:${ID}` `` → feedback; `` `ay:${ID}` `` → answered; `"rv"` → reply; `` `lf:${ID}` `` → loop; `` `dg:${ID}` `` → delegate; `` `ap:${ID}` `` → approval. For each: `dispatchCallback(recording, input, parseCallback(data)!)` resolves to `{ answer: <family> }`, and the array is exactly `[[family, parseCallback(data)]]`.
2. Type test: a handler record typed `{ [F in CallbackFamily]: CallbackHandler<F> }` that lacks `loop` carries `// @ts-expect-error`; `bun run typecheck` passes only while the error exists.

Break check: make `dispatchCallback` always call `handlers.approval` and see test 1 fail; restore. Report it.

The integration tests that cover the taps pass with no edit to their asserts: `channels-callbacks.test.ts` (feedback, review, approval, "junk data is not valid", "forged data is not valid", suspended organization), `channels-loop-taps.test.ts`, `channels-loop-taps-answers.test.ts`, `channels-delegate-taps.test.ts`, `channels-reply-review.test.ts`, `channels-reply-redraft.test.ts`, `channels-reply-redraft-repair.test.ts`, `triage-answered-check.test.ts`. Run with `bun test <file>`, once after the last commit, each one that `check:job` skips.

## Check

- `bun test apps/server/src/modules/channels/callbacks-dispatch.test.ts packages/core/src/digest/` while you work.
- Last: `bun run check:job`.

## Done when

Tests 1–2 pass; step 3's no-match check finds nothing; the integration tests above pass. Final line of `bun run check:job`: `check:job PASS`.
