# F097 stage 20 — Reconcile, freeze v1, audit list

Part of [`../plan.md`](../plan.md). Content stage. Review job before the land (the corpus becomes gate evidence). Owner step O1 after the land; the build does not wait (D36).

After this stage corpus `lab-01` v1 is frozen: every value category has ≥ 50 dev and ≥ 200 holdout cases with text, blind label and passing code checks, every hard-case tag has ≥ 80 % of its planned cases, the manifest holds the hashes, and the owner's audit list exists (P2, P3, D34–D36).

Precondition (coordinator): all stage 18 and 19 jobs, including the rewrite rounds, have landed, and `bun run sim reconcile lab-01 --part <p> --batches 001-<last>` prints no `round 1` line for any part. If round-1 lines remain, run stage 18 rewrite mode and stage 19 for those ranges first.

## Step 1 — Final checks

**Goal.** The corpus is complete and clean.

**Files.** None changed, unless a check finds a missing label or a bad text in a single case: then fix that one case (text: README § 3/§ 4 rules; label: never — a missing label goes back to a stage 19 job). List every change in the final message.

Commands: `bun run sim check lab-01` (all parts; exit 0), `bun run sim status lab-01` (counts), `bun run sim reconcile lab-01 --part <p> --batches 001-<last>` for each part (prints nothing) and `bun run sim stale lab-01 --part <p> --batches 001-<last>` for each part (prints nothing).

**Check.** The three commands above.

**Done when.** `check` prints `ok`; `status` shows dev ≥ 50 and holdout ≥ 200 per value category.

## Step 2 — Freeze v1 and the audit list

**Goal.** Version 1 with a manifest; the owner's 50 cases (D35, D36).

**Files.** `evals/sim/lab-01/manifest.json`, `evals/sim/lab-01/audit/v1-list.md`, `evals/sim/lab-01/audit/v1-verdicts.json`.

Commands: `bun run sim freeze lab-01 --version 1 --date <today UTC>`, then `bun run sim audit-list lab-01 --version 1`. Commit the three files.

**Decisions.** D34, D35, D36.

**Check.** `bun run sim status lab-01` (manifest version 1, audit pending).

**Done when.** The manifest parses; the list has 30 random + up to 20 contested cases; the verdict file has all `pending`.

## Proof

```
mkdir -p /tmp/f097-s20 && bun run sim check lab-01 > /tmp/f097-s20/check.log 2>&1 && bun run sim status lab-01 > /tmp/f097-s20/status.log 2>&1 && bun run test:unit:ci > /tmp/f097-s20/unit.log 2>&1 && echo PROOF_OK
```

## Review job focus

Counts against plan D13; 20 random **dev** cases read side by side with their slots (label clear? language and style knobs kept? no real names, addresses or URLs?); the manifest hashes recomputed by `sim freeze` on a scratch copy match.
