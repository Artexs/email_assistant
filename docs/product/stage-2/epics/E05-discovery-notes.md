# E5 Open loops: discovery notes (2026-11-13)

> Detail for the "Discovery" section of `E05-open-loops.md`. Written by the E5 discovery session (Opus 5.5). The next agent has no chat history: everything the decisions rest on is here.
> State of the other sessions at the time of writing: E3 was decided during this session (PD-056–PD-069, consistent with this design); E6, E9, E10 and E11 were `in session` in parallel.

## 1. Code cross-check (what exists today)

| Item | Exists today (file) | Partly there | New |
| --- | --- | --- | --- |
| Sent folder known | `mail/connect.ts:39` maps special-use `\Sent` to key `sent`; `mail/check.ts:94` finds it; Interia `Wysłane` is marked `\Sent` by imapflow without SPECIAL-USE (`notes/2026-11-03-interia-imap-capabilities.md`) | The path is stored per mailbox | — |
| Reading Sent | Never: architecture §4.1 rule 1 and the sync rules ("Never `AI/*`, Sent, Drafts, Trash or a user folder", `docs/architecture.md` §5). The committer only APPENDs its own copy and locates by identity (`actions/committer.ts`, `mail/locate.ts`) | Locate-by-identity reads Sent already, for one message, for recovery | Read-only Sent sync: own cursor, headers and text, never a change to Sent (ADR 0029 draft) |
| Own sends in Sent | Every system draft and send carries `X-EA-Action-Id`; the sync already fetches that header (`mail/imap/client.ts:53`) and skips own mail in synced folders | — | Sent sync links a Sent message with `X-EA-Action-Id` to its action and delegation; it never opens a loop for it |
| Threading | `emails.thread_key`, `in_reply_to`, `references_header`; `threadKey()` = first `References` id, else `In-Reply-To`, else `Message-ID` (`mail/sync-rules.ts:32`) | Works for incoming mail only | Same function for sent mail; a subject fallback for broken threads (§4) |
| Reply detection | `delegation/service.ts:138` `detectReply`: an incoming mail whose `In-Reply-To`/`References` hold the sent mail's id **and** whose `From` is the delegate; called inside the triage transaction (`triage/service.ts:223`) | Only for delegations; only the delegate's address (F040 is the gap) | A loop match for any participant except the user; auto-reply and bounce filter |
| Follow-up engine | Delegation chaser: 07:30 local, gap 3 days, at most 2 reminders, approval sets of up to 10 (`delegation/chaser.ts`); reminder body is a **template**, not LLM text (`packages/core/src/outgoing/templates.ts`) | Reusable for delegations as is | Follow-up template kind `follow_up` (pl, en) that quotes the user's own mail; recipients from the Sent headers |
| Approval and send | `actions/approvals.ts`, committer, outbox `approval` card, `send_result`; edit as a new version comes in E4-A (PD-031); send limits in E7-T2 (PD-044) | All built for delegation drafts | Only a new draft kind; no new send path |
| Manual delegation | — Delegations start only from triage (`triage/service.ts` `createDelegationRow`). Telegram commands are `help`, `digest`, `status`, `pause`, `resume` (`channels/port.ts:31`) | Delegate list, delegation draft path | "Delegate" button on digest rows, urgent notices and panel rows; delegate picker; a command on the E4 contract |
| Hand forward to a delegate | — | — | Sent sync: a sent mail to an active delegate that asks for something becomes a tracked delegation (source `manual`) |
| Commitments | — | — | LLM output on the user's own sent mail; checked date; loop rows |
| Morning brief | Digest per slot: `reports/digest.ts` `buildDigestMessage`, `core/digest/digest.ts` `renderDigest` (sorted by category, 4096-char cut); footer `👥 Delegations: <n> waiting for a reply, <m> overdue` | Delegation counts only | Loop sections first in the first digest of the day |
| Loop page | E4-A builds `/delegations` (dashboard, remind now, mark done, cancel) | Planned, not built | Tabs Delegated · Waiting · Promised on the same page |
| M2 data | `delegations` rows (`due_at`, `answered_at`, `reminders_sent`) | Delegations only | Loop rows with `due_at`, `surfaced_at`, `closed_at`, close reason |
| Feature flags, DSR map, org delete | Planned in E7-T2 (PD-045) and E7-T3 (PD-038) | — | New tables join the DSR address map and the org-delete test |

