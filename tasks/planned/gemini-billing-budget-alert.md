> **Status 2026-11-04 — planned.** Left: everything. Start when Cloud Billing goes on for the Gemini key (before any other person's mail, ADR 0013).

# Gemini Cloud Billing budget alert

Scope: ADR 0012 ("A Cloud Billing budget alert"), ADR 0013 (pilot on the free tier, user 2026-11-04). Moved out of `tasks/done/s1b-shadow-triage.md` (user answer 3, 2026-11-04): a budget alert cannot exist without billing. Needs: Cloud Billing on for the Google Cloud project of `GEMINI_API_KEY`.

## Goal

When the project uses the paid tier, a Cloud Billing budget warns the user before the Gemini cost gets too high.

## Done when

- A budget exists for the project of `GEMINI_API_KEY`, with an amount the user picks (use the S1b `bun run triage:cost` figure per mailbox per month as the base).
- Alert thresholds (for example 50%, 90%, 100%) send mail to the user.
- The user saw one alert mail or the budget page shows the alert setup (screenshot or a log line with the date).
- `docs/architecture.md` §6.3 and `docs/roadmap.md` §5 say that the budget alert is on; the S1b in-app daily cap (`LLM_DAILY_CAP`) stays.
- ADR 0013 (pilot mailbox on the free tier) ends for this project: the free-tier lines in `docs/architecture.md` §6.3 ("Data by stage") and the §7 privacy table, and in `docs/product-brief.md`, say the paid tier again. ADR 0013 gets the status `superseded` by a new ADR (accepted ADRs are not edited, `docs/decisions/README.md`).

## Plan

- [ ] 1. User: turn on Cloud Billing for the project (this also ends the free tier for that project; check the pricing page first).
- [ ] 2. User: Google Cloud console → Billing → Budgets & alerts → create a budget for the project with the thresholds above. [not verified: menu names]
- [ ] 3. Agent: update the docs lines above and `notes/` with the date and the amount (no account ids, no secrets). Switch the free-tier lines back to the paid tier: `docs/architecture.md` §6.3 "Data by stage", the §7 privacy table, `docs/product-brief.md`. Write a short ADR that supersedes ADR 0013 for this project. Check: `grep -rn -i "free tier" docs/` shows only history lines (ADRs, dated log lines).
- [ ] 4. Agent: check `LLM_DAILY_CAP` and `GEMINI_RPM` against the paid-tier limits and change the VPS `.env` only with the user. The free-tier cap day (America/Los_Angeles, S1b) can go back to the UTC day: it is the code constant `QUOTA_TIMEZONE` (S1b cost-gates stage), not a `.env` key, so this is a code change (commit).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe the current state.
- [ ] Learned facts are in `notes/`.

## Log

- 2026-11-04: Created from the S1b plan update (user answer 3).
