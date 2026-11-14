---
opened: 2026-11-13
---

# F100 · Every Stage 2 metric is measured on real mail and the executive gets a weekly report that leads with misses and mistakes

## Outcome

Every Monday the executive gets one Telegram message with the week's numbers: missed important mail (M1, a lower bound), open loops on time (M2), serious mistakes (M3), handled share (M4), urgent notice time (M5), cost per mailbox (M7) and the evidence of each category on `auto` (M8), each number with its count. A read-only stats page shows the same numbers for 8 weeks per mailbox. The system stores what later epics need: the captured mail headers (display name, `Reply-To`, `Return-Path`, `Authentication-Results`, `List-Unsubscribe`, attachments, link hosts) and the IMAP flags (`\Answered`, `\Seen`, `\Flagged`). Mail sync runs every 2 minutes. This is E3a, the first half of E3 (E3b Improve, F109, is a later ticket).

## Scope

- Header capture and the IMAP flag store (one side table each), with retention.
- Sync every 2 min (config key, fallback 3); the LLM quota cause in `/status` and the digest (F073).
- One pure metric module in `packages/core` (M1–M5, M7, M8; the E2b week scorer calls it), row readers, a week service, `GET /api/stats` and `bun run stats:week`.
- M3 capture: reject reasons and the "this was a mistake" tap; the `\Answered` check in `/review`.
- The Monday message, the handled-share line in the daily digest (F033, F042), the stats page.
- Starting seams: `apps/server/src/modules/mail/{port,sync,jobs}.ts`, `mail/imap/{mapper,client}.ts`, `packages/core/src/triage/metrics.ts`, `modules/reports/`, `channels/notices/`, `channels/callbacks.ts`.

## Out of scope

- Phishing rules, attachments in the prompt, urgency context, prompt v3, escalation, degraded-mode notice (E3b, F109).
- The history check and the tripwire (E4-B, F110); the approvals-page reason select (E4-A, F102).
- E5 loop rows, E6 draft outcome line, IMAP IDLE (E8). Any classifier prompt or model change.

## Acceptance

- With the flag `weekly_report` on, a linked member gets one `weekly_report` outbox row per week on Monday, and its text shows M1, M2, M3 first, each with its count (`plan.md` § "Done when" 6).
- `bun run stats:week --org-id … --week <Monday>` prints M1–M5, M7, M8 for that week; `GET /api/stats` returns 8 weeks for a member and 404 for a foreign mailbox (§ "Done when" 5).
- A new mail gets one `email_headers` row in the transaction that stores it, and the sync run refreshes `email_flags` at most every 10 min (§ "Done when" 2, 3).
- The sync runs every 2 min by default; `MAIL_SYNC_EVERY_MIN=3` changes it without a code change (§ "Done when" 4).
- A reject reason tap and a "this was a mistake" tap each write one `action_feedback` row, and M3 counts them (§ "Done when" 7).
- `/status` and the digest name a provider quota pause (`http_429_quota`) (§ "Done when" 8).

## Slices

19 stages, one worker job each. Lanes, the two migrations (stages 04 and 16), stage-level waits for F097 stages, review jobs, coordinator steps and the one owner step: [plan.md](plan.md) § "How to run". No owner checkpoint.

## Sequenced

- Plan after: F097 (E2a Offline lab), which has `stages/`: this plan uses its interfaces (`TestMailRule`, `mailKindFilter(kind, rule)`, feedback source `review`, `/review`, `wilsonInterval`).
- Build after: F095 (E1 Close the MVP) in `spec/features/done/`. Feature flags come from F087 (landed, the first slice of E7-T2 F099). Stage-level waits: F097 stage 03 landed before F100 stage 04; F097 stages 01 and 03 landed before F100 stages 10 and 11; F097 stage 04 landed before F100 stage 15.
- Gate: — (owner step O1, the OpenAI budget alert, does not stop the build).

## Notes

Design, decisions, facts: [plan.md](plan.md); defaults to confirm: [questions.md](questions.md). Absorbs the dropped tickets F033 (handled share), F042 (delegations in the handled share), F073 (OpenAI budget alert). Sources: `docs/product/stage-2/epics/E03-measured-core.md`, `E03-discovery-notes.md`, PD-056–PD-069, ADR 0028.
