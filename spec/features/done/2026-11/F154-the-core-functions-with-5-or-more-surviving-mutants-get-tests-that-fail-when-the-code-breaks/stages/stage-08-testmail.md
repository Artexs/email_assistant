# F154 stage 08 — testmail batch validation, compare table, send log

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–07, 09–17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Count |
| --- | --- | --- |
| `testmail/batch.ts` | `validateBatch` | 26 (top 10) |
| `testmail/batch.ts` | (module level): the persona file schema refinement | 6 |
| `testmail/target.ts` | `buildCompareRows`, `renderCompareTable` | 13, 10 |
| `testmail/send-log.ts` | `caseStates` | 9 |
| `testmail/blind.ts` | (module level) | 5 |
| `testmail/plan.ts` | `planSends` | 5 |

Mutate globs: `src/testmail/batch.ts`, `src/testmail/target.ts`, `src/testmail/send-log.ts`, `src/testmail/blind.ts`, `src/testmail/plan.ts`.

The audit marked `testmail/batch.ts` 107:5 unstable (plan D5 `unstable`).

## Cases (fixed values)

`validateBatch`: build a valid two-case batch and persona file from the fixtures of `testmail/batch.test.ts`; `opts = { fileBatchId: <batch id>, requireBlind: false }`. Each row asserts the exact issue array (`caseId`, `code`, `detail`):
1. The valid batch → `[]`.
2. `test.each`, one rule per row:
   - two cases with id `c1` → one issue on the second `c1` only: `{ code: "duplicate_id", detail: "id: not unique in the batch" }`;
   - persona key absent → `unknown_persona`, `"persona: key not in the persona file"` (and no `lang_mismatch`);
   - persona lang `pl`, case lang `en` → `lang_mismatch`, `"lang: differs from the persona lang"`;
   - `replyTo: "nope"` → `reply_unknown`, `"replyTo: no case with this id"`;
   - `replyTo` to itself and to a later case → `reply_not_earlier`, `"replyTo: parent is not an earlier case"`;
   - `replyTo` an earlier case of another persona whose group is not `work` → `reply_persona`; the same with group `work` → no issue; the same persona → no issue;
   - subject `"a\nb"` and `"a\rb"` → `subject_line_break`, `"subject: contains a line break"`;
   - body with `jan@gmail.com` → `address_not_reserved`, `"body: address host not reserved"`; subject with it → `"subject: address host not reserved"`;
   - body with `https://gmail.com/x` → `url_not_reserved`, `"body: host not reserved"`;
   - body with `123456789` → `phone_number`, `"body: number with 9 or more digits"`; `12345678` → no issue;
   - `testAddress: " Test@Example.COM "` and a body holding `test@example.com` → `test_address`, `"body: contains the test mailbox address"`;
   - `delegatesActive: false` with expected `delegation` → `delegation_without_delegates`, `"expected: delegation needs delegatesActive"`; with `requireBlind: true` and blind `delegation` → also `"blind: delegation needs delegatesActive"`;
   - `requireBlind: true`, no blind → `blind_missing`; blind category differs → `blind_disagrees`; differs with note `"borderline: x"` → no issue;
   - `fileBatchId` differs → `{ caseId: null, code: "batch_id_mismatch", detail: "batch: differs from the file name" }`, last in the list.
3. Order: a case that breaks three rules lists them in the code's order.

Persona file schema:
4. Two personas with key `p1` → the exact issue `{ path: ["personas", 1, "key"], message: "persona key not unique" }`.

`buildCompareRows` and `renderCompareTable`:
5. One row per case of the batch in batch order with the exact cells; a case with no target result → the empty-result cell at `HEAD`.
6. `renderCompareTable([])` and a two-row table → the exact Markdown string; a cell with `|` or a newline → escaped as `cell()` does at `HEAD`.

`caseStates`:
7. A case sent, then a later failure line → the later state wins; a line with `at` equal to the send time → the code's result at `HEAD` (kills the `<=` mutant); a case never sent → its initial state.

`planSends` and `blind.ts`:
8. One case per surviving mutant cluster with the exact returned plan and blind view.

## Done when

- `results/stage-08.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- The testmail CLI scripts in `apps/server`. New issue codes.
