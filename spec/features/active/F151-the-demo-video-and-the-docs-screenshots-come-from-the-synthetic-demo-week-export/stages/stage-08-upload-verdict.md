# F151 stage 08 — Upload verdict and model check (pure, no export)

Needs stage 04 (landed): `record.ts` (`main`, `closeReplay`, `recordSteps`), `DemoPrepared` in `prepare.ts`. No export. May run next to 05.

Part of [`../plan.md`](../plan.md): D10, D12, D14. Split from stage 06 (review 2, B1 and F8); it builds before 06.

## Goal

Every `demo:record` run ends with one verdict line, and that line can never say "upload candidate" for a run that failed.

## Interfaces (stage 06 and 07 use these)

- `DemoPrepared` gets `seedDay: number` and `exportedAt: string`, both from the parsed seed (`day`, `exportedAt`), never from the file name.
- `uploadVerdict(input: { source: "e2e" | "demo"; exitCode: number; seedDay: number | null; gateProvisional: boolean; misses: number; notLive: string[]; llmChecked: boolean }): string` (pure, `apps/web/e2e/lib/demo/verdict.ts`):  `demo_source demo: upload candidate` only for exit 0, source `demo`, `seedDay ≥ 5`, final gate, 0 misses, `llmChecked`, no not-live step. Else `not for upload: <first reason>`, in this order: `run_failed`, `e2e_source`, `trial_seed`, `gate_provisional`, `replay_miss`, `llm_unchecked`, `not_live`. A null `seedDay` on the demo source is `trial_seed`.
- `modelCheck(input: { lines: string[]; hits: number; expectedHits: number }): string | null` (pure, same file). Null only when at least one server `llm_settings` line exists, every one has `endpoint` `own` and host `127.0.0.1`, and `hits ≥ expectedHits`. Else `demo_llm_unchecked`. Line format: `apps/server/src/start/triage.ts`.

## Step 1 — the output order of `record.ts` (D14)

1. After `prepareDemoRun`: `demo_seed_day <n> exported_at <iso>`.
2. `recordSteps` as today (hashes, `not_live`, `files`, video limits), but without the line `demo_source e2e: not for upload`: the verdict `not for upload: e2e_source` replaces it.
3. Demo source: `closeReplay` as today (`demo_replay …`, `demo_gate …`, miss and unused exits).
4. Demo source: capture the Playwright run output (keep it streamed to the console too) and run `modelCheck` with `expectedHits` = `plan.history.length + 7` (4 shadow mails, 3 after the tap). Print `demo_llm_checked hits=<n>`, or exit 1 with `demo_llm_unchecked`.
5. Last: the verdict from the final exit code and the values above, on every exit path (early refusals such as `seed_missing`, and the `demo_record_error` catch). A value the run did not reach counts as not perfect.

The verdict is the last `[demo-record]` line of the combined log (`> log 2>&1`); if stderr and stdout interleave, make it the last write of the script. A run that exits 0 ends its log with it. After a failed run, `bun run` adds `error: script "demo:record" exited with code 1`, so read it with `grep -a '\[demo-record\]' <log> | tail -n1`. It never changes the exit code. A `--setup-only` run (stage 05) makes no video and prints no verdict.

Until stage 06 lands, a demo-source run ends `not for upload: run_failed` (correct).

## Docs

- `live-lab.md` rule 24.10: the verdict line, its reasons, the order of the last lines.
- `docs/release-checklist.md`: replace "no line `demo_source e2e: not for upload`" with "upload only a run that exited 0 and whose last `[demo-record]` line is `demo_source demo: upload candidate`". Stage 07 does the rest.

## Test (`apps/web/e2e/lib/demo/verdict.test.ts`)

1. `uploadVerdict`, `test.each`; base P = demo, exit 0, day 5, final, 0 misses, `[]`, checked (`…` = `not for upload: `):
   - P → `demo_source demo: upload candidate`
   - P, day 7 → candidate
   - P, exit 1 → `…run_failed` (perfect inputs, failed run)
   - P, day 4 → `…trial_seed`
   - P, day 1, provisional → `…trial_seed`
   - P, provisional → `…gate_provisional`
   - P, misses 2 → `…replay_miss`
   - P, not checked → `…llm_unchecked`
   - P, `["shadow"]` → `…not_live`
   - e2e, exit 0, day null, `["shadow","report","urgent"]` → `…e2e_source`
   - e2e, exit 1 → `…run_failed`
2. `modelCheck`, `test.each`, expected 27:
   - two own lines on `127.0.0.1`, hits 27 → null
   - the same, hits 26 → `demo_llm_unchecked`
   - one line with another host → `demo_llm_unchecked`
   - no `llm_settings` line → `demo_llm_unchecked`

Break check: drop the `exitCode` rule; the "P, exit 1" row fails.

## Proof

```
mkdir -p /tmp/f151-s08
bun run demo:record --seed /tmp/f151-s08/none.json > /tmp/f151-s08/refused.log 2>&1; grep -a '\[demo-record\]' /tmp/f151-s08/refused.log | tail -n1
flock /tmp/email-assistant-shared-tests.lock bun run demo:record > /tmp/f151-s08/e2e.log 2>&1; grep -a '\[demo-record\]' /tmp/f151-s08/e2e.log | tail -n1
```

The first command prints `[demo-record] not for upload: run_failed` (after `seed_missing`). The second prints `[demo-record] not for upload: e2e_source`. Then `bun run check:job`. Quote both last lines.

## Done when

- Tests 1 and 2 pass.
- Both Proof logs have the verdict lines above as their last `[demo-record]` line (`e2e.log` also ends with it), and `e2e.log` has no line `demo_source e2e: not for upload`.

