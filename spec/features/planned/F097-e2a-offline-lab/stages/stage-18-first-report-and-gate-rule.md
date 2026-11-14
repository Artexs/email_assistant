# F097 stage 18 — First holdout report and the model-upgrade gate rule

Part of [`../plan.md`](../plan.md). Real LLM calls: each run stays under its $1 cap (P8); expected total about $0.40. This stage reads `holdout/` through the runner only (the gate run).

After this stage the running classifier (prompt `classifier-v2`, the production model) has its first sim holdout report and gate file in `evals/results/`, a dev report with the draft judge exists, the "under 10 min" exit is measured, and a CI unit test plus the docs make the gate a rule for every later prompt or model change (P9, P10, D29, D31).

## Step 1 — The runs

**Goal.** Three reports from real calls.

**Files.** `evals/results/<YYYY-MM-DD>-sim-lab-01-holdout-<model>-classifier-v2.md`, `evals/results/<YYYY-MM-DD>-sim-lab-01-dev-<model>-classifier-v2-judge.md`, `evals/results/gate/classifier-classifier-v2-<model>.json`.

Runs (the classifier provider and model are the `.env` defaults of the main checkout, which the prepare script copied; the CLI prints the provider and model; record them):

1. `/usr/bin/time -f "%e s" bun run eval --sim lab-01 --part holdout --concurrency 8 --rpm 240 --out evals/results/<date>-sim-lab-01-holdout-<model>-classifier-v2.md > /tmp/f097-s18/holdout.log 2>&1` — must finish complete in < 600 s. If it stops on soft errors (429), resume with the same command and report both times; if the total exceeds 600 s, report it (plan N1) and continue.
2. `bun run eval --sim lab-01 --part dev --concurrency 8 --rpm 240 --judge --judge-provider gemini --judge-model gemini-3.5-flash-lite --out evals/results/<date>-sim-lab-01-dev-<model>-classifier-v2-judge.md > /tmp/f097-s18/dev-judge.log 2>&1` — Gemini free-tier RPM makes this slow (about 1 min per 12 judged drafts); resume on a stop.
3. A missing API key: the CLI prints the key name and exits 1 → stop, report owner step O2 with the key name. Never read `.env`.

Each run appends its spend to the ledger; write the spend lines of both reports into the final message.

**Decisions.** D22, D26, D27, D28, D31, P8, P9.

**Check.** `ls evals/results/gate/` holds the gate file; both reports exist; the holdout report has no case id (`grep -c '\b[bhw]-[a-z]\{3\}-[0-9]' <holdout report>` prints 0).

**Done when.** Both runs are complete; the times and costs are in the final message.

**Out of scope.** Changing any prompt, model or threshold because of the numbers (that is E3b; P3).

## Step 2 — Gate evidence test

**Goal.** CI fails when the classifier prompt version has no gate file (D29, P10).

**Files.** `apps/server/src/modules/triage/gate-evidence.test.ts` (new).

**Interfaces.**

```ts
// A prompt or model change of the classifier needs a sim holdout gate file (PD-025). CI has no LLM key, so it checks the evidence, not the numbers.
test("a sim holdout gate file exists for the current classifier prompt version", () => {
  const dir = resolve(import.meta.dir, "../../../../../evals/results/gate");
  const files = readdirSync(dir).filter((f) => f.startsWith(`classifier-${prompts.classifier.version}-`) && f.endsWith(".json"));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) gateFileSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8")));
});
```

**Decisions.** D29, P10.

**Test.** The test itself; also prove it fails without the file (move the file to `/tmp/f097-s18/` in a scratch run, see the failure, move it back; write the two outputs to `/tmp/f097-s18/gate-test.log`).

**Check.** `bun test apps/server/src/modules/triage/gate-evidence.test.ts`

**Done when.** It passes with the file and failed without it.

## Step 3 — The rule in the docs

**Goal.** Every later agent sees the gate (D29, P10).

**Files.** `docs/code-patterns.md` (§ Side effects line ~95 and line ~163), `.agents/limen/styleguide.md` (§ Prefer, the LLM line), `evals/README.md` (a "Gate" section), `apps/server/src/modules/triage/prompts/index.ts` (the comment above `prompts`), `apps/server/src/modules/triage/prompts/classifier-v2.ts` comment line 1 is **not** edited (the prompt file stays untouched; its comment is old but harmless — name it in the final message).

Text to use (adapt the sentence form to each file):

- "A prompt or model change of any role runs `bun run eval --sim lab-01 --part holdout` (and `--judge` for a drafter change) and commits the report and the gate file `evals/results/gate/<role>-<promptVersion>-<model>.json` before the merge. The sim gate needs ≥ 200 holdout cases per category and the Wilson 95 % lower bound of precision ≥ the bar (PD-024, PD-025, ADR 0028). Prompt tuning reads only `evals/sim/*/dev/`; never open `holdout/`."
- `evals/README.md` "Gate" section also states: the release checklist (E8) checks that the model in the VPS `.env` has a gate file; the CI test checks only the prompt version.

**Decisions.** D29, P3, P10.

**Check.** `bunx prettier --check docs/code-patterns.md .agents/limen/styleguide.md evals/README.md`

**Done when.** The four files carry the rule.

## Proof

```
mkdir -p /tmp/f097-s18 && bun run lint > /tmp/f097-s18/lint.log 2>&1 && bun run typecheck > /tmp/f097-s18/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f097-s18/unit.log 2>&1 && bun run test:int:ci > /tmp/f097-s18/int.log 2>&1 && echo PROOF_OK
```