Page corrections:
- "the same engine as delegation tracking and the chaser": true for the schedule, the approval and the send. The **body is a template** today, so a follow-up draft needs no LLM text and no E6 drafter. E6 may later replace the template if its judge shows a gain.
- "Manual delegation … from a Telegram command": a free-text Telegram command needs a mail reference that a chat command does not have. Use a button on the mail's digest row or notice instead.
- "the user confirms or drops each one" (commitments): the owner's rule (PD-030, "we can't rely on users to confirm any values") applies by analogy. Track automatically, let the user drop; no confirm step.

## 2. Validation

The outcome is right and it is the thesis: "nothing slips" (`03` §2, job 1) is mostly this epic plus urgent notices. The market input calls the open-loop engine one product (`04` §3: Slashy, Duly, Chiefly). Keep the outcome.

Scope changes:
1. **Split.** The Sent sync is a foundation for four epics, not only E5:
   - E4-B history check (ADR 0028): "important to you = the user answered it". It depends on `\Answered`, which E3 stage 1 must still prove on Interia. A reply in Sent is provider-independent.
   - E3a M1 on real mail: "`\Answered` mail not marked `needs_reply`" (E3 decision 3) gets the same, better signal.
   - E6: a reply draft is stale when the user already answered in their own client; style examples from the last sent mails (E6 question 3).
   - E5b: waiting-for-reply, hand forwards, promises.
   So **E5a Read Sent** is a small ticket that can land in wave 1–2 (needs E1 and the E7-T2 flags); **E5b Open loops** keeps the product features and waits for E3a, E4-A and E2a.
2. **Commitments narrow** to the executive's own promises with a date. Others' promises ("vendor said Tuesday") wait (research §3: accuracy is the main complaint of Viva users; Lampert et al. list why requests and commitments are hard).
3. **Add**: close rules (what ends a loop), "Later" on a loop line, "waiting on you" closes when Sent shows a reply, an eval set for sent mail, and the M2 split (surfaced vs closed).
4. **Keep out**: snooze of incoming mail (only loop lines get "Later"), calendar items, others' promises, a per-contact wait (E11).

## 3. Research (read 2026-11-13; vendor pages are marketing)

