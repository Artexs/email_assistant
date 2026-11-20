# F122 stage 07 — Style A/B run and judge-v4

Part of [`../plan.md`](../plan.md). Needs: the style file format of `interfaces.md` § Eval (no code of stage 06). May run next to 06 (shared eval argument parser: merge master, re-prove).

The drafter eval runs with a chosen writing style, a judge version rates the fit to the user's real style, and one command compares two runs case by case and writes the gate file. No real call in this stage.

## Step 1 — `--style` for the drafter eval

- **Goal:** drafter eval option `--style none|scenario|<style file path>` (default `scenario`: today's runs stay the same). `none` sets the writing style to null; a path loads the style file and uses its `text`. The style key goes into the state file name, the report name and the dump name, so two configs never share a file.
- **Decisions:** the key is `none`, `scenario` or the `promptVersion` of the style file; a style file with `checks.ok: false` is refused (exit 1). The report names the style key and, for a file, its path and `sampleCount`. The production gate file of the drafter (`drafter-…-lab-01-v1.json`) is written only with `--style scenario`.
- **Test (unit):**
  1. `--style none` → `DrafterInput.style.writingStyle` null for every case; the signature and display name unchanged.
  2. `--style <file>` with text "Krótko i rzeczowo." → that text.
  3. Two runs with `none` and with a file → two different state file names.
  4. A style file with `checks.ok: false` → exit 1.
  5. `--style none --part holdout --judge` writes no drafter gate file.

## Step 2 — judge-v4

- **Goal:** `judge-v4.ts` in `judgeVersions`: the `judge-v3` reply rubric, unchanged, plus the score `style_match` (0–2): "the draft fits the reference writing style of the manager (form of address, length, tone), as far as the draft rules allow: the greeting follows the mail, and the reply is short". The user prompt gets `referenceStyle` in its own marked block; `judgeReplyDraft` passes it from the scenario `executive.voice` (the injection set: its persona voice). The default judge stays `judge-v3`.
- **Decisions:** `style_match` does not count in "send as is" (the send-as-is rule stays the `judge-v3` rule), so the facts numbers of v3 and v4 stay comparable. The report shows the `style_match` mean and its [0, 1, 2] counts.
- **Test:**
  1. `buildUserPrompt` of judge-v4 with reference "Pisze krótko." holds it once inside its block; judge-v3 output for the same input is unchanged (snapshot of today's text).
  2. A judge answer with `style_match: 0` and every other score 2 → send as is true.
  3. A judge answer without `style_match` under judge-v4 → schema error (counted as a judge error).

## Step 3 — `eval:style-gate`

- **Goal:** `bun run eval:style-gate --a <state> --b <state> --style <style file> --injection <injection result file> --out <report.md>` (a `runCli` tool, risk class like `eval`). It pairs the cases by id, computes the numbers, writes the report, and writes the gate file `evals/results/gate/stylist-<promptVersion>-<model>-<effort>-lab-01-v1.json` only when both runs are full judged holdout runs (no `--limit`) with `judge-v4`, the same drafter prompt, model and effort, A with style key `none`, B with the style file.
- **Decisions (bars, D15, `questions.md` 8):** a pair counts when both runs have judge scores for the case; more than 5% of the cases missing from the pairs → fail `too_many_errors`. Gain: `wins` (B `style_match` > A), `losses`, `ties`; `n = wins + losses ≥ 20`; Wilson 95% lower bound of `wins / n` > 0.5 (reuse the Wilson function of `@ea/core` if one exists); mean B − mean A ≥ 0.1. No loss on facts in B: code checks 100%; invented commitments 0; planted leaks 0; send as is ≥ 0.8 and ≥ A − 0.02; mean `answers_every_question` ≥ A − 0.05; `needs_facts` share ≤ 0.3. The style file has `checks.ok: true`; the injection result is all passed. `passed` = every bar holds. The gate file holds `bars`, `numbers` (each number above, both runs), the drafter, judge and stylist versions and models, and the style file path.
- **Test (unit, fixed state lines):**
  1. 40 untied pairs, 30 wins, 10 losses, means 1.0 and 1.4 → Wilson lower 0.5981, pass.
  2. 20 untied pairs, 12 wins → 0.3866, fail on gain.
  3. 16 untied pairs, 16 wins → fail (`n` < 20).
  4. Gain passes, B has 1 invented commitment → fail.
  5. B send as is 0.90, A 0.93 → fail (more than 0.02 lower).
  6. 6% of the cases have a judge error in A → `too_many_errors`.
  7. A `--limit` run → report only, no gate file.
- **Check:** the touched test files, then the Proof.
- **Done when:** the tests pass; `docs/capabilities/measurement.md` names `--style`, judge-v4 and the gate; the Proof line is PASS.
- **Out of scope:** real runs and the verdict (08).
