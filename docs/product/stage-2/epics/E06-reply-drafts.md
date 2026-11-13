# E6 · Reply drafts and style

> Tier: Must. Status: decided, second pass after the E6a prototype (discovery 2026-11-13, PD-070–PD-084). Size: about 21 stages, 4.2k lines, two tickets (E6a Reply drafts, E6b Style from Sent, gated). Reuses the draft, approval and send path of delegations; the draft text itself is new (today drafts are templates). Detail: `E06-discovery-notes.md`.

## Outcome

Mail that needs a reply gets a draft in the thread, in the user's style, waiting for one tap. The user sends the draft as they edited it.

## Users

Executive.

## In scope

- `needs_reply` planner: a reply draft (quote the original, answer in the user's language, `style_text` as a writing style, one optional instruction line from the user such as "say yes for Tuesday").
- The draft goes to the Drafts folder and to the approvals page (E4) and the Telegram card; approval on the exact rendered mail; expiry after 48 h (Fyxer: 14 days; owner decides).
- Send the edited draft (F043): the sent text is what the user edited in the mail client or the panel.
- Reply from the receiving mailbox (product brief rule).
- Injection evals grow: mail text now shapes drafts to third parties.
- Later stage, gated by E2: style cold start from about 300 sent mails (Fyxer, Superkind) and draft-diff learning (PRD US-018). Only if the eval shows better drafts.

## Out of scope

Auto-send (never). Meeting replies with free slots (Stage 3). Two-way chat corrections ("change X to Y") beyond one instruction line (Stage 3).

## Dependencies

E2a (reply cases in the `needs_reply` holdout and the draft judge, PD-026), E4 (approvals page, style editor). Blocks E11. Second-pass trigger: the E2a draft judge exists and an E6 prototype ran on the `needs_reply` holdout.

## Open product questions

1. Draft for every `needs_reply` mail, or only when the user taps "draft" in the brief (cost and noise).
2. Draft expiry: 48 h like delegations, or longer.
3. Style source now: the style text only, or also the last 50 sent mails as examples in the prompt (cheap cold start).

## Risks

- Off-tone drafts cost trust (M3); start with "draft on tap" if E2 shows weak drafts.
- Drafts in the Drafts folder look like the user's own; the `X-EA-Action-Id` header and a prefix mark them.

## Exit

- On the simulated week: every planted `needs_reply` thread gets a draft; a scorer rubric rates tone and facts; the injection set passes.
- On the pilot mailbox: three real replies sent from drafts after edits.

## Discovery (2026-11-13)

Session: discovery queue row 6, Opus 5.5, code at `f63f41d`. Detail, sources and design input: [E06-discovery-notes.md](E06-discovery-notes.md). ADR draft: `docs/decisions/0033-reply-drafts-free-text-under-checks.md` (proposed). A parallel E6 session left independent input in `notes/2026-11-13-e06-parallel-discovery-input.md`; the notes merge it. E3 edits for E6 (PD-069) are applied here: no draft for phishing-flagged mail (PD-063), reply rejects count in M3 (PD-057), drafter calls count in M7 (PD-059).

### Verdict: modify

The outcome is right for the thesis ("drafts wait for one tap"), and every 2026 competitor ships it. The page underrates two things:
- **The draft text is new, not reused.** Today every draft is a fixed template; the LLM fills one-line fields. A reply is free LLM prose to a third party: it needs a drafter job, code checks, gaps instead of invented facts, and an ADR (0033).
- **The mail client is a main place to edit and send.** F043 ("send the edited draft") is replaced by a safety rule: the system never sends text read back from the mail client and never deletes a draft the user changed.
- Add: one open draft per thread (a newer mail supersedes), "already answered" from E3a flags and the E5a Sent mark, batched phone review, Reply all on tap, per-mailbox display name, signature and writing style. No subject prefix (the page's risk line): it would go out when the user sends from the mail client.
- Split: **E6a Reply drafts** (≈ 18 stages) and **E6b Style from Sent** (≈ 3 stages, gated). Draft-diff learning (US-018) leaves Stage 2.

### Code cross-check (summary; full table in the notes §1)

| Item | Exists today | New |
| --- | --- | --- |
| `needs_reply` planner | `planActions` returns `[]` (`core/triage/planners.ts:126`) | Eligibility rules, separate drafter job |
| Draft text | Templates (`core/outgoing/templates.ts`); one-line LLM fields through `markUntrustedText`; writer role unused | Free prose, gaps, body checks (ADR 0033) |
| Payload, quote | Kinds `delegation`, `clarification`, `reminder`; one recipient; forward-style quote | Kind `reply` (version, `cc`); reply-style quote |
| Approval | Drafts APPEND, Telegram card, 48 h for all kinds; E4-A page and versions (PD-031) | Reply kind, 7 days, batched review, Redraft |
| Mail-client edits (F043) | Send uses DB text; no look at the Drafts copy before SMTP; expiry and reject delete the copy | Hash check before every send; remove unchanged copies only |
| Style and name | `organizations.style_text` = signature only; `From` name = org owner for every mailbox | Per mailbox: display name, signature, writing style |
| Already answered | Nothing (sync never reads Sent) | Read E3a `\Answered` (PD-068) and the E5a mark (draft ADR 0029) |
| Stop headers | `isNoreplyAddress`; E3a captures `Reply-To`, `List-Unsubscribe` | E3a also captures `Auto-Submitted`, `List-Id`, `Precedence`, `text/calendar` |

### Cross-epic notes (edits for the owner; detail in the notes §5)

- E2a: reply facts (`expected_points`, `must_not`) in the `needs_reply` holdout; reply rubric items; reply injection set.
- E3a: three more headers and a calendar marker; a draft outcome line in the weekly report.
- E4-A: approvals page kind `reply`; "✍️ Draft reply" on rows and notices. E4-B: "Show 3 sample drafts" in the report; reply drafts in "Turn on recommended" only after the E6 exit bar.
- E5: E6a needs E5a; draft ADR 0029 decision 7 gets one amendment (own sent text to the LLM once, for E6b). E5 follow-ups stay templates.
- E7: flag `reply_drafts`; DSR map, delete and export cover the new fields; send limits count replies. E8: four log events. E9: reply drafts in the thread (Graph `createReply`, Gmail `threadId`); notices follow draft ADR 0032 detail levels. E11: contact context later.
- Gap seen: a mailbox has no owning user; approvals go to every org owner. Default: per-mailbox style now; the mailbox → user link with the EA flow or E7.

### Research facts (sources and dates in the notes §2)

- Superhuman Auto Drafts 2.0 (2026-07-14) and Fyxer (2026-10-20) draft every reply-needed mail by themselves; Fyxer deletes unused drafts after 14 days (vendor).
- Fyxer writes an editable style description from recent sent mail (vendor). Few-shot style imitation works only partly (Findings of EMNLP 2025; PersonalBench 2026-08-20).
- EchoLeak (2025) and CVE-2026-55145 (2026-07-14): a mail made Copilot put other inbox data into a reply draft. Our drafter sees only the thread, the style and the user's instruction.
- Practice guides (2026) leave visible blanks for facts and block the send until they are filled: our gaps rule.
- Gmail Suggested Replies are free since 2026-01-08: the draft alone is not the differentiator.

### Decisions (owner: "Okay, go with defaults." → PD-070–PD-084)

1. Verdict "modify": split E6a / E6b (gated); draft-diff learning out of Stage 2; F043 replaced (decision 7). [accept]
2. When: an automatic draft for every `needs_reply` mail in assist mode with the switch on, if every code rule passes (person sender, not list, auto-reply, own mail, phishing-flagged, calendar invite or answered; pl or en; under 80% of the LLM day cap). "✍️ Draft reply" on tap for any mail. One open draft per thread; a newer mail supersedes it. Shadow: no drafts, only "Show 3 sample drafts" in the report. [automatic; second pass]
3. Drafter: a separate job; context = the mail and its quoted history, the mailbox's writing style, signature and name, the instruction; no other mail, file, calendar, web or contact. Model `gpt-6-luna`. [yes; model second pass]
4. Facts and checks: gaps `[[…]]` instead of invented facts, or `no_draft`. A version with a gap cannot be approved. Code checks: no address, link, phone or account number unless the user typed it; ≤ 2,000 characters; no blank-line runs or header-like lines; language match. One retry, then `draft_failed`. [yes]
5. Surface: Drafts folder in the thread, no prefix; no Telegram card per draft; "📝 N replies ready" at most every 2 h, outside quiet hours, then one-at-a-time review (Send · Reject · Redraft · Skip · Reply all); panel reply group. [yes]
6. Lifetime: 7 days; earlier end when answered, superseded or the original leaves INBOX. Other draft kinds keep 48 h. [7 days]
7. Mail-client edits (replaces F043): never send text read back, never delete a changed draft; before every system send the copy must match the approved hash, else `draft_changed` ("send it from your mail client"); missing and answered = `sent_by_user`. [yes]
8. Already answered: read the E3a `\Answered` flag and the E5a mark; one Sent pass right before a system send; no E6-own Sent read. [yes]
9. Recipients: `From` by default; "Reply all" and "Use Reply-To" are taps that make a new version; never a recipient from text. [yes]
10. Style per mailbox: display name, signature, writing style (≤ 1,000 characters, guided form, preview on a sample mail); migration copies the org style text into each signature. [yes]
11. E6b: "Suggest my style from my sent mail" from the sent text E5a stores, user edits and saves; ships only if the judge shows a tone gain. No sent mails as examples in prompts. [yes]
12. Instruction line: panel field and Telegram reply text, ≤ 300 characters, ≤ 5 redrafts per mail; a redraft is a new version and needs a new tap. [yes]
13. Consent: per-mailbox switch `reply_drafts` (off by default, apart from delegation drafts) and the org flag `reply_drafts` (PD-045). [yes]
14. Exit bar: code checks 100%; 0 invented commitments past the gap check; ≥ 80% "send as is or small edit"; reply injection set 100%; the owner checks 20 drafts against the judge; pilot: three real replies sent from drafts after edits, by tap or from the mail client. [yes; second pass]
15. Cross-epic edits (notes §5) go in through each epic's own session or first planning session; this session edits no other epic page. [yes]
16. Commit the changed files by explicit path. [yes]

Second pass (trigger: the E2a draft judge exists and the E6a stage-1 prototype ran on the `needs_reply` holdout): decisions 2, 3 (model) and 14. Numbers that change them: notes §4.

### Size and risks

Size: about 21 stages, 4.2k lines (E6a ≈ 18 / 3.7k, E6b ≈ 3 / 0.5k), up from 14 / 2.5k. Stage 1 of E6a is the prototype for the second pass. Dependencies added: E3a (headers, flags), E5a (answered mark), E7 flags; E2a and E4-A as before.

| Risk | Mitigation |
| --- | --- |
| Invented fact or promise goes out | Gaps block approval; judge item; full text on card and page |
| Injection shapes a draft | Narrow context; fixed recipient; body checks; phishing flag; reply injection set |
| System sends or deletes a user-edited draft | Hash check before send; remove unchanged copies only |
| Double reply (answered from the phone, then a tap) | Sent pass and answered check before the send |
| Telegram noise, Drafts clutter | Batched review, quiet hours; one draft per thread, 7 days |
| Drafts starve triage | Automatic drafts stop at 80% of the day cap |
| Interia ignores `\Answered` or draft threading | Stage 1 pilot check; the E5a mark covers it |
| One tester | Pilot exit by both routes; E2b live week |

### Owner's answer (2026-11-13) and planned tickets

Owner: "Okay, go with defaults." Decision rows PD-070–PD-084 (decision 16, the commit, has no row).

| Planned ticket | Effect |
| --- | --- |
| F043 send draft edits | Replaced by PD-076 (mail-client edits win; no read-back). Close as "replaced by E6" in the next board sweep |
| F075 content-minimal Telegram | Not absorbed; reply notices follow ADR 0032 (E9) |
| F039 approval edit in place | Not absorbed; E4-A owns it (PD-029) |

Next: the second pass after the E6a stage-1 prototype on the `needs_reply` holdout with the E2a judge (decisions 2, 3, 14). The other decisions are ready for `plan-task`; planning waits for the discovery queue (PD-012) and for E2a, E3a, E4-A and E5a in wave order.
