# s1b-shadow-triage — Stage 34

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 34 — Full Flash-Lite eval run [risky]

- [ ] **34.1 Full eval with `gemini-3.5-flash-lite` and the provisional model choice**
  - Goal: real eval numbers on the full synthetic and injection sets for the default classifier, before the VPS stages.
  - Files: create `evals/results/<date>-gemini-3.5-flash-lite.md` (synthetic data only); change this task file ("Results": provisional go/no-go table, provisional model choice; log line).
  - Interfaces: none new.
  - Decisions:
    - Command: `bun run eval --set all --model gemini-3.5-flash-lite --out evals/results/<date>-gemini-3.5-flash-lite.md` (about 90 requests of the shared Flash-Lite daily quota). Exit 2 → run the same command again the next day (after midnight Pacific time).
    - Default classifier `gemini-3.5-flash-lite` (user answer 2, 2026-11-04). ADR 0012: pick the cheapest model that passes the go/no-go bar. Provisional choice = `gemini-3.5-flash-lite` when the whitelist check is 100% and every injection case passes; stage 36 makes it final.
    - The request has no `temperature` and no thinking setting (simple calls, user 2026-11-04). So results can change a little from run to run; the report states the run date and the model.
    - Stop and report to the main session, with the failed case ids and the error codes (no case text), when any of these happens (review findings 21 and 23):
      - the whitelist check is below 100%, or an injection case fails;
      - the run exits 1 because more than 10% of the cases end in an error (for example `bad_output` or `http_400_precondition`).
    - Do not change the prompt in this step. A prompt change needs `classifier-v2.ts`, a new version id and a new eval. It becomes a new [risky] step that the main session plans (main-session decision 2026-11-04).
    - A case that Google blocks for safety counts as predicted `unsure` (`llm_blocked`), not as an error (user answer Q28).
    - The synthetic go/no-go table is provisional; with about 15 cases per category and the minimum support of 30, every category shows `no-go: too few`. Copy the table, the sweep precision and the confidence histogram per category into "Results". The real-mail table (step 40.1) is final.
    - No VPS worker uses the key yet, so the run has the whole daily quota.
  - Test: none new.
  - Check: the eval command exits 0; `bun run lint && bun run typecheck && bun run test:unit`.
  - Done when: the report is in `evals/results/`, and the provisional table and model choice are in this file (or the stop report went to the main session).
  - Out of scope: real mail, a prompt change, the 3.8 Flash comparison (stage 36).

## Follow-ups from the checkpoint 2 group review (2026-11-05)

- The stage 18 smoke run used only the full `allowed` list. The schema without `spam` (whitelisted sender) has not reached Gemini yet: run at least one whitelist case early, and check that `z.toJSONSchema` keywords (`maxLength`, `pattern`, nullable) are accepted [not verified]. Do not start the full run late in a Pacific day (spent quota, 4 retries per case).