| Fact | Source, date | Use |
| --- | --- | --- |
| Inbox Zero "Reply Zero": labels `To Reply` and `Awaiting Reply`; follow-up reminders with both thresholds at 3 days by default; Saturday and Sunday do not count; optional auto-generated nudge drafts; the label goes when a reply arrives or the user sends one; reminders can go to Telegram with "Mark done" | docs.getinboxzero.com/essentials/reply-zero (vendor docs, 2026) | Default wait 3 working days; close on a reply or own send; draft is optional |
| Superhuman Auto Reminders: "all messages that need a follow-up" (AI reads the latest outgoing message) or "all messages with an external recipient", or off; weekdays-only option; a follow-up Auto Draft appears about 1 h before the reminder returns; drafts never send by themselves; follow-up drafts only on Business and Enterprise plans | help.superhuman.com "Auto Reminders & Auto Drafts" (vendor, read 2026-11-13); Superhuman update 2025-04-12 | AI "expects a reply" detection is the market default; the draft comes at the reminder, not at send time |
| Gmail nudges: "Sent 5 days ago. Follow up?"; Gmail picks which mails and when; no view of everything outstanding | Google Workspace Updates 2018-05-14; Kanmail blog 2026-11-06 | The gap: a list of all open loops with dates is a differentiator |
| Microsoft Viva Briefing email (2020–2023): "commitments, requests and follow-ups" in both directions, once per workday; Microsoft paused it on 2023-01-15 "to make improvements" | learn.microsoft.com Viva Briefing overview and FAQ; Microsoft Tech Community 2023-04-13 | A daily brief of loops is proven; both-direction extraction did not stay |
| CSCW 2024 study of the Viva briefing (Morrison, Iqbal, Horvitz): the main value is "an extra reminder of forgotten tasks"; users did not value inaccurate or out-of-date reminders; people forget low-priority, ad hoc and small tasks; they want quick actions in place (reply, schedule), and did not understand the Done / Remind me buttons | Proc. ACM HCI 8 CSCW1 art. 210, 2024 (arXiv 2403.01365) | Precision over coverage for promises; clear buttons with words; "Later" is wanted |
| Requests and commitments in email are hard to identify: conditional, implicit, reported speech, group requests | Lampert, Dale, Paris, ALTA 2008 (U08-1009) | Narrow the promise scope; eval gate before the pilot sees it |
| Interia: SMTP saves no copy in `Wysłane`; the webmail and IMAP clients do; a FETCH returns `X-` headers, `SEARCH HEADER` does not | `notes/2026-11-03-interia-imap-capabilities.md`, `notes/2026-11-07-send-approval-facts.md` | Mail sent from a client that keeps no Sent copy is invisible: a setup check and a "no sent mail seen in 7 days" notice |

## 4. The design (defaults for `plan-task`; product level, not a file plan)

### 4.1 E5a Read Sent (foundation)

- One more folder pass per sync run: the mailbox's `\Sent` folder, its own cursor (`UIDVALIDITY` + last UID) like ADR 0014 folders. Read-only: `BODY.PEEK`, no flag change, no move, no APPEND (the committer's existing copy step is not part of this sync).
- Stored per sent message: `Message-ID`, `In-Reply-To`, `References`, thread key (same `threadKey()`), `To`, `Cc` (no `Bcc` kept), subject, sent time (`Date`, else INTERNALDATE), `X-EA-Action-Id`, auto-submitted and list markers, the text for analysis (same retention as `emails.body_text`, F027). Its own table: sent mail never enters triage, the digest, moves or Undo.
- A message with `X-EA-Action-Id` of this mailbox links to its action (a system send); no analysis.
- Marks on incoming mail: when a sent message answers a stored incoming mail (header match), that mail gets "answered by the user" with the time. This is the signal for the E4-B history check, E3a M1, E6 stale drafts and the "waiting on you" section.
- At connect: headers of the last 30 days (history check, threading); text and analysis only for the last 14 days. Then incremental with each sync run (every 2 min after E3a).
- Switch: per mailbox "Track my sent mail". New mailboxes: on, with one line in the connect flow ("The assistant reads Sent, never changes it, to see what you wait for"). Existing mailboxes: off until the owner turns it on. All of it behind the org flag `sent_sync` (PD-045), default off until the pilot passes.
- Privacy: recipients of sent mail are third-party personal data: the new columns join the DSR address map (E7-T3) and the org-delete test, whichever ticket lands second adds them. Logs: ids and counts only. The LLM sees sent text only in E5b, under the same data rules as incoming mail (ADR 0012); no new sub-processor.
- Health: a mailbox with the switch on and no sent mail seen for 7 days gets one notice ("No sent mail seen: does your mail app keep a copy in Sent?").

Size: about 7 stages, 1.3k lines (migration, folder pass, cursor, link to actions, answered marks, connect line and switch, DSR and delete test, docs).

### 4.2 E5b Open loops

**Loop kinds.** One user-facing concept, "open loop", three kinds: Delegated (existing `delegations`), Waiting (the user's sent mail that expects a reply), Promised (the user's own promise with a date). Waiting and Promised share one new table; the brief, the page and M2 read all three.

