# F164 stage 01 — Sentence counter and leaning scan

Needs: nothing. May run next to 04.
Part of [`../plan.md`](../plan.md). Decisions: D2, D11.

## Step 1 — `classifyReplySentences` in `@ea/core`

- **Goal:** one pure function says how much of a draft is real text, how much is skeleton, and which sentences lean toward a commitment.
- **Files:** a new `packages/core/src/replies/sentences.ts`, exported from the replies index of `@ea/core`; its test next to it.
- **Interface (stages 02, 03, 05–07 use it):**
  ```ts
  export interface ReplySentenceCounts { prose: number; gapSentences: number; template: number; leaning: number }
  export function classifyReplySentences(body: string): ReplySentenceCounts;
  export function isSkeletonDraft(counts: ReplySentenceCounts): boolean; // prose === 0 && gapSentences === 0
  export const LEANING_PHRASES: { en: readonly string[]; pl: readonly string[] };
  ```
- **Rules (fixed):**
  - Lines split on `\n`. The greeting is the first non-empty line when it ends with `,` or `!` and has at most 6 words; it is not counted.
  - Each gap `[[…]]` becomes one placeholder before the split, so a `.` in a label does not split.
  - The rest splits into sentences at a line break and after `.`, `!` or `?` that a space or the end follows, except after these abbreviations (case-insensitive): `np.`, `godz.`, `ok.`, `tj.`, `nr.`, `ul.`, `dr.`, `e.g.`, `i.e.`, `etc.`, `mr.`, `ms.`, `mrs.`. Empty pieces are dropped.
  - A sentence with a gap is `template` when it matches `^(Regarding|W sprawie) <1–80 characters>: <gap>\.?$`, else `gapSentences`.
  - A sentence with no gap is `prose` when it has at least 3 words and is not one of the two fixed thanks of drafter-v4 ("Dziękuję za wiadomość.", "Thank you for your email."). A shorter one counts nowhere.
  - `leaning` counts the counted sentences (any of the three kinds) whose text outside the gaps holds a phrase of `LEANING_PHRASES` (case-insensitive, whole words). The lists (D11): en "I would", "I will", "I'll", "we will", "we'll", "my preference", "my position", "I agree", "I accept", "I confirm", "I can confirm", "I keep", "please book"; pl "podtrzymuję", "zgadzam się", "akceptuję", "potwierdzam", "wyślę", "prześlę", "zadzwonię", "odezwę się", "wrócę", "moja preferencja", "moje stanowisko", "proponuję".
- **Test (`test.each`, exact objects):**
  1. `"Dear Karin Lindqvist,\nRegarding certificate responsibility: [[accept or decline]].\nRegarding shipment arrival: [[yes or no and date]]."` → `{ prose: 0, gapSentences: 0, template: 2, leaning: 0 }`, skeleton true.
  2. `"Dzień dobry,\nDziękuję za wiadomość.\nW sprawie terminu odprawy: [[tak lub nie]]."` → `{ 0, 0, 1, 0 }`, skeleton true.
  3. `"Cześć Anna,\nDziękuję za przesłanie harmonogramu wdrożenia.\nCo do terminu odprawy: [[tak lub nie]]."` → `{ 1, 1, 0, 0 }`, skeleton false.
  4. `"Dear Tom Baker,\nThursday at 10:00 works for me. See you then."` → `{ 2, 0, 0, 0 }`.
  5. `""` → `{ 0, 0, 0, 0 }`, skeleton true.
  6. `"Hi Tom,\nOk."` → `{ 0, 0, 0, 0 }`.
  7. `"Dear Tom, thanks for the update.\nRegarding the budget: [[yes or no]]."` (no greeting line) → `{ 1, 0, 1, 0 }`.
  8. `"Dzień dobry,\nW sprawie umowy: [[tak lub nie, wersja 2.1]]."` → `{ 0, 0, 1, 0 }`.
  9. `"Dzień dobry,\nSpotkanie np. we wtorek o godz. 10:00 jest w planie."` → `{ 1, 0, 0, 0 }` (no split at `np.` or `godz.`).
  10. `"Dear Anna Nowak,\nMy preference on the payment terms is: [[current or extended]]."` → `{ 0, 1, 0, 1 }`.
  11. `"Dzień dobry,\nDokumenty wyślę do [[data]]."` → `{ 0, 1, 0, 1 }`.
  12. `"Hi Tom,\nI willingly share the agenda draft."` → `leaning: 0` ("I will" is no whole-word match in "I willingly").
- **Check:** `bun test packages/core/src/replies/sentences.test.ts`; break the template regex once and see case 1 fail; drop the abbreviation list once and see case 9 fail.
- **Done when:** the 12 cases pass.
- **Out of scope:** any production use (`checkReplyBody`, the drafter job): D2, a measure only.

## Done when (stage)

Step 1 done. Proof: the last line of `bun run check:job`.
