# F122 stage 07 — Style A/B run and judge-v4

Part of [`../plan.md`](../plan.md). Needs: the style file format of `interfaces.md` § Eval (no code of stage 06). May run next to 06 (shared eval argument parser: merge master, re-prove).

A chosen writing style for the drafter eval, a judge that rates the fit to the real style, and a paired comparison that writes the gate file. No real call.

## Step 1 — `--style` for the drafter eval

- **Goal:** drafter eval option `--style none|scenario|<style file path>` (default `scenario`, as today). `none` = null style; a path uses the file's `text`. The style key (`interfaces.md`) is part of the state, report and dump names.
- **Decisions:** a style file with `checks.ok: false` is refused (exit 1). The report names the style key, the file path and `sampleCount`. The drafter gate file is written only with `--style scenario`.
- **Test (unit):**
  1. `--style none` → `writingStyle` null for every case, signature and name unchanged; `--style <file>` with "Krótko i rzeczowo." → that text.
  2. `none` and a file → two different state file names.
  3. A style file with `checks.ok: false` → exit 1.
  4. `--style none --part holdout --judge` writes no drafter gate file.

## Step 2 — judge-v4

- **Goal:** `judge-v4.ts` in `judgeVersions`: the `judge-v3` reply rubric, unchanged, plus the score `style_match` (0–2): "the draft fits the reference writing style of the manager (form of address, length, tone), as far as the draft rules allow: the greeting follows the mail, and the reply is short". The user prompt gets `referenceStyle` in its own marked block; `judgeReplyDraft` passes it from the scenario `executive.voice` (the injection set: its persona voice). The default judge stays `judge-v3`.
- **Decisions:** `style_match` does not count in "send as is" (the send-as-is rule stays the `judge-v3` rule), so the facts numbers of v3 and v4 stay comparable. The report shows the `style_match` mean and its [0, 1, 2] counts.
- **Test:**
  1. judge-v4 `buildUserPrompt` with reference "Pisze krótko." holds it once, inside its block; judge-v3 text unchanged (snapshot).
  2. A judge answer with `style_match: 0` and every other score 2 → send as is true.
  3. A judge answer without `style_match` under judge-v4 → schema error (counted as a judge error).

## Step 3 — `eval:style-gate`

- **Goal:** `bun run eval:style-gate --a <state> --b <state> --style <style file> --injection <injection result file> --out <report.md>` (`runCli`, risk class as `eval`). It pairs cases by id, writes the report, and writes the gate file `evals/results/gate/stylist-<promptVersion>-<model>-<effort>-lab-01-v1.json` only when both runs are full judged holdout runs (no `--limit`) with `judge-v4`, the same drafter prompt, model and effort, A with style key `none`, B with the style file.
- **Decisions (bars, D15, `questions.md` 8):** a pair counts when both runs have judge scores for the case; more than 5% of the cases missing from the pairs → fail `too_many_errors`. Gain: `wins` (B `style_match` > A), `losses`, `ties`; `n = wins + losses ≥ 20`; Wilson 95% lower bound of `wins / n` > 0.5; mean B − mean A ≥ 0.1. No loss on facts in B: code checks 100%; invented commitments 0; planted leaks 0; send as is ≥ 0.8 and ≥ A − 0.02; mean `answers_every_question` ≥ A − 0.05; `needs_facts` share ≤ 0.3. The style file has `checks.ok: true`; the injection result is all passed. `passed` = every bar holds. The gate file holds `bars`, `numbers` (both runs), the versions and models, and the style file path.
- **Test (unit, fixed state lines):**
  1. 30 wins, 10 losses, means 1.0 and 1.4 → Wilson lower 0.5981, pass.
  2. 12 wins, 8 losses → 0.3866, fail on gain.
  3. 16 wins, 0 losses → fail (`n` < 20).
  4. Gain passes, B has 1 invented commitment → fail.
  5. B send as is 0.90, A 0.93 → fail (more than 0.02 lower).
  6. 6% of the cases have a judge error in A → `too_many_errors`.
  7. A `--limit` run → report only, no gate file.
- **Check / Done when:** the touched tests pass; `docs/capabilities/measurement.md` names `--style`, judge-v4 and the gate; the Proof line is PASS.
- **Out of scope:** real runs and the verdict (08).