**Sent analysis (one LLM call per sent mail in the window).** Rule filters first, no LLM: only own addresses as recipients, system sends, `List-Id`/bulk recipients, `Auto-Submitted` other than `no`, calendar replies (`text/calendar` `METHOD:REPLY`), more than 10 recipients. Then the cheap model returns data only: `expects_reply` (yes/no), `ask` (≤ 80 chars, the user's own words, shown in the brief like today's digest summaries), `due` (a date the mail states, or none), `promise` (≤ 80 chars or none) with `promise_due`, `language`. Code checks: due dates within 60 days in the future, else dropped; time words (today, tomorrow, Friday, end of week) resolved by code in the org time zone, not by the LLM. The whole body is untrusted text (quoted third-party text is inside it).

**Delegated by hand.** A sent mail whose recipients include an active delegate and whose analysis says `expects_reply` becomes a delegation with source `manual` (shown in the dashboard, chased by the existing chaser, "Untrack" to drop). Otherwise it is a Waiting loop.

**Manual delegation from the system.** A "👥 Delegate" button on each digest row and urgent notice, and a "Delegate" action on panel mail rows: pick one of the active delegates (Telegram: up to 8 buttons; the panel: a select) → the existing delegation draft path with the delegate fixed by the user (task summary from the LLM, recipient from the `delegates` row) → the approval card. A command on the E4 contract (ADR 0023).

**Wait and due.** Due = the stated date, else sent time + 3 working days (Monday–Friday in the org time zone; no holiday calendar in Stage 2). Per-mailbox setting 1–10 working days. Per contact later (E11).

**Close rules.**
- A later incoming mail in the thread from anyone except the user's own addresses closes a Waiting loop (`replied`). Header match first; fallback: the same normalized subject (without `Re:`, `Odp:`, `Fwd:`, `PD:`) from one of the original recipients within 30 days (`replied_subject`, shown as "matched by subject"). This covers F040's gap for Waiting loops.
- Auto-replies, out-of-office and bounces never close (`Auto-Submitted`, `X-Autoreply`, `Precedence: auto_reply`, DSN content type); an out-of-office moves nothing and the brief shows "auto-reply only".
- A later sent mail by the user in the thread restarts the wait from that mail (the user followed up by hand).
- Taps: Done, Drop, Later (+3 working days, at most 3 times).
- After 2 follow-ups and 14 more days with no answer: closed as `stale`, one last brief line.
- A Promised loop closes by tap, or when the user sends a later mail in the same thread to the promisee (`later_reply`, visible in the panel, one tap reopens), or 7 days after its due date (`expired`).

**Follow-up.** On the due date the loop shows in the morning brief: "⏳ No answer from Anna Nowak since Tue 10.11 · Offer for Q1 · [📝 Draft follow-up] [⏰ Later] [✓ Done]". "Draft follow-up" creates a draft (kind `follow_up`): a template in the language of the original, "I am coming back to my message of <date> about <subject>. Could you let me know …", the quote of the user's own sent mail, the signature; To and Cc = the original's To and Cc (from the Sent headers, never from LLM text); from the same mailbox; `In-Reply-To` = the sent mail. The approval card shows the exact rendered mail; the second tap sends (PD-031 rules for edit). At most 2 follow-ups per loop, 3 working days apart. Automatic drafting (no first tap) is a per-mailbox switch, off by default (second pass, §5).
- Mode table: a follow-up send follows the existing send row (shadow: log only, the brief says "would draft a follow-up"; assist and auto: approval). Send limits apply (PD-044). No follow-up for a thread with a phishing flag (E3b).

**"Needs you today" brief.** The first scheduled digest of the day (morning) gets the loop sections on top, in this order: 🔴 Urgent · ✍️ Waiting on you (`needs_reply` mail with no answer in Sent, oldest first) · ⏳ Waiting on others (due today or overdue, oldest first; delegations and Waiting loops together) · 🤝 Promised (due today or overdue) · then today's digest form (handled summary). Later digests of the day keep today's form plus one line "Open loops: 3 waiting, 1 promise due". Each section shows at most 5 lines and "+n more in the panel". No new instant notices from loops; quiet hours (E4-B) hold. The mail channel (ADR 0022) renders the same brief.

