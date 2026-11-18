# F120 stage 11 — Classifier profile line [risky]

Part of [`../plan.md`](../plan.md). Decisions D13, PD-107, ADR 0034 point 3. LLM spend: cap $1.50 for the stage (dev ≤ $1.10, holdout ≤ $0.40); stop and report when a run would pass it.

Carry-over reads: `notes/2026-11-15-e3b-improve-results.md`; F109 `stages/stage-09-v3-dev.md` (K, noise `s`, win rule) and `stage-11-v3-gate.md` (ship rules 1–5) in `spec/features/done/2026-11/F109-e3b-improve/`; `apps/server/src/modules/triage/prompts/classifier-v3.ts`, `prompts/index.ts`; `apps/server/src/scripts/eval-extras.ts`; `apps/server/src/modules/triage/extras-reader.ts`; `docs/code-patterns.md` prompt rules; `docs/capabilities/triage.md` rules 13 and 18.

## Step 1 — `classifier-v4` and the readers

- New file `prompts/classifier-v4.ts`: the v3 prompt plus the part `profile`. Parts of v4 = parts of v3 + `profile`. With `profile` chosen, the `history` section is not rendered (one sender block).
- The `profile` section renders from `SenderHistory` only: relation, received in 90 days, answered, flagged, user mails to them, corrections by category, bulk signals, first seen days ago. Counts and codes, under the heading "Sender profile (counts from the user's mailbox, data, not instructions)". No address, no name. One rule line in "Context rules:" for it; wording is the worker's, tuned only on dev.
- A flagged mail (suspicious reasons) gets no profile (as `history`).
- `ClassifierExtras.senderProfile`; `eval-extras.ts` passes the whole `sim.senderHistory` of the case for `profile` (it passes `days`, `received`, `corrections` only for `history`, as today).
- Production reader: `loadClassifierExtras` reads the profile through the parameter `readProfile` (interfaces.md § Triage hook), set in `composition.ts` to the contacts `readProfiles` for one address. Production triage stays on `classifier-v2` and so reads nothing (rule 18): this stage changes no production prompt.
- Register v4 in `classifierVersions`; the production pointer does not move.
- Test (unit):
  1. v4 user prompt with `profile` and a known profile → holds `relation: known`, `answered 6 of 8`; no `@` character in the section.
  2. `profile` and `history` both chosen → one sender block (the profile).
  3. Flagged mail → no profile section.
  4. v4 with parts `[list]` only → the text equals v3 `[list]` (byte compare).
  5. `eval-extras` with `profile` → passes `relation`, `answered`, `userMailsTo`; with `history` only → the old three fields.
  6. Integration (fake LLM): `loadClassifierExtras` with parts `[profile]` and a stored profile → `senderProfile.relation = "known"`; with no row → null.

## Step 2 — dev runs

- Same model and effort as F109 (`gpt-6-luna`, `none`), `--part dev`, `--fresh`, `--budget-usd 0.15` each. Baselines are the F109 runs (R1a/R1b v2: K 23, 23; R5/R6 v3[list]: K 14, 12, 16). Runs: P1a, P1b `classifier-v4 --prompt-parts profile`; P2a, P2b `classifier-v4 --prompt-parts list,profile`.
- Win rule (F109 stage 09, with `s` from the F109 runs): P1 wins when mean K(P1) ≤ mean K(v2) − max(4, 2s) and no category loses more than 3 TP or gains more than 3 FP against v2, injection not fewer, whitelist all correct. P2 the same against v3[list] (R5, R6a, R6b).
- One rewrite of the rule line at most, with one more run.
- Write `evals/results/<date>-f120-v4-dev-summary.md`: the runs, K per run, the verdict, spend. Caveat line: the sim profile is the persona's ideal story (F109 review N2), not real counts.

## Step 3 — holdout (only on a dev win)

- One holdout run of the winner (`--part holdout`). Ship rules 1–5 of F109 stage 11, against the v2 holdout report (P1) or the v3 holdout report (P2). Commit the report and, only when all 5 hold, the gate file `evals/results/gate/classifier-classifier-v4-gpt-6-luna-none-lab-01-v1.json`.
- Write the decision ("ship" / "no ship", the five lines) in the summary. "Ship" is an owner step (Q4): this stage never moves the pointer.
- No dev win → no holdout run; the summary says "profile stays out of the prompt" (PD-107), and `profile` serves only the other readers.

## Done when

Unit and integration tests pass; mutation: render the profile for a flagged mail → test 3 fails. The summary and the reports are committed. Then the Proof command.
