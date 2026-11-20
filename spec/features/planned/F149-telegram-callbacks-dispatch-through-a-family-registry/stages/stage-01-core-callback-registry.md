# F149 stage 01 — Core callback registry [risky]

Needs: nothing. Writes `callbackKinds`, `callbackFamilies`, `CallbackFamily`, `CallbackOfFamily`, `ApprovalCallback`, `callbackFamilyOf`, `isCallbackOfFamily` in `@ea/core`; stage 02 reads them.

Part of [`../plan.md`](../plan.md). Decisions D1–D8, D14.

## Step 1 — one record keyed by kind

- **Goal:** `encodeCallback` and `parseCallback` read one record; the encode switches, the decode if-chain and its `switch` blocks go.
- **Files:** `packages/core/src/digest/callback.ts`; `callback-kinds.ts` next to it if `callback.ts` would pass 400 lines (D14).
- **Interfaces:**
  - `callbackFamilies = ["feedback", "answered", "reply", "loop", "delegate", "approval"] as const`; `type CallbackFamily = (typeof callbackFamilies)[number]`.
  - `callbackKinds: { [K in Callback["kind"]]: { family: …; prefix: string; encode(…): …; decode(rest: string | undefined): Extract<Callback, { kind: K }> | null } }`. The exact codec shape is the worker's; the mapped type must make a missing kind a type error, and the family field must keep its literal type, so `CallbackOfFamily<F>` can be derived.
  - `type CallbackOfFamily<F extends CallbackFamily>`: the union of the kinds whose entry names `F`.
  - `type ApprovalCallback`: the 9 approval kinds of D5, exported from core. `approval-taps.ts` imports it instead of its local `Exclude` (a type-only change; the handler body stays).
  - `callbackFamilyOf(callback: Callback): CallbackFamily`; `isCallbackOfFamily<F extends CallbackFamily>(callback: Callback, family: F): callback is CallbackOfFamily<F>`.
  - `encodeCallback` and `parseCallback` keep their names and signatures.
- **Decisions:** D2 (same bytes), D3 (split at the first `:`, `Map` lookup, anchored check of the rest, `null` on anything else), D4, D8 (error texts). Keep the base64url helpers and their canonical check for `dp`.
- **Done when:** no `switch` on a prefix or a kind is left in the codec; each prefix string appears once in core product code (in its `callbackKinds` entry). Lab and simulator strings stay (D12).
- **Out of scope:** callers of the codec; the handlers; docs (stage 02).

## Step 2 — family predicates through the record

- **Goal:** `isAnsweredCallback`, `isReplyCallback`, `isLoopCallback`, `isDelegateCallback` and `isFeedbackCallback` become one-line wrappers over `isCallbackOfFamily`. `isReviewCallback` stays as it is. Stage 02 removes them all (D7).
- **Done when:** no other product file changes, except the type import in `approval-taps.ts`.

## Step 3 — tests

New file `packages/core/src/digest/callback-registry.test.ts`. Use the existing `ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"` and a second id `ID2 = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"` for `delegate_pick`. The golden table is typed `{ [K in Callback["kind"]]: { value: Extract<Callback, { kind: K }>; data: string; family: CallbackFamily } }`, so a new kind without a row fails typecheck.

1. Golden table, 33 rows: `encodeCallback(value)` is exactly `data`, and `parseCallback(data)` equals `value`. Take each `data` from the code at the plan base (examples: `right`/urgent → `fr:u:${ID}`; `reply_review` → `rv`, plus one extra row with `afterId: ID`; `reject_reason`/not_needed → `rw:n:${ID}`; `delegate_pick` → `dp:<22>:<22>`).
2. The 33 `callbackKinds` prefixes are distinct and each matches `/^[a-z]{2}$/`.
3. Each golden `data` is at most 64 bytes (`new TextEncoder().encode(data).length`).
4. Each of these parses to `null`: `""`, `"ap"`, `"ap:"`, `` `ap:${ID}:x` ``, `` `ap:${ID}\n` ``, `` ` ap:${ID}` ``, `` `AP:${ID}` ``, `` `ap:${ID.toUpperCase()}` ``, `` `zz:${ID}` ``, `` `__proto__:${ID}` ``, `` `constructor:${ID}` ``, `"toString"`, `"hasOwnProperty"`, `` `fr:d:${ID}` ``, `` `rw:x:${ID}` ``, `"rv:"`, `` `dg:${ID}x` ``, and `dp:` with a 21-character second part.
5. `` `vr:d:${ID}` `` parses to `{ kind: "review_right", category: "delegation", emailId: ID }`.
6. For each golden row: `callbackFamilyOf(value)` is `family`; the family column follows D5 (9, 2, 6, 5, 2, 9 rows).
7. Type test, at compile time: for each family, `CallbackOfFamily<F>` equals its named union (`FeedbackCallback`, `AnsweredCallback`, `ReplyCallback`, `LoopCallback`, `DelegateCallback`, `ApprovalCallback`). Use an `Equal<A, B>` helper; a wrong member must fail `bun run typecheck`.
8. For each golden row, each old predicate gives the same answer as `isCallbackOfFamily(value, <its family>)` (proves step 2 changed nothing).

Break checks: change one prefix in `callbackKinds` and see test 1 fail; replace the `Map` lookup by a plain object lookup and see test 4 fail on `__proto__` or `constructor`; restore both. Report them.

The existing files `callback.test.ts`, `callback-loop.test.ts`, `digest.test.ts`, `approvals.test.ts` and `approvals-follow-up.test.ts` pass with no edit.

## Check

- `bun test packages/core/src/digest/` while you work.
- `bun run typecheck` once after step 3.
- Last: `bun run check:job`.

## Done when

Tests 1–8 pass; the five existing test files above have no diff. Final line of `bun run check:job`: `check:job PASS`.