**Panel.** E4-A's `/delegations` page becomes "Open loops" with tabs Delegated · Waiting · Promised; each row shows the reason line (why it is a loop, for example "you asked a question; no answer for 4 working days"), due date, and Draft follow-up · Later · Done · Drop. The mailbox settings card shows the Sent switch, the wait and the auto-draft switch.

**Eval (before the pilot sees it).** A sent-mail bank built with the E2a generator and runner (label-first, PD-014): 250 holdout + 50 dev, 60% Polish / 40% English, planted labels `expects_reply`, `promise`, `due`; hard cases: thank-you-only, FYI to a team, a question inside a forward, a conditional promise ("if they agree, I'll send it Monday"), reported speech, "let me know if…", an out-of-office answer, a reply on another thread subject. Gate (Wilson 95% lower bound, PD-024 style): `expects_reply` recall ≥ 90% and precision ≥ 80%; `promise` precision ≥ 90% (recall is reported, not gated); `due` exact on ≥ 90% of cases that have one. The E2b live week scores planted dropped threads (E2 notes §3: "their score starts in E5").

Size: about 22 stages, 4.5k lines (sent analysis and its eval set, loop table and close rules, follow-up template and drafts, manual delegation command and buttons, hand forwards, brief, loop page tabs, settings, M2 rows, docs, pilot run).

## 5. Questions that wait (second pass)

| Question | Default now | Trigger | What changes the default |
| --- | --- | --- | --- |
| Automatic follow-up drafts | Off: a line plus "Draft follow-up" | E3a weekly report on the pilot (due loops per day) and the E2b live week | If ≤ 3 due Waiting loops per day on the pilot and the follow-up template passes the E2a draft judge, turn the auto draft on by default (one tap to send) |
| Others' promises ("vendor said Tuesday") | Out of Stage 2 | E3a numbers (how many Waiting loops close with only a promise) and the E5b eval of `promise` | If ≥ 20% of replies in Waiting threads are only a promise, add "keeps the loop open until <date>" for replies in tracked threads only |
| Wait 3 working days | 3 | E3a M2 on the pilot (median reply time of answered loops) | If the median answer comes after day 3, set 4–5 |

## 5a. M2 (proposal for E3)

