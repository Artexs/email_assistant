# F116 stage 04 — Blind labels and freeze

Part of [`../plan.md`](../plan.md). Content stage, **run as several jobs**: step 1 with `--model claude-haiku-5-5 --thinking medium` per range, after the stage 03 job of that range landed; step 2 once, as the last job, with `claude-sonnet-5-5`.

## Step 1 — Label one range (repeat)

- **Goal:** the checker labels each case from the blind view only.
- **Files:** `evals/sim/lab-01/<part>/labels/batch-NNN.json` for the range. Nothing else.
- **Rules** (the README "Sent bank" section of stage 02):
  1. Read only that README section and `evals/sim/lab-01/<part>/blind/batch-NNN.json`. Never open `slots/`, `texts/`, `labels/`, the plan specs or the scenario, and never run `sim brief`, `sim reconcile` or `sim status`. The coordinator greps the job's tool log for those paths and commands before the land and discards the job if one is there (the F097 blind rule).
  2. `bun run sim stale lab-01 --part <part> --batches NNN-NNN` lists the ids to label.
  3. Per case: `expectsReply` (does the sender expect an answer from a recipient?), `promise` (does the sender make a firm promise of their own, with a date or a time word?), `due` and `promiseDue` (the date as YYYY-MM-DD, resolved from the mail's sent date; null when none or when it is a conditional promise). Write `/tmp/f116-s04/labels-NNN.json`.
  4. `bun run sim label-import lab-01 --part <part> --batch NNN --checker <model id> --file /tmp/f116-s04/labels-NNN.json`.
  5. `bun run sim check lab-01 --part <part> --batches NNN-NNN`; commit `labels/batch-NNN.json` (`F116 s04: <part> batch NNN labels`).
- **Done when:** `sim stale` prints nothing for the range and the check prints `ok`.

## Step 2 — Reconcile and freeze (once)

- **Goal:** `sent-v1` is frozen.
- **Procedure:** `bun run sim reconcile lab-01 --part sent-dev` and `--part sent-holdout` list disagreements (ids and fields). For each, the coordinator runs a stage 03 rewrite job of that range and a step 1 job again. When the floors of stage 02 hold, run `bun run sim freeze lab-01 --bank sent` and commit `sent-manifest.json`.
- **Decisions:**
  - At most two rewrite rounds. A case that still disagrees after two is dropped from the bank by a recorded slot removal (`sim freeze` writes it to the manifest as `dropped`), never by a label change.
  - A due disagreement of one day caused by the time zone is a slot bug: fix the slot's `sentAt` time, not the label, and rewrite the text.
- **Check:** `bun run sim status lab-01 --part sent-holdout` shows `frozen sent-v1`.
- **Done when:** the manifest is committed; the final message gives the case counts per part, the dropped ids and the disagreement count per round.

## Done when (stage)

Steps 1 and 2 hold. Step 2 also runs the Proof of `plan.md` (`/tmp/f116-s04`) and it prints `PROOF_OK`.

## Out of scope

The extractor and its run (05, 06). Any change of a frozen incoming part.
