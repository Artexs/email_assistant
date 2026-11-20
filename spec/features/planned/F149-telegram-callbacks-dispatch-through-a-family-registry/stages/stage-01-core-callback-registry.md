# F149 stage 01 — Core callback registry [risky]

Needs: nothing. Writes the core names below; stage 02 reads them.

Part of [`../plan.md`](../plan.md). Decisions D1–D8, D14.

## Step 1 — one record keyed by kind

- **Goal:** `encodeCallback` and `parseCallback` read one record; the encode switches, the decode if-chain and its `switch` blocks go.
- **Files:** `packages/core/src/digest/callback.ts`; `callback-kinds.ts` next to it if `callback.ts` would pass 400 lines (D14).
- **Interfaces:**
  - `callbackFamilies = ["feedback", "answered", "reply", "loop", "delegate", "approval"] as const`; `type CallbackFamily = (typeof callbackFamilies)[number]`.
  - `callbackKinds: { [K in Callback["kind"]]: { family: …; prefix: string; encode(…): …; decode(rest: string | undefined): Extract<Callback, { kind: K }> | null } }`. The codec shape is the worker's; a missing kind must be a type error, and `family` keeps its literal type.
  - `type CallbackOfFamily<F extends CallbackFamily>`: the union of the kinds whose entry names `F`.
  - `type ApprovalCallback`: the 9 approval kinds of D5, exported from core. `approval-taps.ts` imports it instead of its local `Exclude` (type only).
  - `callbackFamilyOf(callback: Callback): CallbackFamily`; `isCallbackOfFamily<F extends CallbackFamily>(callback: Callback, family: F): callback is CallbackOfFamily<F>`.
  - `encodeCallback` and `parseCallback` keep their names and signatures.
- **Decisions:** D2 (same bytes), D3 (split at the first `:`, `Map` lookup, anchored check of the rest, `null` on anything else), D4, D8 (error texts). Keep the base64url helpers and their canonical check for `dp`.
- **Done when:** no `switch` on a prefix or a kind is left in the codec; in the codec files, each prefix literal appears in code once, in its `callbackKinds` entry (comments and other core files do not count; D12).
- **Out of scope:** callers of the codec; the handlers; docs (stage 02).

## Step 2 — family predicates through the record

- **Goal:** `isAnsweredCallback`, `isReplyCallback`, `isLoopCallback`, `isDelegateCallback` and `isFeedbackCallback` become one-line wrappers over `isCallbackOfFamily`. `isReviewCallback` stays as it is. Stage 02 removes them all (D7).
- **Done when:** no other product file changes, except the type import in `approval-taps.ts`.

## Step 3 — tests

New file `packages/core/src/digest/callback-registry.test.ts`. Use the existing `ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"` and a second id `ID2 = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"` for `delegate_pick`. The golden table is typed `{ [K in Callback["kind"]]: { value: Extract<Callback, { kind: K }>; data: string; family: CallbackFamily } }`, so a new kind without a row fails typecheck.

1. Golden table, 33 rows: `encodeCallback(value)` is exactly `data`, and `parseCallback(data)` equals `value`. Take each `data` from the plan-base code (examples: `right`/urgent → `fr:u:${ID}`; `reply_review` → `rv`; `reject_reason`/not_needed → `rw:n:${ID}`; `delegate_pick` → `dp:<22>:<22>`). A separate case: `{ kind: "reply_review", afterId: ID }` ↔ `` `rv:${ID}` ``.
2. The 33 `callbackKinds` prefixes are distinct and each matches `/^[a-z]{2}$/`.
3. Each golden `data` is at most 64 bytes.
4. Each of these parses to `null`: `""`, `"ap"`, `"ap:"`, `` `ap:${ID}:x` ``, `` `ap:${ID}\n` ``, `` ` ap:${ID}` ``, `` `AP:${ID}` ``, `` `ap:${ID.toUpperCase()}` ``, `` `zz:${ID}` ``, `` `__proto__:${ID}` ``, `` `constructor:${ID}` ``, `"toString"`, `"hasOwnProperty"`, `` `fr:d:${ID}` ``, `` `rw:x:${ID}` ``, `` `fr:constructor:${ID}` ``, `` `vr:__proto__:${ID}` ``, `` `rw:toString:${ID}` ``, `"rv:"`, `` `dg:${ID}x` ``, and `dp:` with a 21-character second part.
5. `` `vr:d:${ID}` `` parses to `{ kind: "review_right", category: "delegation", emailId: ID }`.
6. For each golden row: `callbackFamilyOf(value)` is `family`; the family column follows D5 (9, 2, 6, 5, 2, 9 rows).
7. Type test, at compile time: for each family, `CallbackOfFamily<F>` equals its named union (`FeedbackCallback`, `AnsweredCallback`, `ReplyCallback`, `LoopCallback`, `DelegateCallback`, `ApprovalCallback`); a wrong member must fail `bun run typecheck`.

Step 2 is proven by the unchanged asserts of the old predicates in `callback.test.ts` and `callback-loop.test.ts`.

Break checks, each restored and reported: change one prefix in `callbackKinds` (test 1 fails); replace the prefix `Map` by a plain object lookup (test 4 fails on `__proto__` or `constructor`); read the category code by `split(":")` and a plain-object lookup with no anchored pattern (test 4 fails on `fr:constructor:`); add a kind to `Callback` with no `callbackKinds` entry (`bun run typecheck` fails).

The existing files `callback.test.ts`, `callback-loop.test.ts`, `digest.test.ts`, `approvals.test.ts` and `approvals-follow-up.test.ts` pass with no edit.

## Check

- `bun test packages/core/src/digest/` while you work.
- Last: `bun run check:job`.

## Done when

Tests 1–7 pass; the five existing test files above have no diff. Final line of `bun run check:job`: `check:job PASS`.
