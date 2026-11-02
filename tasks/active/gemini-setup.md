> **Status 2026-11-02 — code done, check left.** Left: `cd backend && bun run gemini:test` must return a reply (the key works; on 2026-11-02 the model answered `503 high demand`). Try again later.

# Google Gemini API setup

Scope: ADR 0007 (accepted). Needs: —.

## Goal
The backend can call Google Gemini with a key from env and a model ID from config.

## Done when
- `cd backend && bun run gemini:test` returns a reply from the model.

## Result so far
- `@google/genai` 2.32.0 in `backend/`; `backend/.env.example` (`GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.8-flash`);
  script `backend/src/scripts/gemini_test.ts`. Commit `7b48e87`. `.env` is in `.gitignore`.
- ADR 0007 rewritten (accepted); architecture, modules, roadmap, product brief updated.
- Billing gate: free tier only with test data; Cloud Billing on before S1 reads real mail.
- 2026-11-02: `backend/.env` exists now. Nobody ran the test yet in this chat.

## Done-checklist
- [ ] Done-when checks pass (see log).
- [x] `docs/` describe the result.
- [x] Learned facts are in `notes/`.
- [x] Follow-up ideas are in `planned/`.

## Log
- 2026-11-02: Code done in the restart chat. Created as a task file on 2026-11-02 from `architecture-reset.md` §6.
- 2026-11-02: Ran `cd backend && bun run gemini:test` (cold-review agent). First run hung > 90 s; second run: `Request failed: {"error":{"code":503,"message":"This model is currently experiencing high demand. ...","status":"UNAVAILABLE"}}`, exit 1. The key is accepted (no 400/403). Alert in `docs/known-alerts.md`; rules in ADR 0012 (timeout, 503 = soft error).
