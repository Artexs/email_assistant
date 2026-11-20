# F125 stage 18 — G07 and G08: the mail OAuth spike tests run in the unit suite

Part of [`../plan.md`](../plan.md) § Phase B. Needs: the `test:unit` script of the root `package.json` (on master). May run next to 08–17, 19, 20. Gets a review job (plan § Review).

Groups G07 (`FIX-NEVER-RUNS`, rule K3) and G08 (`FIX-NEVER-RUNS`, rule none). Owner answer (G1, 2026-11-20): keep `tools/mail-oauth-spike/` and add it to `test:unit`, so CI runs its 23 tests; Microsoft and Google mailbox sign-in stays planned, and the kit is its first step. Rows: `audit/review-core-web-tools.md` (the `probe.test.ts` and `redact.test.ts` rows). Follow plan § Cut stage steps S1–S3 and S6–S7. S4/S5: only the JUnit count (below); no lcov or mutant check (D9, `FIX-NEVER-RUNS`).

## Rows of this stage

The 23 keys of G07 and G08 in `tools/mail-oauth-spike/probe.test.ts` and `redact.test.ts`. They change no line; the stage makes them run.

## Step 1 — Add the folder to the unit paths

- Add `tools/mail-oauth-spike` to the path list of `test:unit` in the root `package.json`. No `bun.lock` change, no new dependency (the kit imports `imapflow` and `nodemailer`, which the root install already holds).
- Places that copy the unit path list (a changed-tests script, a doc that lists the suites): the worker greps for one of the existing paths, for example `tools/llm-replay/src`, and updates each copy.
- **D22** Add one sentence to `tools/mail-oauth-spike/README.md`: when the kit is deleted, remove its path from `test:unit` too. Reason: the kit's README says the mailbox sign-in ticket deletes it at its end; a path to a missing folder would fail the suite. Rejected: a glob such as `tools/*/` (it would also pick up test folders that are not unit tests, for example `tools/fake-telegram/test` of the int suite).
- One commit: `F125 G07 FIX-NEVER-RUNS: oauth spike tests in test:unit` (covers G08 too: one path change cannot be split; the message names both groups).

## Check

- `bun test tools/mail-oauth-spike` passes: 23 pass, 0 fail, 0 skip (log `/tmp/f125-s18/spike.log`). A failing case is a finding: stop and report it; do not change the kit's code (Cut stage rule 5).
- Case delta: the unit suite grows by the cases of the folder (23 at the data base). Record the count of the spike run as the delta; no extra suite run for it.
- `package.json` changed, so `check:job` runs the full suites by its own rule; that run is the proof that the unit suite with the new path passes.

## Done when

- `audit/cut-s18.md` holds the 23 keys, the spike log line and the `check:job` line.
- One commit naming G07 and G08.
- Last step: `bun run check:job`; copy its last line.
