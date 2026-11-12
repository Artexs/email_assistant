# E3 · Measured core and unit cost

> Tier: Must. Status: decided, second pass after the first E2a holdout report (PD-056–PD-069; E3a is ready to plan now). Size: about 27 stages, 5k lines, two tickets (E3a Measure, E3b Improve). Detail: `E03-discovery-notes.md`.

## Outcome

Every Stage 2 metric (M1–M8) is measured and reported weekly, each value category passes go/no-go on the simulator, `notification` and `spam` pass the history check on real mail (ADR 0028), and the cost per mailbox has a number and a path to the target.

## Users

Executive (sees the weekly numbers and the autonomy they earn); owner (quality and cost).

## In scope

- Metrics: M1 missed important mail (user-found `urgent` / `needs_reply`: from corrections, moved-back detection and `/review` labels), M2 open loops on time (delegations now; waiting-for-reply after E5), M3 serious mistakes per week (wrong auto move of important mail, wrong recipient, bad delegate, off-tone draft: from Undo, reject and labels), M4 handled share (F033, F042), M5 urgent latency, M7 cost per mailbox, M8 per-category precision and recall. One weekly report (digest line plus a stats page or section; PRD US-013).
- Classifier work only where E2 shows misses: folder hint (F061), per-category thresholds, urgency context in the prompt (R3), few-shot from user corrections, model choice per category.
- Phishing and suspicious-mail flag: rule-based first (sender mismatch, look-alike domains, link and display-name checks), shown as a reason.
- Attachment awareness in triage and summary (name, type, size; never raw to Telegram).
- Cold-mail sub-label under `notification` or `spam` (not a feature).
- Unit cost (M7, R16): cost per mailbox per simulated week; the path: hard rules and sender history before the LLM, a cheap first pass, a stronger model only for unclear mail, caching. Feeds the S6e cost model (E7).
- Model-lifecycle rule: record model per decision (exists); the E2 gate before any model switch; provider fallback (F072) and budget alerts (F073, F023).

## Out of scope

New categories. Reply drafts (E6). Contacts model (E11). RAG or vector search unless E2 shows a gain.

## Dependencies

E2a only (PD-013); the urgency-context prompt reads the E2a profile shape (PD-017). Decided (PD-056): E3a needs only E1, E3b needs E2a. Blocks E5, E10, E11.

## Open product questions

1. M3 definition: which events count as "serious" (review proposal in `03` §5).
2. Cost target: ≤ $5 per mailbox per month, or a different placeholder price.
3. Per-category model choice: allow a stronger (costlier) model for `urgent` only.

## Risks

- The numbers may show the core needs more work than the plan assumed; then E5 and E6 wait and this epic grows (author concern 02 §15, accepted).
- The cost target may be unreachable at 200 mails a day with current prices; then the target changes, with the reason recorded.

## Exit

- The weekly report shows M1–M8 for the pilot mailbox and for the simulated week.
- Go/no-go: every value category passes on the simulator holdout; `notification` and `spam` pass the history check on the pilot mailbox (ADR 0028, PD-068). Real labels (≥ 30 rows) count only as a block.
- `docs/cost-model.md` input: cost per mailbox per month from measured data.

## Discovery (2026-11-13)

### Verdict: modify and split

The outcome is right: M1–M3 are the thesis in numbers, and nothing else in Stage 2 measures them. Four changes:

1. **Split** into **E3a Measure** (metric module, weekly report, stats page, M3 capture, header capture, sync every 2 min) and **E3b Improve** (phishing flag, attachments, urgency context, prompt v3, conditional escalation). E3a needs only E1, so real-mail numbers start weeks earlier; E3b needs the E2a holdout.
2. **Drop cost-reduction work.** The classifier costs $0.86 per mailbox per month; the full estimate is ≈ $1.8 (≈ $3.2 with escalation) against the $5 target. Keep the measurement (M7), not the cost path.
3. **Thresholds are a weak lever.** The 2026-11-07 sweep is flat from 0.50 to 0.90: the model is almost always "sure". Precision comes from context, rules and a second opinion before a hide.
4. **M5 fails by design today**: sync every 5 min. Sync every 2 min in E3a; IMAP IDLE stays in E8.

