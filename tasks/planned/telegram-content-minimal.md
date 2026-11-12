> **Status 2026-11-12 — planned.** Plan B of the S6 master plan D32 (`tasks/active/s6-pre-sale.md`). Start only if the lawyer's answer to U0 is "no", or if a customer refuses Telegram.

# Content-minimal Telegram and web approvals

Scope: the S6 master plan D27, D32; `docs/architecture.md` §4.5 (approval flow), §6.2 (Telegram). Needs: S6b (the web login on the public domain).

## Goal

No mail content goes through Telegram. Telegram gets only counts and a link ("3 new urgent mails, open the panel"); the digest, the urgent details and the approvals (Send, Reject, Undo) move to web pages.

## Done when

- No `outbox` row of a Telegram notice holds a sender, a subject, an AI summary or a draft text (test over every notice kind).
- The panel has a digest page and an approval page with the same rules as the Telegram buttons (only an owner can send; the recipient and the "external sender" warning are shown).
- `docs/architecture.md` §4.5 and §6.2 and the papers describe the new flow.

## Plan

Written when the task starts. It is Phase 2 work in `docs/roadmap.md` §1 ("web pages for approvals, digests and delegation"), moved forward.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-12: Created by the S6 master plan session (cold review finding 8).
