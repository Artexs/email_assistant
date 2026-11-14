# F097 stage 22 — Sim-vs-real gap report

Part of [`../plan.md`](../plan.md). The last stage: its land closes the ticket.

After this stage `evals/results/` holds the first sim-vs-real comparison for `notification` and `spam` (P7, D32), and the triage capability page names the lab.

Precondition (coordinator step C4): `/tmp/f097-real/real.json` exists on this machine (counts from the pilot's real labels, made on the VPS by `bun run eval --real … --json`). It holds no text and no ids. If the file is missing, stop and say so.

## Step 1 — The gap report

**Goal.** One report from the stage 21 gate file and the real counts (D32).

**Files.** `evals/results/<YYYY-MM-DD>-sim-vs-real-gap-lab-01.md` (new).

Command: `bun run eval --gap --sim-json evals/results/gate/<the stage 21 gate file>.json --real-json /tmp/f097-real/real.json --out evals/results/<date>-sim-vs-real-gap-lab-01.md`.

Do not copy `real.json` into the repo (real-label counts of the pilot stay out of git beyond this report's aggregate lines; the report holds only the numbers `renderGap` prints).

**Decisions.** D32, P7.

**Check.** The report exists and names `notification` and `spam` with a verdict each.

**Done when.** The report is committed.

## Step 2 — Docs pointers

**Goal.** The next reader finds the lab.

**Files.** `docs/capabilities/triage.md` (it exists since F095; stages 01, 03, 04, 11, 13, 15, 16 and 21 already added their lines), `evals/README.md` ("Results" list).

Add 2–4 lines: where the first holdout report and the gap report live (`evals/results/`), the gap verdict for `notification` and `spam` in one sentence, and that real labels never unlock `auto` (ADR 0028). Fix any line of the earlier stages that the reports prove wrong. Keep the "Checked against" line.

**Check.** `bunx prettier --check <changed files> && bun test apps/server/src/capability-map.test.ts`

**Done when.** The lines are in.

## Proof

```
mkdir -p /tmp/f097-s22 && bunx prettier --check evals/README.md docs/capabilities/triage.md > /tmp/f097-s22/prettier.log 2>&1 && bun run test:unit:ci > /tmp/f097-s22/unit.log 2>&1 && echo PROOF_OK
```
