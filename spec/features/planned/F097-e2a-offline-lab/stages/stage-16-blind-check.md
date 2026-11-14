# F097 stage 16 — Blind check (repeat stage)

Part of [`../plan.md`](../plan.md). Content stage, **run as several jobs** with `--model claude-haiku-5-5 --thinking medium` (P2, D37). Each job labels the batches named in its spawn text, after the stage 15 job of that range has landed.

After all jobs every written case has a blind label from a model that never saw the slot.

## Ranges

The same ranges as stage 15; up to 3 jobs at once; a range may be labelled again after a rewrite (only the rewritten batches change).

## Step 1 — Label one range

**Goal.** One category per case from the blind view only (D33).

**Files.** `evals/sim/lab-01/<part>/labels/batch-NNN.json` for NNN in the range. Nothing else.

Rules (follow `evals/sim/README.md` § 5 exactly):

1. Read only `evals/sim/README.md` § 5 and `evals/sim/lab-01/<part>/blind/batch-NNN.json`. Never open `slots/`, `texts/`, `plan-spec.json`, `scenario.json` or another part's files, and never run `sim brief`.
2. For each case choose one of `urgent`, `needs_reply`, `delegation`, `info`, `notification`, `spam` with the README meanings. Write `labels/batch-NNN.json` (`checker: "claude-haiku-5-5"`; if the job header shows another model, write that model id).
3. `bun run sim check lab-01 --part <part> --batches NNN-NNN` (it validates the label file schema; it prints ids and codes only).
4. Commit the label file, message `F097 s16: <part> batch NNN labels`.

**Decisions.** P2, D33, D37.

**Check.** `bun run sim check lab-01 --part <part> --batches <from>-<to>`

**Done when.** Every non-dropped case of the range has a label and the check prints `ok`.

**Out of scope.** Comparing with the slot (the coordinator runs `sim reconcile`).

## Proof (each job)

```
mkdir -p /tmp/f097-s16 && bun run sim check lab-01 --part <part> --batches <from>-<to> > /tmp/f097-s16/check.log 2>&1 && echo PROOF_OK
```

Plan N2: if `claude-haiku-5-5` is not available on the route, the coordinator runs this stage with `claude-sonnet-5-5` in a fresh job (still blind) and the final message of the ticket says so.
