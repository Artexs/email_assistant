# F149 plan — Telegram callbacks dispatch through a family registry

> **Status 2026-11-20 — planned.** Plan base: e8f6f2b1. No stage built.

## Input

Source, word for word (`spec/quality/2026-11-20-pass-2.md` finding 10): "A new family needs edits in the encoder, the decoder, the predicate list and the dispatch." Rule: "Registries (a typed record keyed by the enum, with a test against the enum …) over if-chains for handlers". Fix: "One `callbackFamilies` record keyed by family (`answered`, `reply`, `loop`, `delegate`, `feedback`, `approval`) holding the prefix list and the handler; `handleCallback` looks the family up. A test checks that every callback kind belongs to one family." OWNER: no.

### Decisions

- **D1 Two records, one per layer.** Core holds `callbackKinds`, keyed by kind: `{ family, prefix, encode, decode }`. The server holds `callbackHandlers`, keyed by family. Reason: `@ea/core` is pure and cannot hold server handlers; a codec per kind removes the switches. Rejected: one record with prefix lists and handlers (the quality-pass text; it breaks the core border).
- **D2 Wire format frozen.** Each of the 33 kinds encodes to the same bytes as at the plan base. Buttons already in chats, the lab bot (it builds `rw:` by hand) and a rollback depend on it. Existing assertions in `callback.test.ts` and `callback-loop.test.ts` stay as they are; stage 02 changes only the asserts of removed predicates (same truth values).
- **D3 Parse by prefix.** Split the data at the first `:`: the prefix is before it, the rest after it (no rest when there is no `:`). Look the prefix up in a `Map` built from `callbackKinds`. Never index a plain object with data: `__proto__`, `constructor` and `toString` must give `null`. An unknown prefix gives `null`. The decoder of the kind checks the rest with an anchored pattern, as today (lowercase UUID, category codes, reason codes, canonical base64url for `dp`). Rejected: a table of whole-string regexes tried in order (keeps the order dependency).
- **D4 Prefix rule.** Every prefix is two lowercase letters and unique across kinds. A test checks both.
- **D5 Families and members** (as at the plan base): `feedback` = right, edit, undo, pick, cancel, review_right, review_pick, review_edit, review_cancel; `answered` = answered_yes, answered_no; `reply` = the 6 `reply_*` kinds; `loop` = the 5 `loop_*` kinds; `delegate` = delegate_open, delegate_pick; `approval` = approve, reject, approve_set, reject_set, send_again, went_out, delegation_done, reject_reason, mistake. `callbackFamilies` lists them in this order.
- **D6 Family types.** Core keeps `FeedbackCallback`, `AnsweredCallback`, `ReplyCallback`, `LoopCallback`, `DelegateCallback` and adds `ApprovalCallback` (today a local `Exclude` in `approval-taps.ts`). `CallbackOfFamily<F>` is derived from `callbackKinds`; a type test proves it equals the named union for each family.
- **D7 Family API.** `callbackFamilyOf(callback): CallbackFamily` and `isCallbackOfFamily(callback, family)` (a type guard). Stage 01 keeps the five old predicates as one-line wrappers. Stage 02 removes them and `isReviewCallback` (no caller), and moves every caller to the family API.
- **D8 Encode errors stay.** `"bad email id"` for the feedback family, `"bad id"` for the rest; the throw comes before any string is built.
- **D9 Handler shape.** `TapInput = { deps: CallbackDeps; link: LinkedChat; ctx: TenantContext; texts: CoreTexts; tapSource: TapSource }`. `CallbackHandler<F> = (input: TapInput, callback: CallbackOfFamily<F>) => Promise<CallbackResult>`. `callbackHandlers: { [F in CallbackFamily]: CallbackHandler<F> }`. Each entry is a thin adapter to the existing handler; handler signatures do not change. Reason: the handlers are out of scope, and fewer edits mean fewer land conflicts. Rejected: one signature for all handlers.
- **D10 Dispatch.** `dispatchCallback(handlers, input, callback)` looks up `handlers[callbackFamilyOf(callback)]`. At most one type cast, inside it, with a comment. `handleCallback` keeps its signature: parse, `null` → `taps.invalid`, else dispatch. No role, flag or consent check moves into the dispatch.
- **D11 Feedback handler.** The inline feedback body leaves `handleCallback` for `handleFeedbackCallback` in a new `channels/feedback-taps.ts`, with `pickerMessage`. Behaviour and answers stay the same.
- **D12 Lab and simulator stay** (default, owner to confirm; `questions.md` 1). `lab/executive.ts` and `sim/live/executive.ts` keep their prefix strings. D2 keeps them valid. Rejected: move them to the codec (the lab stores code letters in its event log; a test tool that may move to `tools/`, quality-pass finding 12).
- **D13 No feature flag.** No user-visible change; the flag rule is for new behaviour.
- **D14 File size.** Each touched file stays under 400 lines (the size lint of the file-split ticket F143). The codec table goes to `packages/core/src/digest/callback-kinds.ts` when `callback.ts` would pass 400; both export through `digest/index.ts`.
- **D15 Docs.** Stage 02 updates rule 10 and the Telegram rows of `docs/capabilities/digest-and-notices.md`: where a new kind and a new family go, and that the prefix list is in `callbackKinds`.

