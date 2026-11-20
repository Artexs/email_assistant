# F164 stage 04 — Smoke mode of eval:style-gate

Needs: nothing (reads the existing `eval:style-gate` code and dev state files). May run next to 01, 02 and 03.
Part of [`../plan.md`](../plan.md). Decisions: D4, D5, D6.

## Step 1 — the smoke verdict (pure)

- **Goal:** the F122 futility and judge stops become code.
- **Files:** `modules/replies/style-gate.ts` (next to `compareStyleRuns`); its test.
- **Interface (stage 06 reads its output):**
  ```ts
  export type SmokeVerdict = "pass" | "fail" | "judge_stop";
  export interface StyleSmoke {
    pairs: number; wins: number; losses: number; ties: number;
    meanA: number; meanB: number;          // style_match over the paired cases, 2 decimals in the report
    judgeErrorShareA: number; judgeErrorShareB: number;
    verdict: SmokeVerdict;
  }
  export function styleSmoke(a: DrafterCaseResult[], b: DrafterCaseResult[]): StyleSmoke; // the results of the two state files
  ```
- **Rules (D5):** the case ids are the ids present in both state files (no holdout loader); a pair is such a case with a `style_match` score in both runs. The judge error share of a run is its judge errors over its result count. `judge_stop` when either share is above 0.05, or every `style_match` of both runs has the same value; else `pass` when `meanB > meanA` or `wins > losses`; else `fail`. A run with 0 pairs is `judge_stop`.
- **Test (`test.each`, 20 fake pairs each, exact `StyleSmoke`):**
  1. F122 shape: A 17×2, 3×1; B the same means; 1 win, 1 loss → means 1.85 / 1.85, `fail`.
  2. B one more 2 than A (1 win, 0 losses) → meanB 1.90, `pass`.
  3. Equal means, wins 3, losses 2 (one loss by 2 points) → `pass`.
  4. B lower mean, 0 wins, 2 losses → `fail`.
  5. 2 of 20 judge errors in A (0.10) → `judge_stop`.
  6. Every score 2 in both runs → `judge_stop`.
  7. Case 2's scores, with one tie case of A a judge error (share 0.05, not above) → 19 pairs, `pass`.
- **Check:** `bun test` on `style-gate.test.ts`; flip `>` to `>=` in the mean rule once and see case 1 fail.
- **Done when:** cases 1–7 pass; the existing `compareStyleRuns` tests pass unchanged.

## Step 2 — `eval:style-gate --smoke`

- **Files:** `scripts/eval-style-gate-args.ts`, `scripts/lib/eval-style-gate.ts`, their tests, `docs/cli.md` (the command row), `evals/README.md`.
- **Interface:** `bun run eval:style-gate --smoke --a <A state> --b <B state> --style <style file> --out <report.md>`.
  - `--smoke` accepts only state files of part `dev` or `week`, and refuses `holdout` (exit 2, line "a holdout pair goes through the full gate"). `--injection` is not used in smoke mode.
  - The other pair rules of `runPairRefusal` stay: both judged with `judge-v4`, A style key `none`, B style key of the style file, same drafter prompt, model, effort, endpoint, judge model and corpus. A `--limit` run is allowed.
  - It never writes a gate file. The report: both state file names, the drafter prompt, the style file, the `StyleSmoke` numbers, the verdict `pass (smoke)`, `fail (smoke)` or `judge stop`, and each paired id with its two scores (never text).
  - Exit 0 for `pass`, 1 for `fail` and `judge_stop`, 2 for a refused pair or a bad flag.
  - No model call.
- **Test:**
  1. `--smoke` with two dev state fixtures (case 2 shape) → exit 0, report holds `pass (smoke)`, no file under `evals/results/gate/`.
  2. `--smoke` with a holdout state → exit 2, the line above.
  3. `--smoke` where B has another drafter prompt → exit 2, "the runs differ in the drafter prompt".
  4. Without `--smoke`, a dev pair → refused as before ("a run is not a holdout run"): the full gate does not change.
  5. Smoke mode with a holdout loader dependency that throws when called → the run of test 1 still exits 0 (the loader is never called).
- **Not verified, check first:** that a dev state file holds the per-case `style_match`. If not, stop and report.
- **Check:** `bun test` on the args and lib test files.
- **Done when:** cases 1–5 pass.
- **Out of scope:** the full gate, the stylist, the judge, a real run.

## Done when (stage)

Both steps done; `docs/cli.md` and `evals/README.md` name `--smoke` and its verdicts. Proof: the last line of `bun run check:job`.
