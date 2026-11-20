# F164 stage 01 — Sentence counter and report lines

Needs: nothing. May run next to 03.
Part of [`../plan.md`](../plan.md). Decisions: D2.

## Step 1 — `classifyReplySentences` in `@ea/core`

- **Goal:** one pure function says how much of a draft is real text and how much is skeleton.
- **Files:** a new `packages/core/src/replies/sentences.ts`, exported from the replies index of `@ea/core`; its test next to it.
- **Interface (stage 02 and 04 use it):**
  ```ts
  export interface ReplySentenceCounts { prose: number; gapSentences: number; template: number }
  export function classifyReplySentences(body: string): ReplySentenceCounts;
  export function isSkeletonDraft(counts: ReplySentenceCounts): boolean; // prose === 0 && gapSentences === 0
  ```
- **Rules (fixed):**
  - Lines are split on `\n`. The greeting is the first non-empty line when it ends with `,` or `!` and has at most 6 words; it is not counted.
  - Each gap `[[…]]` becomes one placeholder before the split, so a `.` in a label does not split.
  - The rest splits into sentences at a line break and after `.`, `!` or `?` that a space or the end follows. Empty pieces are dropped.
  - A sentence with a gap is `template` when it matches `^(Regarding|W sprawie) <1–80 characters>: <gap>\.?$`, else `gapSentences`.
  - A sentence with no gap is `prose` when it has at least 3 words and is not one of the two fixed thanks of drafter-v4 ("Dziękuję za wiadomość.", "Thank you for your email."). A shorter one counts nowhere.
- **Test (`test.each`, exact objects):**
  1. `"Dear Karin Lindqvist,\nRegarding certificate responsibility: [[accept or decline]].\nRegarding shipment arrival: [[yes or no and date]]."` → `{ prose: 0, gapSentences: 0, template: 2 }`, skeleton true.
  2. `"Dzień dobry,\nDziękuję za wiadomość.\nW sprawie terminu odprawy: [[tak lub nie]]."` → `{ 0, 0, 1 }`, skeleton true.
  3. `"Cześć Anna,\nDziękuję za przesłanie harmonogramu wdrożenia.\nCo do terminu odprawy: [[tak lub nie]]."` → `{ 1, 1, 0 }`, skeleton false.
  4. `"Dear Tom Baker,\nThursday at 10:00 works for me. See you then."` → `{ 2, 0, 0 }`.
  5. `""` → `{ 0, 0, 0 }`, skeleton true.
  6. `"Hi Tom,\nOk."` → `{ 0, 0, 0 }`.
  7. `"Dear Tom, thanks for the update.\nRegarding the budget: [[yes or no]]."` (no greeting line) → `{ 1, 0, 1 }`.
  8. A label with a dot: `"Dzień dobry,\nW sprawie umowy: [[tak lub nie, wersja 2.1]]."` → `{ 0, 0, 1 }`.
- **Check:** `bun test packages/core/src/replies/sentences.test.ts`; break the template regex once and see case 1 fail.
- **Done when:** the 8 cases pass.
- **Out of scope:** any production use (`checkReplyBody`, the drafter job). D2: a measure only.

## Step 2 — report lines of a drafter run

- **Goal:** every drafter eval report shows the sentence shape of its drafts.
- **Files:** the drafter eval report and the per-case result of the replies module (the worker finds the seam; the counts come from the body the eval already keeps for a draft).
- **Interface:** the drafter case result carries `sentences: ReplySentenceCounts` for an outcome `draft`. The report adds one block "Sentences": drafts with at least one prose sentence `N of M`; skeleton drafts `K of M`; mean prose sentences per draft (2 decimals). A run with no draft prints `0 of 0`.
- **Decisions:** D2: the gate file and `gatePassed` do not change. The state file may hold the counts (no text); a resumed result from an older state file without counts counts as "not measured" and the block says `not measured: X`.
- **Test:** a report test with three fake results (bodies of cases 1, 3, 4 above) prints `drafts with a full sentence: 2 of 3`, `skeleton drafts: 1 of 3`, `mean prose sentences: 1.00`; a result without counts prints `not measured: 1`.
- **Check:** `bun test` on the changed report test file.
- **Done when:** the test passes; a gate-file test still passes unchanged.
- **Out of scope:** new bars.

## Done when (stage)

Both steps done; `docs/capabilities/` page of the offline lab (the one that lists the drafter report) names the block. Proof: the last line of `bun run check:job`.