### Code cross-check (summary; full table in the notes §1)

| Item | Exists today | New |
| --- | --- | --- |
| M1 | Feedback with true category; moved-back detection (`triage/returned.ts`); `computeMetrics` | Weekly query; `\Answered` re-check; targeted `/review` |
| M2 | `delegations` (`due_at`, `answered_at`, reminders) | Weekly query |
| M3 | Action statuses, audit | Reject reason, "mistake" tap, query |
| M4 | Data exists | F033, F042 |
| M5 | `outbox.sent_at`, `emails.received_at` | Query; sync 5 → 2 min |
| M7 | Tokens per decision, `cost.ts`, `triage:cost` | All LLM calls + hosting share |
| M8 | Eval, real-label gate (0.98, ≥ 30) | Weekly view; Wilson bound from E2a |
| Weekly report | Daily digest only | Weekly message, stats page, stats API |
| Phishing, attachments | `From` address and text only; `simpleParser` drops the rest | Header capture migration; rules; prompt input |
| Urgency context | VIP flag only | Profile storage, prompt v3 |

Page corrections: hard rules already run before the LLM; few-shot from corrections is replaced by a counts-only sender history hint (no text of other mails in prompts); F072 leaves Stage 2.

### Cross-epic notes (edits for the other pages; detail in the notes §5)

- E2b: the week scorer calls the E3a metric module; one definition per metric.
- E4: approvals page shows the reject-reason select; autonomy page reads the stats API; bulk unsubscribe uses the `List-Unsubscribe` header that E3a captures; the urgency editor uses the E3b command.
- E5, E6: no follow-up or reply draft for a phishing-flagged mail.
- E7: operator console reads the stats API; `docs/cost-model.md` reads weekly M7.
- E8: the latency alert reads the E3 query; IDLE later replaces the 2-min poll.
- E9: OAuth adapters return the same header fields. E11: replaces the sender history hint.

### Research (sources in the notes §3)

