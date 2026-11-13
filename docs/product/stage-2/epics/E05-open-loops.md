# E5 · Open loops

> Tier: Must. Status: decided, second pass after the first E3a weekly report on the pilot and the E2b live week (PD-115–PD-129; only PD-119, PD-120, PD-122 wait). E5a is ready to plan. Size: about 29 stages, 5.8k lines, two tickets (E5a Read Sent about 7, E5b Open loops about 22). The highest-value new feature in the plan (04 §3). Detail: `E05-discovery-notes.md`; ADR draft `docs/decisions/0029-read-sent-folder-read-only.md`.

## Outcome

Nothing the executive is waiting for slips: the system tracks replies they wait for, promises made in threads, and work delegated by hand, and it chases with a draft. The morning digest becomes a "needs you today" brief.

## Users

Executive. The EA later (Stage 3).

## In scope

- **Waiting-for-reply**: the user's own sent mail that asks a question or requests something, with no answer after N days → a line in the brief and a follow-up draft (same engine as delegation tracking and the chaser). Needs the Sent folder: today the system never reads Sent (architecture §4.1 rule 1); this epic adds a read-only Sent sync with its own ADR and the rule "never change Sent".
- **Commitments**: promises the executive made in threads ("offer by Friday") extracted by the LLM into checked, dated items; the user confirms or drops each one; due items in the brief.
- **Manual delegation**: from the panel and a Telegram command, tracked like automatic delegation (PRD US-012); the Sent-folder check for forwards the user made by hand.
- **"Needs you today" brief**: the digest reordered as open loops first: urgent, waiting on you, waiting on others (overdue first), promises due, then the handled summary. Also the input for M2.
- M2 (open loops on time) counts waiting-for-reply and commitments from here on.

## Out of scope

Calendar and meeting items (Stage 3). Snooze (later, small). Reply drafts for incoming mail (E6). Reading Drafts or Trash.

## Dependencies

