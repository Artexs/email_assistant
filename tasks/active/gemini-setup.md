> **Status 2026-11-03 — code done, check left.** Left: `bun run gemini:test` from the repo root must return a reply (the key works; on 2026-11-02 the model answered `503 high demand`). Try again later.

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
