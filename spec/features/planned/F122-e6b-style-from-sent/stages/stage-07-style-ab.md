# F122 stage 07 — Drafter eval style and judge-v4

Part of [`../plan.md`](../plan.md). Needs: the style file format of `interfaces.md` § Eval (no code of stage 06). May run next to 06 (shared eval argument parser: merge master, re-prove).

A chosen writing style for the drafter eval and a judge that rates the fit to the real style. No real call.

## Step 0 — Split the drafter eval script

- **Goal:** `apps/server/src/scripts/lib/eval-drafter.ts` (458 lines) becomes files under about 400 lines before this stage adds to it, with the split method of `docs/code-patterns.md` § Size and shape (history merge; never rebase the branch). Stage 06 does not touch this file (it adds its own file), so only this stage splits it.
- **Test:** the existing drafter eval tests pass unchanged.


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

- **Check / Done when:** the touched tests pass; `docs/capabilities/measurement.md` names `--style` and judge-v4; the Proof line is PASS.
- **Out of scope:** the gate command (08); real runs (09).
