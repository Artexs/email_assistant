# F154 stage 02 — replies: drafter schema, decoded view, digits, input

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 03–17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Count |
| --- | --- | --- |
| `replies/schema.ts` | (module level): the `drafterOutputSchema` refinement | 42 (top 10) |
| `replies/views.ts` | `deobfuscate` (private; through `decodedView`, `viewsOf`) | 23 (top 10) |
| `replies/digits.ts` | `alnumStream`, `numberKeys` (private; through the exported digit and IBAN checks) | 7, 6 |
| `replies/input.ts` | `cutChars` | 7 |

Mutate globs: `src/replies/schema.ts`, `src/replies/views.ts`, `src/replies/digits.ts`, `src/replies/input.ts`.

## Cases (fixed values)

`replies/schema.ts` has no test file today; create `replies/schema.test.ts`. Base value V = `{ decision: "draft", reason_code: null, body: "Dzień dobry", gaps: [], language: "pl" }`.

1. V parses; the parsed value equals V.
2. `test.each` of refusals, each asserting the exact issue list `[{ path, message }]` from `safeParse(...).error.issues` (path and message only):
   - V with `reason_code: "needs_facts"` → `[["reason_code"], "reason_code must be null for a draft"]`.
   - V with `body: "   "` → `[["body"], "a draft needs a body"]`.
   - `{ ...V, decision: "no_draft", body: "" }` → `[["reason_code"], "no_draft needs a reason_code"]`.
3. `{ ...V, decision: "no_draft", reason_code: "not_a_reply", body: "" }` parses (no body needed for no_draft).
4. Limits: body of 10,000 characters parses, 10,001 fails; 20 gaps parse, 21 fail; a gap of 200 characters parses, 201 fails; an extra key `to` fails (strict); `language: "de"` fails.
5. `decodedView`: `test.each` of input → exact output, one row per `deobfuscate` rule: `"jan (at) firma (dot) pl"` → `"jan@firma.pl"`; `"jan [małpa] firma [kropka] pl"` → `"jan@firma.pl"`; `"jan{at}firma<dot>pl"` → `"jan@firma.pl"`; `"firma[.]pl"` → `"firma.pl"`; `"jan at firma dot pl"` → `"jan@firma.pl"`; `"H t t p s://x.pl"` → `"Https://x.pl"`; and a control row where the word "at" stands alone in prose (`"meet at noon"` → unchanged). The worker confirms each expected value against the code at `HEAD`; a different output is a P3 question, not a new expected value.
6. `cutChars("ab😀c", 3)` → `"ab😀"`; `cutChars("abc", 3)` → `"abc"` (same string); `cutChars("abcd", 3)` → `"abc"`.
7. Digits: one case per surviving mutant cluster of `alnumStream` and `numberKeys`, through the exported function the mutant report shows covering them, with the exact return value.

The 4 unstable regex mutants of `replies/digits.ts` (plan D5 `unstable`; F125 `review-core-web-tools.md` § Unstable mutants) need no case.

## Done when

- `results/stage-02.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- Any change to `replies/*.ts` source. Other `replies` functions with fewer than 5 counted mutants.
