# F164 stage 03 — Smoke mode of eval:style-gate

Needs: nothing (reads the existing `eval:style-gate` code and dev state files). May run next to 01 and 02.
Part of [`../plan.md`](../plan.md). Decisions: D4, D5, D6.

## Step 1 — the smoke verdict (pure)

- **Goal:** the futility and judge stops of the F122 gate run become code, so the A/B smoke number is computed, not paired by hand.
- **Files:** `apps/server/src/modules/replies/style-gate.ts` (next to `compareStyleRuns`, reusing its pairing); its test.
- **Interface (stage 04 reads its output):**
  ```ts
  export type SmokeVerdict = "pass" | "fail" | "judge_stop";
  export interface StyleSmoke {
    pairs: number; wins: number; losses: number; ties: number;
    meanA: number; meanB: number;          // style_match over the paired cases, 2 decimals in the report
    judgeErrorShareA: number; judgeErrorShareB: number;
    verdict: SmokeVerdict;
  }
  export function styleSmoke(input: StyleGateInput): StyleSmoke;
  ```
- **Rules (D5):** a pair is a case with a `style_match` score in both runs (as `compareStyleRuns`). `judge_stop` when the judge error share of either run is above 0.05, or every `style_match` of both runs has the same value; else `pass` when `meanB > meanA` or `wins > losses`; else `fail`. A run with 0 pairs is `judge_stop`.
- **Test (`test.each`, 20 fake pairs each, exact `StyleSmoke`):**
  1. F122 shape: A 17×2, 3×1; B the same means; 1 win, 1 loss → means 1.85 / 1.85, `fail`.
  2. B one more 2 than A (1 win, 0 losses) → meanB 1.90, `pass`.
  3. Equal means, wins 3, losses 2 (one loss by 2 points) → `pass`.
  4. B lower mean, 0 wins, 2 losses → `fail`.
  5. 2 of 20 judge errors in A (0.10) → `judge_stop`.
  6. Every score 2 in both runs → `judge_stop`.
  7. Case 2's scores, with one tie case of A a judge error (share 0.05, not above) → 19 pairs, `pass`.
- **Check:** `bun test apps/server/src/modules/replies/style-gate.test.ts`; flip `>` to `>=` in the mean rule once and see case 1 fail.
- **Done when:** cases 1–7 pass; the existing `compareStyleRuns` tests pass unchanged.

## Step 2 — `eval:style-gate --smoke`

- **Goal:** one command gives the smoke verdict and a committed report.
- **Files:** `scripts/eval-style-gate-args.ts`, `scripts/lib/eval-style-gate.ts`, their tests, `docs/cli.md` (the command row), `evals/README.md`.
- **Interface:** `bun run eval:style-gate --smoke --a <A state> --b <B state> --style <style file> --out <report.md>`.
  - `--smoke` accepts only state files of part `dev` or `week`, and refuses `holdout` (exit 2, line "a holdout pair goes through the full gate"). `--injection` is not used in smoke mode.
  - The other pair rules of `runPairRefusal` stay: both judged with `judge-v4`, A style key `none`, B style key of the style file, same drafter prompt, model, effort, endpoint, judge model and corpus. A `--limit` run is allowed.
  - It never writes a gate file. The report holds: the two state file names, the drafter prompt, the style file path, the `StyleSmoke` numbers, the verdict line `pass (smoke)`, `fail (smoke)` or `judge stop`, and the paired ids with their two scores (ids and numbers only, never draft text).
  - Exit 0 for `pass`, 1 for `fail` and `judge_stop`, 2 for a refused pair or a bad flag.
  - No model call.
- **Test:**
  1. `--smoke` with two dev state fixtures (case 2 shape) → exit 0, report holds `pass (smoke)`, no file under `evals/results/gate/`.
  2. `--smoke` with a holdout state → exit 2, the line above.
  3. `--smoke` where B has another drafter prompt → exit 2, "the runs differ in the drafter prompt".
  4. Without `--smoke`, a dev pair → refused as before ("a run is not a holdout run"): the full gate does not change.
- **Not verified, check first:** that a dev state file holds the per-case `style_match` that `compareStyleRuns` reads. If it does not, stop and report (do not change the state file shape here).
- **Check:** `bun test` on the args and lib test files.
- **Done when:** cases 1–4 pass.
- **Out of scope:** the full gate's bars, the stylist, the judge, a real run.

## Done when (stage)

Both steps done; `docs/cli.md` and `evals/README.md` name `--smoke` and its verdicts. Proof: the last line of `bun run check:job`.
