# F097 stage 19 — Sim-vs-real gap report

Part of [`../plan.md`](../plan.md). The last stage: its land closes the ticket.

After this stage `evals/results/` holds the first sim-vs-real comparison for `notification` and `spam` (P7, D32), and the capability page (if E1 created it) names the lab.

Precondition (coordinator step C4): `/tmp/f097-real/real.json` exists on this machine (counts from the pilot's real labels, made on the VPS by `bun run eval --real … --json`). It holds no text and no ids. If the file is missing, stop and say so.

## Step 1 — The gap report

**Goal.** One report from the stage 18 gate file and the real counts (D32).

**Files.** `evals/results/<YYYY-MM-DD>-sim-vs-real-gap-lab-01.md` (new).

Command: `bun run eval --gap --sim-json evals/results/gate/classifier-classifier-v2-<model>.json --real-json /tmp/f097-real/real.json --out evals/results/<date>-sim-vs-real-gap-lab-01.md`.

Do not copy `real.json` into the repo (real-label counts of the pilot stay out of git beyond this report's aggregate lines; the report holds only the numbers `renderGap` prints).

**Decisions.** D32, P7.

**Check.** The report exists and names `notification` and `spam` with a verdict each.

**Done when.** The report is committed.

## Step 2 — Docs pointers

**Goal.** The next reader finds the lab.

**Files.** `docs/capabilities/triage.md` (or the capability page E1 made for triage; if `docs/capabilities/` does not exist, skip and say so), `evals/README.md` ("Results" list).

Add 3–6 lines: what the lab is (`evals/sim/README.md`), how to run the gate, where the gate files and reports live, the `/review` command and its flag `review_command`, and that real labels never unlock `auto` (ADR 0028).

**Check.** `bunx prettier --check <changed files>`

**Done when.** The lines are in.

## Proof

```
mkdir -p /tmp/f097-s19 && bunx prettier --check evals/README.md > /tmp/f097-s19/prettier.log 2>&1 && bun run test:unit:ci > /tmp/f097-s19/unit.log 2>&1 && echo PROOF_OK
```
