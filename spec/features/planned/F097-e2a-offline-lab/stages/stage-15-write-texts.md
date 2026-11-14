# F097 stage 15 — Write the texts (repeat stage)

Part of [`../plan.md`](../plan.md). Content stage, **run as several jobs**: each job writes the batches named in its spawn text. Model: Claude Sonnet 5.5 (P2, D37). This stage reads `holdout/` on purpose (the writer writes the holdout).

After all jobs of this stage every slot of `lab-01` has a text that passes the code checks, and every batch has its blind view for the checker.

## Ranges (the coordinator fills the real batch counts from stage 14)

- Bank, up to 3 jobs at once: `dev 001–008`, `dev 009–016`, `holdout 001–008`, `holdout 009–016`, … `holdout 057–057`.
- Week, one job at a time, in order: `week 001–008`, `week 009–016`, … (threads span batches; a reply needs its parent's text).
- Rewrite mode: after stage 16 labelled a range, a job with the spawn text "rewrite <part> <from>–<to>" fixes the disagreements of that range (README § 4).

## Step 1 — Write one range

**Goal.** Texts for the range that keep every slot fact (P2, D11, D14, D17).

**Files.** `evals/sim/lab-01/<part>/texts/batch-NNN.json` and `evals/sim/lab-01/<part>/blind/batch-NNN.json` for NNN in the range. Nothing else.

Procedure per batch (follow `evals/sim/README.md` § 3 exactly):

1. `bun run sim brief lab-01 --part <part> --batch NNN > /tmp/f097-s15/brief-NNN.json`; read it.
2. Write `texts/batch-NNN.json` (`writer: "claude-sonnet-5-5"`).
3. `bun run sim check lab-01 --part <part> --batches NNN-NNN` until it prints `ok`.
4. `bun run sim blind-export lab-01 --part <part> --batches NNN-NNN`.
5. Commit the two files of the batch (`git add <paths>`), message `F097 s15: <part> batch NNN texts`.

For week batches: read the texts of the parent slots (`parentId`) from earlier batches before you write a reply.

**Decisions.** P2, D11, D14, D17, D18, D33.

**Test.** The code checks of step 3.

**Check.** `bun run sim check lab-01 --part <part> --batches <from>-<to>`

**Done when.** The check prints `ok` for the whole range.

**Out of scope.** Labels (stage 16). Changing a slot file (never: the slot is the truth; a slot that cannot be written well is a question in the final message).

## Step 2 — Rewrite mode

**Goal.** Close disagreements once (D34).

**Files.** `texts/batch-NNN.json` and `blind/batch-NNN.json` of the range.

Procedure: `bun run sim reconcile lab-01 --part <part> --batches <from>-<to>`; for each `round 1` line: rewrite the text so its slot label is clear and set `note: "rewritten: <reason>"`, or keep it with `note: "borderline: <reason>"` when the mail is truly ambiguous; for each `round 2` line: bank → `dropped: true`; week → `borderline:` (week cases are never dropped, D34). Then `sim check` and `sim blind-export` for the changed batches; commit.

**Check.** `bun run sim check lab-01 --part <part> --batches <from>-<to>`

**Done when.** `reconcile` prints no `round 1` line for the range.

## Proof (each job)

```
mkdir -p /tmp/f097-s15 && bun run sim check lab-01 --part <part> --batches <from>-<to> > /tmp/f097-s15/check.log 2>&1 && bun run test:unit:ci > /tmp/f097-s15/unit.log 2>&1 && echo PROOF_OK
```
