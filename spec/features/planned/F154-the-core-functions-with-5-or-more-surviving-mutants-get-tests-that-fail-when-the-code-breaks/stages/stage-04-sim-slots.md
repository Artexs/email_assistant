# F154 stage 04 — sim slot schemas and scenario validation

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02, 03, 05–17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Count |
| --- | --- | --- |
| `sim/sent-slot.ts` | (module level): the `sentSlotSchema` and `sentLabelSchema` refinements | 33 (top 10) |
| `sim/sent-slot.ts` | `labelIssues` (private; through `sentSlotSchema`) | 6 |
| `sim/scenario.ts` | `validateScenario` | 23 |
| `sim/slot.ts` | (module level): the slot schema refinement | 6 |
| `sim/hard-cases.ts` | (module level): the hard-case rule table | 5 |

Mutate globs: `src/sim/sent-slot.ts`, `src/sim/scenario.ts`, `src/sim/slot.ts`, `src/sim/hard-cases.ts`.

## Cases (fixed values)

Each refusal asserts the exact issue list `[{ path, message }]` (path array and message; not `toContain`). Build a valid base slot from the existing fixtures of `sim/sent-slot.test.ts`; each row changes one field.

`sentSlotSchema`:
1. The valid base slot parses and equals its parsed value.
2. `test.each` of one rule per row:
   - the same address in `to` and `cc` → `[["to"], "a recipient appears twice"]`;
   - the persona in `to` → `[["to"], "the executive is no recipient"]`;
   - `quoted: true` with an empty thread → `[["quoted"], "quoted needs a thread mail"]`;
   - `labels.ask` set with `expectsReply: false` → `[["labels.ask"], "ask is set if and only if expectsReply"]`, and `ask: null` with `expectsReply: true` → the same issue;
   - `labels.due` set with `expectsReply: false` → `[["labels.due"], "due needs expectsReply"]` (plus the ask issue when `ask` is set; build the row so only one fires);
   - `promise` without `promiseDue`, and `promiseDue` without `promise` → `[["labels.promiseDue"], "promise and promiseDue are set together"]`.
3. Hard-case rules: for each tag of the sent hard-case table, one row that breaks its rule, with the exact message, for example `"<tag> sets expectsReply to true"`, `"<tag> has no due label"`, `"<tag> has a time-word due"`, `"<tag> has no promise label"`, `"<tag> needs a thread mail"`, `"<tag> needs a quoted mail"`, `"<tag> needs more than 10 recipients"`. The recipients edge: exactly 10 recipients fails, 11 passes.
4. Defaults: a slot without `quoted` parses to `quoted: false`; without the defaulted list field to `[]`.
5. Limits: `brief` of 300 characters parses, 301 fails, `""` fails.

`sentLabelSchema` (the checker label; `promise` is a boolean there):
5a. A valid label parses. `promise: true` with `promiseDue: null`, and `promise: false` with `promiseDue` set → `[["promiseDue"], "promise and promiseDue are set together"]`; `due` set with `expectsReply: false` → `[["due"], "due needs expectsReply"]`; both broken → both issues in that order. Build the valid label from the existing fixtures (`blindHash` is 64 hex characters).

`sim/slot.ts` schema:
6. `category: "urgent"` without `urgencySource` → `[["urgencySource"], "urgencySource is set if and only if the category is urgent"]`; a non-urgent slot with `urgencySource` → the same.
7. `urgencySource: "context"` without `contextRef` → `[["contextRef"], "contextRef is set if and only if the urgency source is context"]`; `contextRef` with another source → the same.

`validateScenario`:
8. A valid scenario → `[]`.
9. `test.each` of one rule per row with the exact `{ code, detail }`: duplicate persona key → `{ code: "duplicate_key", detail: "persona: <key>" }`; a persona with the executive's address → `{ code: "duplicate_address", detail: "persona: <key> shares an address with <executive key>" }`; a persona on a non-reserved host (`a@gmail.com`) → `{ code: "address_not_reserved", detail: "persona: <key>" }`; and one row for each further code the function emits at `HEAD`.

Hard-case table (`sim/hard-cases.ts`):
10. For the surviving module-level mutants (array and object literals of the rule table), one case per rule that asserts the exact slot fields the rule builds with a fixed RNG seed, using the existing plan-bank helpers.

## Done when

- `results/stage-04.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- Changes to slot fields, rule tags or messages.
