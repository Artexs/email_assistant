# F097 stage 19 — Blind check (repeat stage)

Part of [`../plan.md`](../plan.md). Content stage, **run as several jobs** with `--model claude-haiku-5-5 --thinking medium` (P2, D37). Each job labels the batches named in its spawn text, after the stage 18 job of that range has landed.

After all jobs every written case has a blind label from a model that never saw the slot.

## Ranges

The same ranges as stage 18; up to 3 jobs at once. After a rewrite (stage 18 rewrite mode) the same range runs again; `sim stale` then lists only the rewritten cases, so unchanged labels stay.

## Step 1 — Label one range

**Goal.** One category per case from the blind view only (D33).

**Files.** `evals/sim/lab-01/<part>/labels/batch-NNN.json` for NNN in the range. Nothing else.

Rules (follow `evals/sim/README.md` § 5 exactly):

1. Read only `evals/sim/README.md` § 5 and `evals/sim/lab-01/<part>/blind/batch-NNN.json`. Never open `slots/`, `texts/`, `labels/`, `plan-spec.json`, `scenario.json` or another part's files, and never run `sim brief`, `sim reconcile` or `sim status`. The coordinator greps this job's tool log for those paths and commands before the land and discards the job if it finds one (plan D33).
2. `bun run sim stale lab-01 --part <part> --batches NNN-NNN` lists the ids to label (first pass: every case; after a rewrite: only the rewritten cases). Label only those.
3. For each listed case choose one of `urgent`, `needs_reply`, `delegation`, `info`, `notification`, `spam` with the README meanings. Write `/tmp/f097-s19/labels-NNN.json` as `[{ "id": …, "category": … }]`.
4. `bun run sim label-import lab-01 --part <part> --batch NNN --checker <your model id, from the job header> --file /tmp/f097-s19/labels-NNN.json`.
5. `bun run sim check lab-01 --part <part> --batches NNN-NNN` (it prints ids and codes only; `label_stale` must be gone for the batch).
6. Commit `labels/batch-NNN.json`, message `F097 s19: <part> batch NNN labels`.

**Decisions.** P2, D33, D37.

**Check.** `bun run sim check lab-01 --part <part> --batches <from>-<to>`

**Done when.** `sim stale` prints nothing for the range and the check prints `ok`.

**Out of scope.** Comparing with the slot (the coordinator runs `sim reconcile`).

## Proof (each job)

```
mkdir -p /tmp/f097-s19 && bun run sim check lab-01 --part <part> --batches <from>-<to> > /tmp/f097-s19/check.log 2>&1 && echo PROOF_OK
```

Plan N2: if `claude-haiku-5-5` is not available on the route, the coordinator runs this stage with `claude-sonnet-5-5` in a fresh job (still blind) and the final message of the ticket says so.

## Coordinator check before the land

The job's session log holds every tool call with its full arguments. Before the land run, from the main checkout:

```
grep -hcE '"(path|command)":"[^"]*((slots|texts)/batch|plan-spec\.json|scenario\.json|sim (brief|reconcile|status))' .limen/jobs/<job id>/session/*.jsonl
```

It must print `0`. Anything else → do not land; read the matching lines; a real read of truth files → spawn the range again in a fresh job (plan D33).