E3 (metrics and the simulator's waiting-for-reply cases), E4 (dashboard and API commands). Blocks E11 (thread summaries build on the same thread model).

## Open product questions

1. Default wait before a follow-up draft: 3 working days? Per contact later (E11).
2. Commitments: extract only from the executive's own mail, or also from what others promised to them ("vendor said Tuesday").
3. Follow-up drafts: automatic draft with approval (like delegation) or only a line in the brief by default.
4. Sent sync depth: last 30 days at connect, then incremental.

## Risks

- Reading Sent is a privacy and trust step: the user must see it in the mailbox settings and switch it on; shadow first.
- LLM-extracted commitments are untrusted text: dates and items are checked, never acted on without a tap.
- Threading by headers on IMAP providers is imperfect (roadmap risk 2); the simulator covers forwarded and broken threads.

## Exit

- On the simulated week: M2 ≥ 90% for delegations and waiting-for-reply; every planted dropped thread appears in the brief within the set wait.
- On the pilot mailbox: one real waiting-for-reply chase went out after a tap.
- ADR for the Sent read; the mailbox settings page shows the switch.

## Discovery (2026-11-13)

Detail, sources and the full design: [E05-discovery-notes.md](E05-discovery-notes.md). ADR draft: `docs/decisions/0029-read-sent-folder-read-only.md`. E3 is decided (PD-056–PD-069); E6, E9, E10 and E11 were in session at the same time.

### Verdict: modify and split

The outcome is the thesis ("nothing slips"); keep it. Changes:
1. **Split.** **E5a Read Sent** (read-only Sent sync, "answered by the user" marks, switch, ADR 0029) needs only E1 and the E7-T2 flags, so it lands early. E4-B (history check), E3a (M1), E6 (stale drafts, style) and E5b all read it. **E5b Open loops** (waiting, promises, manual delegation, follow-ups, brief, loop page) needs E3a, E4-A, E5a and the E2a tools.
2. **Narrow promises** to the executive's own promises with a date. Others' promises wait (second pass).
3. **Add** close rules, "Later" on loop lines, an eval set for sent mail, and two M2 numbers (surfaced, closed).
4. **Correct the page**: the reminder body is a template today (`core/outgoing/templates.ts`), so a follow-up needs no LLM text; manual delegation is a button on the mail's row, not a free-text Telegram command; promises need no confirm step (PD-030 spirit).

### Code cross-check (summary; full table in the notes §1)

| Item | Exists today | New |
| --- | --- | --- |
| Sent folder | Path known (`mail/connect.ts:39`); never read except to locate own copies | Read-only Sent pass, own cursor and table |
| Own sends | `X-EA-Action-Id` on every system mail; fetched by the sync | Link in Sent, never a loop |
| Threading | `thread_key`, `In-Reply-To`, `References` on incoming mail | Same for sent mail; subject fallback |
| Reply detection | `detectReply` for delegations, delegate address only | Any participant; auto-reply filter |
| Follow-up engine | Chaser (07:30, 3 days, max 2), template reminders, approvals, committer | Template kind `follow_up`; recipients from Sent headers |
| Manual delegation | — (triage only; Telegram has 5 commands) | Delegate button and picker; hand forwards to a delegate tracked |
| Promises | — | One LLM call per sent mail; code-checked dates |
| Brief | Digest with delegation counts in the footer | Loop sections in the morning digest |
| Loop page | E4-A `/delegations` (planned) | Tabs Delegated · Waiting · Promised |

### Cross-epic notes (edits for the owner; full list in the notes §6)

- E3: M2 as two numbers (surfaced ≥ 98%, closed ≥ 90%); the E5a "answered" mark joins `\Answered` for M1.
- E4: the history check reads the E5a mark when it exists; build `/delegations` so E5b can add tabs.
- E6: reuse ADR 0029 for any read of Sent; a reply draft expires when the user answered by hand.
- E7: flags `sent_sync`, `open_loops`; new columns join the DSR map and org delete; papers name sent mail.
- E9: Graph and Gmail adapters offer the Sent pass. E11: per-contact wait replaces the 3-day default.
- E2: the sent-mail bank is E5b's work with E2a tools; E2b's scripted executive APPENDs a Sent copy.
- E3 (PD-063, PD-069): no follow-up draft for a phishing-flagged thread; included here. E3a stores the IMAP flags (PD-068); the E5a mark adds the Sent signal.
- `05` §2 graph: E5a after E1 and E7-T2; E5b after E3a, E4-A, E5a.

### Research facts (sources and dates in the notes §3)

- Inbox Zero (vendor docs 2026): follow-up thresholds default 3 days, weekends excluded; nudge drafts optional; a reply or own send clears the label; reminders can go to Telegram.
- Superhuman (vendor help, read 2026-11-13): AI picks sent mail that needs a follow-up; weekdays-only option; the follow-up draft appears about 1 h before the reminder; never sends by itself.
- Gmail nudges (Google 2018; Kanmail 2026-11-06): Gmail picks which mail and when; no list of open loops.
- Microsoft Viva Briefing (2020–2023, paused 2023-01-15) tracked commitments both ways; a CSCW 2024 study: value is "an extra reminder"; inaccurate or stale items lose trust.
- Lampert et al. 2008: requests and commitments in email are hard to identify (conditional, implicit, reported).
- Interia (own notes 2026-11-03): SMTP saves no Sent copy; mail apps do. Mail from an app that keeps none is invisible.

### Decisions (defaults; the owner accepted all, PD-115–PD-129)

1. Verdict "modify": split into E5a Read Sent and E5b Open loops; narrow promises; add close rules, "Later", the sent-mail eval and the M2 split. [yes]
2. Read Sent per ADR 0029: read-only, own table, never triaged; a per-mailbox switch "Track my sent mail", on for new mailboxes with one line at connect, off for existing ones until you turn it on; org flag `sent_sync` off until the pilot passes. [yes]
3. Sent depth: headers 30 days at connect, text and analysis 14 days; then incremental with each sync. [yes]
4. Which sent mail opens a loop: rule filters, then the LLM decides "expects a reply"; no "all external mail" mode. [yes]
5. Wait: 3 working days (Mon–Fri, no holidays), or the date the mail states; per-mailbox setting 1–10. [3; second pass after the E3a pilot report]
6. Follow-up: a line in the morning brief with Draft follow-up · Later · Done; the draft is a pl/en template quoting your mail, to its original To and Cc, in the thread; you see the rendered mail and tap Send; at most 2 follow-ups, then closed as stale after 14 days. Automatic drafts: a per-mailbox switch, off. [line + button; second pass after the E3a pilot report and the E2b live week]
7. Close rules: a later mail in the thread from anyone but you closes (header match, else subject from an original recipient within 30 days, shown as such); auto-replies never close; your own later mail restarts the wait; one tap reopens. [yes]
8. Promises: only yours, from Sent, only with a date or a time word that code resolves; tracked without a confirm step; Done · Drop; closed by your later mail to the same person, or 7 days after due. Others' promises: out of Stage 2. [yes; second pass after E3a numbers]
9. Eval gate before the pilot: sent-mail bank (250 holdout + 50 dev, pl 60 / en 40) with E2a tools; `expects_reply` recall ≥ 90%, precision ≥ 80%; promise precision ≥ 90%; due date exact ≥ 90%. [yes]
10. Manual delegation: a "Delegate" button on digest rows, urgent notices and panel rows, then a delegate picker and the existing draft and approval path; your own mail to an active delegate that asks for something is tracked as a delegation, with Untrack. [yes]
11. "Needs you today": the morning digest starts with Urgent · Waiting on you · Waiting on others · Promised (5 lines each, "+n in the panel"); later digests get one loop count line; no new instant notices. [yes]
12. Panel: the E4-A delegation page becomes "Open loops" with tabs Delegated · Waiting · Promised; every action is an API command. [yes]
13. M2 proposal for E3: surfaced on time (≥ 98%) and closed on time (≥ 90%). [yes]
14. Follow-ups obey the mode table (shadow: "would draft"), send limits, and the phishing flag. [yes]
15. Cross-epic edits (notes §6): the first planning session of each affected epic applies them; E5 edits no other page. [yes]
16. Commit the changed files by explicit path. [yes]

### Size and risks

Size: E5a about 7 stages, 1.3k lines; E5b about 22 stages, 4.5k lines; total about 29 stages, 5.8k lines (the page said 25 / 5k). Added: the sent-mail eval, the close rules and the answered marks. Saved: no LLM drafter for follow-ups.

| Risk | Mitigation |
| --- | --- |
| Reading Sent feels like a privacy step | Own switch, plain line at connect, read-only ADR, org flag off until the pilot passes |
| A mail app keeps no Sent copy | Setup check at connect; one "no sent mail seen in 7 days" notice |
| Too many loops (thanks, FYI) | Rule filters, precision gate, 5 lines per section, Drop in one tap |
| A false close hides a slip | Header match first; subject fallback only from an original recipient, labelled; reopen tap |
| Wrong follow-up recipient (M3) | Recipients only from your own Sent headers; the card spells them out |
| Injection through quoted text | Body untrusted; data-only LLM output; no LLM sentence in the template |
| Broken threads on IMAP | Subject fallback; E2 hard cases; the live week scores them |
| First brief floods after connect | Analysis only 14 days back; 5 lines per section |

Full risk list: notes §8. Planned tickets: F040 partly absorbed (any participant closes a Waiting loop; the alias list stays for E9); F027 must cover the new texts; nothing else absorbed (notes §7).

### Owner's answer (2026-11-13) and planned tickets

Owner: "You can go with defaults." Decision rows PD-115–PD-129 (decision n = PD-114+n; decision 16 is the commit). Waiting for the second pass: PD-119 (wait), PD-120 (automatic follow-up drafts), PD-122 (others' promises). Trigger: the first E3a weekly report on the pilot (due loops per day, median reply time, replies that only promise) and the E2b live week.

Inputs from the parallel sessions, applied here:
- E6 (PD-077, PD-080, PD-084): E6a's answered stage depends on E5a; ADR 0029 decision 7 allows one style-suggestion call on own sent text; the committer runs a Sent pass before every system send; the mail-client edit rule (PD-076) covers follow-up drafts.
- E9 (PD-085): F040 moves to E5b, built only if the E2b planted case shows the miss.
- E11 (PD-109, PD-113): the per-contact wait replaces the 3-day default when the contact has enough replies; E11a needs E5a's marks and sent times.

| Planned ticket | Effect |
| --- | --- |
| F040 delegate reply from another address | Absorbed by E5b (PD-085, PD-121): any participant closes a Waiting loop; the delegate alias list only if E2b shows the miss |
| F027 retention job | Not absorbed; it must cover E5a sent text (like `emails.body_text`) and loop `ask`/`promise` texts (90 days after close) |
| F042, F055 | Not absorbed |

Planning: two `plan-task` runs. E5a Read Sent (wave 1–2, after E1 and E7-T2 flags), then E5b Open loops (after E3a, E4-A, E5a; the eval bank needs E2a tools). `05` §2 graph edges: notes §6.
