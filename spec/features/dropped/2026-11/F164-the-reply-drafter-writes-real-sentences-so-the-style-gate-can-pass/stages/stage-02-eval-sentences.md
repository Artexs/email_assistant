# F164 stage 02 — Sentence counts in every drafter run

Needs stage 01: `classifyReplySentences`, `ReplySentenceCounts`.
Part of [`../plan.md`](../plan.md). Decisions: D2, D11.

## Step 1 — counts at run time, stored with no text

- **Goal:** each drafted case carries its sentence counts, also in a holdout run, where no draft text is ever kept.
- **Files:** the drafter eval of the replies module (`drafter-eval.ts`: `drafterCaseResultSchema`, `runDrafterCase`); its test.
- **Interface (stages 03, 05–07 read it):** `drafterCaseResultSchema` gets an optional field `sentences: ReplySentenceCounts` (numbers only). `runDrafterCase` fills it from the body for an outcome `draft`, at the place where it computes `leak` today. Other outcomes have no field. The state file stays text-free.
- **Decisions:** a result of an older state file (no field) still parses. The field is optional so that resumed runs of v1–v4 states keep working.
- **Test:**
  1. A fake drafter returns the body of stage 01 case 3 → the result has `sentences` `{ prose: 1, gapSentences: 1, template: 0, leaning: 0 }`.
  2. A fake `no_draft` answer → the result has no `sentences` field.
  3. A state line without `sentences` parses (the v4 shape).
  4. The state line written for case 1 holds no string of the body (the existing no-text test covers the new field too).
- **Check:** `bun test` on the drafter eval test file.
- **Done when:** cases 1–4 pass.

## Step 2 — the "Sentences" block of the report

- **Goal:** every drafter eval report shows the shape of its drafts and the leaning count.
- **Files:** the drafter eval report module; its test.
- **Interface:** one block "Sentences":
  - `drafts with a full sentence: N of M` (`prose ≥ 1`);
  - `skeleton drafts: K of M` (`isSkeletonDraft`);
  - `mean prose sentences: X.XX`;
  - `leaning sentences: L` and, when L > 0, `leaning ids: <case ids>` (ids only, never text);
  - `not measured: U` for drafts with no `sentences` field (a resumed older state).
  A run with no draft prints `0 of 0`.
- **Decisions:** D2: the gate file, `gatePassed` and the bars do not change. D11: the leaning ids are allowed in a holdout report (ids and counts only).
- **Test:** a report test with four fake results: bodies of stage 01 cases 1, 3, 4 and 10 → `drafts with a full sentence: 2 of 4`, `skeleton drafts: 1 of 4`, `mean prose sentences: 0.75`, `leaning sentences: 1`, `leaning ids: <id of case 10>`; plus one draft without the field → `not measured: 1`. A gate-file test passes unchanged.
- **Check:** `bun test` on the report test file.
- **Done when:** the test passes.

## Done when (stage)

Both steps done; the `docs/capabilities/` page of the offline lab that describes the drafter report names the block. Proof: the last line of `bun run check:job`.

## Out of scope

New bars; any production use.
