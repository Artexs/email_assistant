# F116 stage 02 — Sent bank commands

Part of [`../plan.md`](../plan.md). Needs stage 01. No DB change.

The writer and checker jobs of stages 03–04 work only through the `sim` commands (`evals/sim/README.md`). This stage makes those commands handle the sent parts of stage 01.

## Step 1 — Plan, brief, check

- **Goal:** `bun run sim plan lab-01 --bank sent` writes `evals/sim/lab-01/<part>/slots/batch-NNN.json` for `sent-dev` and `sent-holdout` from `sent-plan-spec.json`. `sim brief lab-01 --part sent-dev --batch NNN` prints the scenario, the executive persona (voice, signature), the recipient personas and the slots. `sim check lab-01 --part sent-holdout --batches 001-010` checks the text files.
- **Decisions:**
  - `--bank sent` is valid only with `plan`; `--part sent-*` selects the sent shapes in every other command. Other values keep today's behaviour (the incoming parts and the frozen `lab-01` v1 stay byte-equal).
  - Checks per text (codes, no text in the output): `missing_text`, `lang` (the `lang.ts` check), `length` (the bucket), `signature` (the executive's line when `style.signature`), `thread_count` (one quoted block per `thread` item when `quoted`), `planted_missing` (injection), `label_word` (the body holds none of `expects_reply`, `promise`, `due`), `own_only` (no recipient is the executive).
  - A plan run on a part that has texts refuses (exit 1) unless `--force`; the slot is the truth.
- **Test (unit, temp folder):** T1 plan twice → the same files; T2 a text without the signature → `signature` issue; T3 an injection case without its planted string → `planted_missing`; T4 `sim check lab-01 --part dev` on the real corpus still prints `ok`.

## Step 2 — Blind export, label import, freeze

- **Goal:** `sim blind-export`, `sim label-import`, `sim status`, `sim reconcile` and `sim freeze` work on the sent parts.
- **Decisions:**
  - The blind file holds `sentBlindCaseSchema` entries only (no slot field, no label).
  - `label-import` stores the checker's `sentLabelSchema` per case with the blind hash; a changed text makes the label `stale` (the README rule).
  - Agreement rule for the freeze (`freezeIssues` for sent): `expectsReply` equal; `promise` equal; `due` and `promiseDue` equal to the slot label (null = null). A disagreement blocks the freeze until a rewrite (stage 03 rewrite mode) or a recorded slot fix.
  - The sent bank freezes into its own manifest `evals/sim/lab-01/sent-manifest.json` (version `sent-v1`); `manifest.json` does not change.
  - Floors: at least 245 holdout and 49 dev cases with agreeing labels.
- **Test (unit):** T5 blind export of a fixture batch holds no `labels` key; T6 a label for an old hash → `stale`; T7 freeze with one `due` disagreement → issue `label_disagrees`; T8 freeze of an agreeing fixture → `sent-v1` with part hashes; a second freeze → `sent-v2` only when a hash changed.

## Step 3 — Eval case join

- **Goal:** `sentEvalCasesOf(root, scenario, part) → SentEvalCase[]` (`packages/core/src/sim/to-eval-case.ts` or a sibling): the blind view plus the slot labels, for stage 06. Holdout cases load only when the caller passes `{ holdout: true }`.
- **Test (unit):** T9 dev fixture → cases with labels; T10 holdout without the option → an error.

## Check

`bun test packages/core/src/sim apps/server/src/scripts/sim-args.test.ts`

## Done when

T1–T10 pass; the README of `evals/sim` has a short "Sent bank" section (writer and checker steps for the sent parts); the Proof prints `PROOF_OK` (`/tmp/f116-s02`).

## Out of scope

Writing texts (03), the extractor runner (06).