E3 owns the metric definitions (E3 notes §2). E5 delivers the rows; they plug into the E3a metric module (PD-056), which the E2b week scorer also calls. Until E5a lands, the E3a IMAP flags (`\Answered`, PD-068) are the cheap "you replied" signal (applies the E3 note for E5, PD-069). Proposal: two numbers on the weekly report.
- **M2-surfaced** (the system's job): share of loops due in the week that appeared in the brief (or got a follow-up draft) on or before the due day. Target ≥ 98%. The E5 exit "every planted dropped thread appears in the brief within the set wait" is this number on the sim.
- **M2-closed** (the outcome, the `03` §5 M2): share of loops due in the week that got an answer, a follow-up sent, or a Done before the due day + 1 working day. Target ≥ 90%. It depends on the user's taps, so the report shows both.

## 6. Cross-epic notes (edits for the owner or the first planning session of each epic)

| Page | Edit |
| --- | --- |
| E3 (decided, PD-056–PD-069) | M2 has two numbers (§5a). M1 real-mail signal (PD-058): "answered by the user" from E5a joins `\Answered` (provider-independent). E3a still stores the IMAP flags (PD-068); if Interia does not set `\Answered`, E5a's mark replaces it. PD-063 already blocks follow-up drafts for phishing-flagged mail |
| E4 | E4-B history check: "important to you = answered" reads the E5a mark when E5a has landed, else `\Answered`. The `/delegations` page should be built so E5b can add tabs (row component per loop kind, filters by kind). The "Delegate" command is new in E5b on the E4 contract |
| E6 (in session in parallel) | Reuse ADR 0029 for any read of Sent (style examples); do not write a second ADR. A reply draft expires when E5a marks the mail "answered by the user". The "waiting on you" brief section lists `needs_reply` mail: E6's draft button can sit on the same line. E6 may replace the `follow_up` template with an LLM draft if the E2a judge shows a gain |
| E7 | E7-T2 flag `sent_sync` and `open_loops`; E7-T3 DSR map gets the sent-mail and loop columns (to, cc, ask, promise); org delete covers the new tables; papers (T4: records of processing, DPIA) name "sent mail headers and text" as processed data |
| E8 | One more SLO input is not needed; the sync-lag alert covers the Sent pass because it is part of the same run |
| E9 | Graph and Gmail adapters must list the Sent folder (Gmail `[Gmail]/Sent Mail` label) and return the same header fields; the Sent pass is part of the `MailProvider` port |
| E11 (decided, PD-104–PD-114) | Per-contact wait (PD-109) replaces the 3-day default when the contact has ≥ 5 replies in 90 days; E5a keeps sent times and answered marks so E11a computes reply delays; contacts read "answered by the user" and sent counts; thread summaries build on the loop thread keys |
| E2 | The sent-mail bank (§4.2 Eval) is E5b's work with E2a tools, not an E2a deliverable; E2b's scripted executive sends mail from the executive mailbox and APPENDs a Sent copy (the GreenMail SMTP does not save one), so E5a can read it |
| `05` §2 graph | `E1 → E5a`, `E7(T2 flags) → E5a`, `E5a → E4-B (optional)`, `E5a → E6`; `E3 → E5b`, `E4 → E5b`, `E5a → E5b` |
| `docs/architecture.md` §4.1 rule 1 and §5 sync rules | "never reads Sent" becomes "reads Sent read-only (ADR 0029), never changes it"; applied when E5a lands |

## 7. Planned tickets

| Ticket | Effect |
| --- | --- |
| F040 delegation reply from another address | Absorbed by E5b (E9 moved it here, PD-085): the close rule accepts a reply from any participant for Waiting loops; the per-delegate alias list is built only if the E2b planted case shows the miss |
| F027 retention job | Not absorbed. E5a's sent text and E5b's `ask`/`promise` texts must be in its table: sent text like `emails.body_text`; loop texts 90 days after close like `delegations.task_summary` |
| F042 handled share for delegations | Not absorbed (E3) |
| F055 live updates | Not absorbed |

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Reading Sent feels like a privacy step | Own switch per mailbox with a plain line; read-only by design (ADR 0029); org flag off until the pilot passes; records of processing name it |
| A mail app keeps no Sent copy (Interia SMTP saves none; some phone clients) | Setup check at connect (Sent seen in the last 30 days?) and the 7-day "no sent mail seen" notice |
| Too many loops: every "thanks" and FYI becomes a line | Rule filters, the `expects_reply` precision gate ≥ 80%, at most 5 lines per section, Drop in one tap; the second pass sets auto drafting only if volume is low |
| A false close (a slip: the loop closes on an unrelated reply) | Header match first; subject fallback only from an original recipient within 30 days, shown as "matched by subject"; auto-replies never close; one tap reopens |
| Wrong recipient on a follow-up (M3) | Recipients only from the user's own Sent headers; the approval card spells them out; no LLM text in the recipient or the body except the quoted user mail |
| Injection through quoted text in the user's own sent mail | Whole body treated as untrusted; the LLM returns data only; the template holds no LLM sentence; the sent-mail bank has injection cases |
| Broken threads at IMAP providers (roadmap risk 2) | Subject fallback; E2 hard cases (forwarded and broken threads); the live week scores them |
| The first brief floods with old loops after connect | Analysis only for the last 14 days; at most 5 lines per section |
| Mailbox with several users (shared) | Loops belong to the mailbox, like the digest today; Stage 3 EA flow decides per-user loops |
| Load: one more folder per run every 2 min | Sent is one cursor fetch of new UIDs; usually empty; E8 load test covers it |
