# s1b-shadow-triage — Stage 36

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 36 — Model comparison with `gemini-3.8-flash` [risky] (runs in parallel with stages 37–40)

- [ ] **36.1 Same subset for both models; the final model choice**
  - Goal: compare `gemini-3.5-flash-lite` with `gemini-3.8-flash` on the same subset and log the choice.
  - Files: create `evals/results/<date>-gemini-3.8-flash-pc3.md` and `evals/results/<date>-gemini-3.5-flash-lite-pc3.md` (synthetic data only); change this task file ("Results": comparison table, final model choice; log line), `docs/architecture.md` §6.3 (the model choice line), `.env.example` (`GEMINI_MODEL_CLASSIFIER`) only if the choice changes.
  - Interfaces: none new.
  - Decisions:
    - Preconditions: stages 30 and 34 committed. This stage is not a precondition of stages 37–40 (review finding 16): `gemini-3.8-flash` has its own per-model quota, and the Flash-Lite subset run uses only 18–36 requests of the Flash-Lite quota that the VPS worker shares.
    - Commands: `bun run eval --set all --per-category 3 --retries 1 --model gemini-3.8-flash --out evals/results/<date>-gemini-3.8-flash-pc3.md`, and the same with `--model gemini-3.5-flash-lite` (`…-gemini-3.5-flash-lite-pc3.md`). Each has 18 cases (step 15.1), so 18–36 requests with `--retries 1`. Exit 2 → run the same command again the next day (after midnight Pacific time) until it is complete.
    - Both models get the same simple request (no `temperature`, no thinking setting; user 2026-11-04). `gemini-3.8-flash` uses its default thinking; its tokens and cost per mail in the report show the effect.
    - "Not comparable" (user answer Q27): when `gemini-3.8-flash` stays unavailable (503, more than 10% errors) on 3 different Pacific quota days, log "not comparable: 503" with the 3 dates and the error counts, and keep Flash-Lite. This counts as done for the done-when item.
    - A 400 (any `http_400_*` code) or another config error in the comparison: stop and report to the main session with the code. It is not "not comparable".
    - The comparison table in this file: per model, on the subset: precision and recall per category, whitelist and injection results, avg tokens, latency p50/p95, cost per mail and per mailbox per month (paid-tier price, with source and date).
    - Choice rule (ADR 0012): the cheapest model that passes the structural checks and has the better or equal precision on the subset. If the choice is `gemini-3.8-flash`: change `.env.example`, write the line in architecture §6.3, and ask the main session. The VPS `.env` changes only with the user, and a model change needs a full eval run first (code-patterns).
    - If a structural check fails: stop and report (no prompt change in this step, as in step 34.1).
  - Test: none new.
  - Check: both eval commands exit 0 (or the "not comparable: 503" log line with 3 dates); `bunx prettier --check docs/architecture.md`.
  - Done when: both subset reports (or the "not comparable" line) are in `evals/results/`, and the table and the model choice are in this file and in architecture §6.3.
  - Out of scope: real mail, the VPS `.env`, a prompt change.