### Edge cases answered

- Old buttons in chats, a rollback, the lab: D2. Forged and odd data: D3 (stage 01 test 4). Tenant: from the link, unchanged. No DB, no job, no send path changes; crash and repeat do not apply.

## Facts checked

- At e8f6f2b1: `callback.ts` has 33 kinds and 33 two-letter prefixes (`rv` alone is valid; `dp` holds two base64url UUIDs, 48 bytes). Only `callbacks.ts` dispatches; `isFeedbackCallback` is "has `emailId` and is not answered, delegate or reply". Callers of the predicates: `callbacks.ts`, `digest.test.ts`, `callback.test.ts`, `callback-loop.test.ts`. `isReviewCallback` has no product caller. Read by the planner, scouts 1–3 (`scouts.md`).
- `toThrow("bad id")` does not match `"bad email id"` (substring match), so D8 keeps both tests true.

## Not verified

- The type test of D6 compiles with the `tsc` of the repo. Stage 01 proves it (typecheck).

## Done when

The acceptance list of `ticket.md` (5 items) holds, and the last line of `bun run check:job` of each stage reads `check:job PASS`.

## Rules for every stage

- A gap or a deviation from a decision is a question in the final message, not a choice.
- Format and lint only the files of the stage.
- Run one test file with `bun test <file>`; no full suite while you work. The last step is `bun run check:job`.
- For a guard that the stage keeps (the `null` for forged data, the unknown prefix), break it, run its test, see it fail, restore it. List each in the final message.

## Proof

`bun run check:job`; the final message copies its last line (`check:job PASS master=… tip=…`).

## Owner checkpoints and steps

None. No migration, no VPS, no secret.

## Review

Stage 01 `[risky]` (parse of untrusted Telegram data): review before the land, `claude-opus-5-5`. Stage 02: review before the land, `claude-sonnet-5-5` (dispatch reaches the approve path).

## Stages

- [01 · Core callback registry](stages/stage-01-core-callback-registry.md) `[risky]`
- [02 · Server family dispatch](stages/stage-02-server-family-dispatch.md)

## How to run (coordinator)

Move the ticket to `active/` and commit. Spawn stage 01 (board worker model, `--prepare 'bash scripts/limen-prepare.sh'`, text: `Implement F149 stage 01. Read ticket.md, plan.md and stages/stage-01-core-callback-registry.md. Final proof: bun run check:job.`). Land it with `--keep-open`; then spawn stage 02 and land it without `--keep-open`. Overlap: the file-split ticket F143 stage 08 may edit `channels/` files; advisory, "merge master, re-prove". Drop the job DB after each land.

## Planning progress

- Scouts: 3 (`scouts.md`).
- ticket.md [written], plan.md [written], stage 01 [written], stage 02 [written].
- Word counts: see § Cold review.

## Cold review

Not run yet.

## Log

- 2026-11-20 planned at e8f6f2b1.
