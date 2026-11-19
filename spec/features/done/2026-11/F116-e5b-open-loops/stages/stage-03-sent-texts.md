# F116 stage 03 — Write the sent texts (repeat stage)

Part of [`../plan.md`](../plan.md). Content stage, **run as several jobs**: each job writes the batches in its spawn text. Model: `claude-sonnet-5-5`. This stage reads `sent-holdout/` on purpose (the writer writes it). Needs stage 02.

## Step 0 — Plan the slots (first job only)

Run `bun run sim plan lab-01 --bank sent`, commit the slot files by explicit path (`F116 s03: sent slots`). Later jobs skip this step.

## Ranges (the coordinator sets them after step 0)

- Up to 3 jobs at once: `sent-dev 001–002`, `sent-holdout 001–004`, `sent-holdout 005–008`, `sent-holdout 009–010`.
- Rewrite mode: after stage 04 labelled a range, "rewrite <part> <from>–<to>" fixes only the disagreements of that range.

## Step 1 — Write one range

- **Goal:** one text per slot that keeps every slot fact.
- **Files:** `evals/sim/lab-01/<part>/texts/batch-NNN.json`, `.../blind/batch-NNN.json`. Nothing else.
- **Procedure per batch:**
  1. `bun run sim brief lab-01 --part <part> --batch NNN > /tmp/f116-s03/brief-NNN.json`; read it.
  2. Write the text file (`writer: "claude-sonnet-5-5"`): the executive writes to the recipients; the mail must deserve its labels (an ask that expects a reply, a firm dated promise, or neither); never write a label word.
  3. `bun run sim check lab-01 --part <part> --batches NNN-NNN` until `ok`.
  4. `bun run sim blind-export lab-01 --part <part> --batches NNN-NNN`.
  5. Commit the two files of the batch, message `F116 s03: <part> batch NNN texts`.
- **Decisions:**
  - Hard cases follow their tag (stage 01 step 2). `question_in_forward`: the ask sits in the executive's lines above a forwarded mail. `injection_quote`: the quoted third-party part holds the planted strings; the executive's own lines are harmless.
  - Time words: write the word the slot names ("do piątku", "by end of week"), not the date.
  - Polish texts use Polish diacritics and Polish greeting forms of the persona's voice.
  - Made-up names and reserved domains only (`evals/README.md` § Data rule).
- **Check:** `bun run sim check lab-01 --part <part> --batches <from>-<to>`
- **Done when:** the check prints `ok` for the whole range.
- **Out of scope:** labels (04); a slot change (never: a slot that cannot be written well is a question in the final message).

## Done when (stage)

All batches of the range pass the check and are committed. The final message lists the range and the check output. This content stage has no full Proof run: the coordinator runs `bun run sim status lab-01 --part sent-holdout` after the last job.
