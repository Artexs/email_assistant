> **Status 2026-11-05 — done (code); check moved.** The open check (a reply from `GEMINI_MODEL`) moved to `tasks/planned/s1b-shadow-run.md` (stage 36). Flash-Lite answers; the S1b classifier uses it.

# Google Gemini API setup

Scope: ADR 0007 (accepted). Needs: —.

## Goal
The backend can call Google Gemini with a key from env and a model ID from config.

## Done when
- `bun run gemini:test` (repo root) returns a reply from the model.

## Result so far
- `@google/genai` 2.32.0 in `apps/server/`; root `.env.example` (`GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.8-flash`);
  script `apps/server/src/scripts/gemini-check.ts`, run with `bun run gemini:test` from the repo root. Env is in the root `.env`
  (in `.gitignore`). S0 moved the script from `backend/` (first commit `7b48e87`).
- ADR 0007 rewritten (accepted); architecture, modules, roadmap, product brief updated.
- Billing gate: free tier only with test data; Cloud Billing on before S1 reads real mail.
- 2026-11-02: the `.env` exists now (S0 moved it to the repo root). 2026-11-03: `bun run gemini:test` from the repo root loaded the key and reached the API. The reply was the known `503 UNAVAILABLE` (high demand). A successful model reply is still to be seen.

## Done-checklist
- [ ] Done-when checks pass (see log).
- [x] `docs/` describe the result.
- [x] Learned facts are in `notes/`.
- [x] Follow-up ideas are in `planned/`.

## Log
- 2026-11-02: Code done in the restart chat. Created as a task file on 2026-11-02 from `architecture-reset.md` §6.
- 2026-11-02: Ran `cd backend && bun run gemini:test` (cold-review agent). First run hung > 90 s; second run: `Request failed: {"error":{"code":503,"message":"This model is currently experiencing high demand. ...","status":"UNAVAILABLE"}}`, exit 1. The key is accepted (no 400/403). Alert in `docs/known-alerts.md`; rules in ADR 0012 (timeout, 503 = soft error).
- 2026-11-04: Free-tier key check with a one-off script: `gemini-3.5-flash-lite` 837 ms, `gemini-3.1-flash-lite` 1003 ms, `gemini-flash-lite-latest` 971 ms answered; `gemini-3.8-flash` and `gemini-3.7-flash` gave `503 high demand`; `gemini-2.5-flash-lite` 404. `bun run gemini:test` still fails (it uses `gemini-3.8-flash`).
- 2026-11-05: `bun run gemini:test` → `[gemini-check] Request failed: LlmSoftError http_503`. Check merged into `tasks/planned/s1b-shadow-run.md` (user decision); closed.