- OpenAI prices (read 2026-11-13): `gpt-6-luna` $0.10 / $0.50 per 1M tokens, `gpt-6.1-terra` 10× that; EU regional processing +10%.
- Hetzner CX23 €5.99 per month (aggregators, 2026-11-10): the reference hosting share.
- Verbalized LLM confidence is overconfident, worst on hard cases (arXiv 2605.23909, 2026-04-03).
- Cascades: cheap first, escalate only unreliable answers (FrugalGPT, 2023).
- Phishing signals: `Authentication-Results` (RFC 8601), look-alike domains (UTS #39), display-name spoofing, `Reply-To` mismatch (vendor guides 2022–2026, marketing).
- Competitors report "hours saved", not misses (Superhuman 2026-11-03, marketing): a misses-first report is a differentiator.

### Decisions (owner 2026-11-13: "in default values"; rows PD-056–PD-069)

Map: 1 → PD-056, 2 → PD-057, 3 → PD-058, 4 → PD-059, 5 → PD-060, 6 → PD-061, 7 → PD-062, 8 and 9 → PD-063, 10 → PD-064, 11 → PD-065, 12 → PD-066, 13 → PD-067, 14 → PD-069. Added after the answer: PD-068 (E3 adopts the ADR 0028 numbers, which E4 left to E3; exit line above rewritten; send-limit re-check; feature flags). PD-030 applies: labels in M1 and M8 measure and block, they never unlock `auto`.

1. Split into E3a Measure (needs E1, wave 1) and E3b Improve (needs E2a). [yes]
2. M3 counts: important mail hidden by an automatic move; reject "wrong person"; reject "wrong content"; "this was a mistake" on a sent mail; (sim) phishing pushed as urgent without a warning. Not counted: "not needed", edits, Undo of unimportant mail. Capture: optional reason buttons after a reject, a "mistake" button on the send result. [yes]
3. M1 on real mail = corrections + `/review` + moved back with a label + `\Answered` mail not marked `needs_reply` (confirmed in `/review`); the report calls it a lower bound. [yes]
4. Cost target: keep $25 placeholder and ≤ $5 per mailbox per month; M7 counts all LLM calls plus a hosting share (CX23 ÷ 20 mailboxes until the E8 load test). No cost-reduction work. [yes]
5. Per-category model: no user setting. A stronger model checks a mail only before an automatic hide of a person's mail or on `unsure`, and only if the E2a holdout shows `urgent` or `needs_reply` recall below target. [yes; second pass after the first E2a holdout report]
6. Classifier work list (urgency context, folder hint F061, sender history hint, cold-mail reason code): each is a prompt v3 experiment on the dev set; ship only what wins and passes the holdout gate. [yes; second pass after the first E2a holdout report]
7. Few-shot from user corrections: replace by a counts-only sender history hint. [yes]
8. Phishing flag: rule-based (auth fail, look-alike domain, display-name spoof, `Reply-To` mismatch, link mismatch, risky attachment); it warns, it does not move; flagged mail gets no reply or delegation draft. [yes]
9. Header capture: display name, `Reply-To`, `Return-Path`, the receiving server's `Authentication-Results`, `List-Unsubscribe`, attachment list, link hosts; same retention as mail text. [yes]
10. Attachments: name, type, size into the prompt (untrusted) and the summary; never content. Cold mail: a reason code under `spam` / `notification`. [yes]
11. M5: p90 from arrival to urgent notice; sync every 2 min. [yes]
12. Weekly report: Monday message (M1–M3 first, then M4, M5, M7, M8 per `auto` category) plus a read-only stats page (8 weeks); handled-share line in the daily digest. [yes]
13. F072 provider fallback: out of Stage 2. Instead, during an LLM pause, VIP and whitelisted mail gets a "not triaged yet" notice (sender only). F073 in E3a; F023 only if a paid Gemini project exists (E2a judge). [yes]
14. Apply the cross-epic edits now to the pages that no session holds (E5, E6, E9, E11). E2, E4, E7 and E8 are in session: their edits stay in the notes §5 and go in after those sessions commit. [yes]
15. Commit the changed files by explicit path. [yes]

### Tickets

- Absorbs: F033 and F042 (E3a, handled share), F073 (E3a), F061 (E3b experiment), F023 (only with a paid Gemini project).
- Out of Stage 2: F072 (stays planned; PD-067). Stays planned, not absorbed: F063 (the weekly M7 shows if a spam wave needs it).
- Needs from other epics: F028 `/review` and the holdout (E2a); the approvals reason select (E4-A); feature flags (E7).

### Second pass (trigger: the first E2a holdout report)

Only PD-060 (escalation) and PD-061 (classifier work list) wait. The report must give per category precision and recall with the Wilson bound, `urgent` recall per source (`text`, `vip`, `context`), and cost per mail. Escalation is built only if `urgent` or `needs_reply` recall is below target; each work-list item ships only if it wins on the dev set and passes the holdout. E3a does not wait for this.

### Size and risks

Size: about 27 stages, 5k lines (E3a ≈ 13 / 2.3k, E3b ≈ 14 / 2.7k). Header capture, phishing rules and the M3 capture are new; cost-reduction work leaves.

| Risk | Mitigation |
| --- | --- |
| E2a numbers show the core needs much more work (accepted in 02 §15) | E3a measures real mail first; the owner re-reads the epic table after the second pass |
| Interia sets no `\Answered` or adds no `Authentication-Results` | E3a stage 1 checks the pilot headers; without them those signals are off and the rest still runs |
| 2-min sync throttled by the provider | Stage 1 watches the pilot; fall back to 3 min; IDLE in E8 |
| A phishing false positive on a real business mail | The flag only warns; whitelist and VIP keep their decision; zero flags on whitelisted holdout mail is an exit check |
| Small weekly counts read as proof | Every number shows its count; real-mail M1 is labelled a lower bound |
| Metric drift between the weekly report and the sim scorer | One metric module for both |
| Prompt tuning on the gate set | E3b tickets use the dev set only; the holdout runs only as the gate (E2a rule) |
