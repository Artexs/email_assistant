> **Status 2026-11-02 — planned.** Left: everything. Write the file-level plan when the task moves to `active/`.

# S1b Shadow triage

Scope: `docs/roadmap.md` §2, row S1b. Modules: `docs/modules.md`. Needs: S1a.

## Goal
The system classifies the user's mail and logs what it *would* do (mode `shadow`). Accuracy is measured per category, and a go/no-go table decides which categories may get automatic moves in S3.

## Done when
- The eval runner (`bun run eval`) reports precision and recall per category on the synthetic set, the injection cases, and at least 100 real labeled mails (labels in `triage_feedback`, from `bun run triage:label`).
- The whitelist rule is 100% correct; no injection case produces a send or a non-delegate recipient.
- A go/no-go table per category is in this file: automatic moves only where precision ≥ 98% (default bar, user may change it). The confidence threshold per category comes from the eval data.
- One week of the user's mail is classified in shadow mode; tokens and latency per mail are stored; the cost per mailbox per month is computed.
- A Flash-Lite model is compared with `gemini-3.8-flash` for the classifier role; the choice is logged.
- The daily LLM call cap and the budget alert work; a 429 / 503 / timeout does not move mail to `unsure` (test).
- No mail body and no secret in the logs (test).

## Plan
Written when the task starts (files to change, steps, tests).

**Gate:** Gemini Cloud Billing must be on before the system reads real mail (ADR 0007, ADR 0012). Use the test mailbox until then.
Input from S1a (stage 7 review): after a UIDVALIDITY rescan, rows older than 7 days keep the uid from the old UIDVALIDITY. Code that moves or flags mail must not trust `emails.uid` alone: check the mail by Message-ID first.

## Done-checklist
- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log
- 2026-11-02: Created from `docs/roadmap.md` and `docs/architecture.md` §11.
- 2026-11-02: Changed after the cold review (`tasks/done/mvp-plan-review.md`) and the user's answers (IMAP, home VPS, own Postgres).
