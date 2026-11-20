# F122 stage 08 — The style gate command

Part of [`../plan.md`](../plan.md). Needs stage 07: the style key in the state file names and the `style_match` score of `judge-v4` in the state lines. No real call.

One command compares two drafter runs case by case and writes the gate file of the stylist prompt.

## Step 1 — `eval:style-gate`

- **Goal:** `bun run eval:style-gate --a <state> --b <state> --style <style file> --injection <injection result file> --out <report.md>` (`runCli`, risk class as `eval`). It pairs the cases by id, writes the report, and writes the gate file `evals/results/gate/stylist-<stylist promptVersion>-<stylist model>-<stylist effort>-lab-01-v1.json` (the stylist values come from the style file) only when both runs are full judged holdout runs (no `--limit`) with `judge-v4`, the same drafter prompt, model and effort, A with style key `none`, B with this style file.
- **Decisions (D15, `questions.md` 8):**
  - **Pairs.** A pair = a case that both runs drafted and the judge scored. A designed skip (language, `no_draft`) in either run is not a pair and not an error. Error share = cases with a provider or judge error in either run / all cases; above 5% → fail `too_many_errors`.
  - **Gain.** `wins` (B `style_match` > A), `losses`, `ties`; `n = wins + losses ≥ 20`; Wilson 95% lower bound of `wins / n` > 0.5; mean B − mean A ≥ 0.1.
  - **No loss on facts, absolute (B):** code checks 100%; invented commitments 0; planted leaks 0; send as is ≥ 0.8; `needs_facts` share ≤ 0.3.
  - **No loss on facts, paired** (review N4: an absolute difference is within run noise): `lossFlips` = pairs with A send as is true and B false, `gainFlips` the reverse; fail when the Wilson 95% lower bound of `lossFlips / (lossFlips + gainFlips)` > 0.5. The same test for `answers_every_question` (B lower than A vs B higher).
  - The style file has `checks.ok: true`; the injection result is all passed. `passed` = every bar holds. The gate file holds `bars`, `numbers` (both runs), the drafter, judge and stylist versions and models, and the style file path.
- **Test (unit, fixed state lines):**
  1. 30 wins, 10 losses, means 1.0 and 1.4 → Wilson lower 0.5981, pass.
  2. 12 wins, 8 losses → 0.3866, fail on gain.
  3. 16 wins, 0 losses → fail (`n` < 20).
  4. Gain passes, B has 1 invented commitment → fail.
  5. `lossFlips` 20, `gainFlips` 5 → lower bound 0.6087, fail; 6 and 4 → 0.3127, pass.
  6. 6% of the cases have a judge error in A → `too_many_errors`; 6% `no_draft` in B and no error → not `too_many_errors`.
  7. A `--limit` run, or A with style key `scenario` → report only, no gate file.
- **Check / Done when:** the touched tests pass; `docs/capabilities/measurement.md` names the command and its bars; the Proof line is PASS.
- **Out of scope:** real runs and the verdict (09).
