# E6 discovery: input from a parallel session (2026-11-13)

> Not the E6 discovery record. A second session ran E6 discovery at the same time as the session that owns `docs/product/stage-2/epics/E06-reply-drafts.md` § Discovery. This file keeps its independent findings as input for the owner's answers. Section numbers here do not match the epic page.

## 1. Code cross-check (full table)

| Item | Exists today | Partly | New in E6 |
| --- | --- | --- | --- |
| Draft → approval → send path | `create_draft` + `send` pair, committer APPENDs to Drafts, SMTP send, Sent copy, draft removal after send, reject or expiry (`apps/server/src/modules/actions/drafts.ts`, `send.ts`, `approvals.ts`, `expiry.ts`; architecture §4.5) | — | Reused as is |
| Draft payload kinds | `delegation`, `clarification`, `reminder` (`packages/core/src/triage/payloads.ts`); exactly one recipient (`recipientSchema` length 1) | — | Kind `reply`: body text, gaps, `to` plus optional `cc` for reply all, version number |
| Outgoing message builder | `buildOutgoingMessage`: `Re:` subject, `In-Reply-To` and `References` from the original, quote, `X-EA-Action-Id`, `Message-ID` from the action id (`packages/core/src/outgoing/message.ts`, `quote.ts`) | Body is a fixed template with one LLM line (`templates.ts`) | Reply body from the drafter, multi-line, after the code checks; quote under it |
| Writer LLM role | Config keys `OPENAI_MODEL`, `GEMINI_MODEL` exist; architecture §6.3: "The writer role is not used in S4: drafts are templates" | `platform/llm/client.ts` has only `classify` (structured output) | A drafter call on the same structured-output path (output: body, gaps, language) |
| `needs_reply` planner | `planActions` returns `[]` for `needs_reply` (`packages/core/src/triage/planners.ts`) | — | Plan "compose reply" when the eligibility rules pass; the drafter job fills the draft |
| Untrusted text rules | `markUntrustedText` for one-line fields (task, question): addresses, links, numbers replaced, line breaks removed (`untrusted-text.ts`) | Built for one line, not for a body | Body checks (§2.4) |
| Eligibility signals | `isNoreplyAddress` (`triage/rules.ts`), junk source (`PlanSource.fromJunk`), own-mail check | Sync fetches no `Auto-Submitted`, `List-Id`, `Precedence` and no flags (`mail/sync.ts`) | Needs E3a header capture plus three headers and the `\Answered` re-check |
| Phishing flag | — | — | E3b builds it; E6 reads it (no draft for flagged mail) |
| Approval time limit | One `APPROVAL_TTL_MS` = 48 h for every kind (`actions/constants.ts`) | — | Time limit per kind: reply 7 days |
| Thread data | `emails.thread_key`, `to_addresses`, `cc_addresses`, `in_reply_to`, `references_header` (`platform/db/schema.ts`) | — | Reused for reply all and for "a newer mail in the thread replaces the draft" |
| Telegram approval card | `renderApprovalRequest` (`packages/core/src/digest/approvals.ts`), 📤 Send / ✖️ Reject, reminder sets | No reply-to-message handling in `modules/channels/` | Reply card (gaps shown, Redraft, Reply all), "replies ready" notice, one-at-a-time review, "✍️ Draft reply" on urgent notices, reply text as the instruction line |
| Panel approvals page | — | E4-A builds it (PD-031: edit as a new version) | Reply kind view, instruction field, "Draft a reply" on activity rows |
| Style text | `organizations.style_text` (≤ 1000 chars), edited in `apps/web/src/components/settings/SignatureCard.tsx` | Used only as the signature (`message.ts:78`) | Per mailbox: signature, writing style, sender display name; style card with a preview |
| Sender name | `from.name` = the organization owner's display name for every mailbox (`message.ts`) | Wrong for an organization with two executives | Display name per mailbox |
| Reply from the receiving mailbox | `from.address` = the mailbox that received the mail (`message.ts`) | — | Reused (product brief rule holds) |
| Read back an edited draft (F043) | `locateMessage` finds known mail without a header search (`mail/locate.ts`; Interia has no working `SEARCH HEADER`, `notes/2026-11-03-interia-imap-capabilities.md`) | Finds by identity, does not read the body | Read the Drafts copy before a send; compare with the shown version |
| Evals | `evals/cases/delegation.json` (12), `injection.json` (16): draft kind and recipient checks only | — | Reply cases in the E2a holdout, reply rubric in the E2a judge, reply injection cases |
| Feature flag, send limits | — | E7 (PD-044, PD-045) | Flag `reply_drafts`, default off; replies count in the send limits |

## 2. The product shape (defaults)

### 2.1 Which mail gets a draft

Automatic, only in `assist` mode and only when every rule passes (code, not LLM):
- category `needs_reply`, from INBOX or a synced folder, not from the junk folder;
- the sender is a person: not a no-reply address, no `List-Id`, no `Auto-Submitted` other than `no`, no `Precedence: bulk/list/junk`, not one of the organization's own mailboxes;
- no phishing flag (E3b);
- not answered already (`\Answered` not set at triage time);
- language `pl`, `en` or `de` (E2 has German hard cases, PD-016, PD-028); any other language: on tap only;
- not a calendar invite (`text/calendar` part): the user answers those in the mail client;
- the automatic share of the LLM daily cap is not used up (automatic drafts stop at 80 % of `LLM_DAILY_CAP`; triage keeps the rest; drafts on tap use the full cap).

On tap: any stored mail of an active mailbox ("✍️ Draft reply" on an urgent notice, "Draft a reply" on an activity row in the panel). The same checks apply except the category and the language rule; a flagged mail still gets no draft.

Only the newest mail of a thread has an open reply draft. A newer mail in the thread (`thread_key`) closes the old draft with reason `superseded` and, if eligible, plans a new one.

### 2.2 Drafter input and output

Input, and nothing else: the incoming mail (subject, sender, date, body with its quoted history, inside the marked data block), the mailbox's writing style, signature and display name, the user's instruction line (when given), the target language. No other mail, no file, no calendar, no web, no contacts (E11 adds contact context later, eval-gated).

Reason: the injection attack class "put internal data into the reply draft" (CVE-2026-55145, §3) needs internal data in the drafter's context. With only the incoming mail and the user's own style text, the drafter has nothing to leak except what the sender already sent.

Output (structured, Zod-checked): `body` (text), `gaps` (list of short labels), `language`. Rubric for the prompt: answer every question in the mail in order; mirror the sender's form of address (Polish `Pan/Pani` or first name, English first name or title); keep it short unless the mail is long; never promise, accept, refuse, confirm a date, amount, price or deadline that the instruction line or the mail itself does not give; write a gap instead.

### 2.3 Gaps (the facts gate)

The drafter marks each missing decision or fact as `[[label]]` in the body (for example `[[yes or no for Tuesday]]`). The server refuses to approve a version that holds `[[`; the card and the panel show the gaps first. The user fills them by an edit (panel, or mail client after E6b) or by a redraft with an instruction line. This turns the rubric item "no invented promise" into a code check at the send.

### 2.4 Code checks on the drafter output

Before the draft is stored:
- no e-mail address, link, phone number or account number (IBAN, card) in the body unless the same string is in the instruction line, the signature or the writing style;
- no run of more than two blank lines; no line that looks like a mail header; no control or bidi characters;
- body at most 2,000 characters;
- language equals the target language;
- the gap syntax is well formed.

A failed check: one retry with the failure reason; a second failure ends as `draft_failed` with a reason code; the user sees "Could not draft a reply" and can tap again.

### 2.5 Recipients

- Default: the `From` address of the mail (code, from the stored header).
- "👥 Reply all" (card button, panel toggle): adds the original `To` and `Cc` from the stored headers, minus the organization's own mailboxes. A new version, a new tap.
- `Reply-To` that differs from `From`: the card shows it; the draft still goes to `From`. "Use Reply-To" is one tap (a new version). E3b's `reply_to_mismatch` rule may flag the mail first; then no draft.
- Never a recipient from body text or LLM output (architecture §4.1 rule 2).

### 2.6 Surfaces

- Drafts folder: APPEND with `\Draft`, `In-Reply-To` and `References`, so threading clients group it. On IMAP the draft is not shown inside the thread in most clients; on Gmail and Microsoft 365 (E9) the provider APIs put it into the thread.
- No visible prefix in the subject or the body: the user may send the draft from the mail client, and a prefix would go out. The `X-EA-Action-Id` header, the card and the panel mark system drafts.
- Telegram: no card per draft. A "📝 N replies ready" notice when the first new draft exists after the last notice, at most one per 2 h, never in quiet hours (E4-B); plus one line in the morning digest. "Review" shows the drafts one at a time: 📤 Send, ✖️ Reject, ✍️ Redraft, ⏭ Skip, 👥 Reply all. The next card comes after the user acts on the current one.
- "✍️ Draft reply" on an urgent notice: the card comes at once, outside the batch.
- Panel: the E4-A approvals page shows the reply kind (recipients, full body, gaps, the thread, version), the instruction field and Redraft.
- Instruction line: in Telegram the user answers the card with a text message (reply to the message, or after ✍️ Redraft); in the panel a field. At most 300 characters, at most 5 redrafts per mail. Only an owner (as for Send).

### 2.7 Expiry and closing

| Event | Result |
| --- | --- |
| 7 days without an answer | `expired`; the draft leaves Drafts (UIDPLUS) unless the user changed it there (E6b read-back) |
| The original gets `\Answered` (E3a re-check) | `closed` with reason `answered_elsewhere`; the draft leaves Drafts if unchanged |
| A newer mail in the thread | `superseded`; a new draft if eligible |
| Reject | as today; reject reasons from E3a (`wrong content`, `not needed`) feed M3 |
| Tap after the draft left Drafts and the original is answered (E6b) | `sent_by_user`; nothing goes out |

Delegation, clarification and reminder keep 48 h.

### 2.8 Style

- Per mailbox: display name, signature, writing style (≤ 1,000 characters). A migration copies `organizations.style_text` into the signature of each mailbox of the organization (it is used as a signature today), then drops the column in a later contract step (PD-053 expand and contract).
- Style card on the mailbox settings: a short guided form (form of address, greeting, sign-off, length) that writes the style text, a free text field, and "Preview": the drafter writes a reply to a fixed sample mail (no real mail; cost one call).
- E6b "Suggest my style from Sent" (after E5's read-Sent ADR): one read of up to 300 sent mails of the last 90 days, one LLM call that writes a style text proposal (no quotes, no names, no addresses: the code checks of §2.4 apply), the user edits and saves. No sent mail goes into later prompts (same rule as E3 decision 7).
- E6b "Style from my edits" (PRD US-018): at most once a week, when at least 5 sent drafts were edited, one call reads the before/after pairs and proposes a change to the style text; the user accepts or drops. Cuttable.

Market check: Fyxer writes "personalized instructions from your recent sent emails" into a 1,000-character writing-style field the user can edit (§3). The same shape here, with an explicit user save.

### 2.9 Shadow mode and the trust ladder

No automatic drafts in `shadow`. The E4-B "what I would have done" report gets one line "would draft N replies" and a button "Show 3 sample drafts": three drafts on recent eligible mail, stored only in the DB, shown in the panel, never in Drafts, never sendable. This shows draft quality before the user turns on `assist`.

### 2.10 Edits in the mail client (F043, ticket E6b)

- At the tap, the committer reads the Drafts copy first.
- Same body as the shown version: send.
- Changed body: store it as a new version (user text; the quote stays untrusted), show it on the card and the panel, ask for a new tap. The approval binds to the exact rendered mail (`03` §4).
- Changed or added recipient: refuse ("Recipients changed in the mail client; send it from there or use the panel").
- Draft gone and the original answered: close as `sent_by_user`; nothing goes out. Draft gone and not answered: `draft_missing` as today.
- The card line "Do not send the draft from your mail client" goes away.

Matching an edited draft: clients may drop unknown headers when they save a draft again (Thunderbird bug 195716, §3). Default order: `X-EA-Action-Id`, then `Message-ID`, then `In-Reply-To` + recipient inside Drafts. The E6b spike decides which work on the pilot clients.

## 3. Research (web, read 2026-11-13)

| Fact | Source | Use |
| --- | --- | --- |
| Fyxer: "Which emails get a draft" has four levels, from "almost everything" to "only a direct question or request"; unused drafts are deleted 14 days after generation by default, 1–30 days configurable | Fyxer help center "How often drafts appear and how long they're kept", updated 2026-10-20 (vendor) | Automatic drafts are the market default; expiry in days, not hours. We keep one level ("direct question or request" = `needs_reply`) and 7 days |
| Fyxer writes "personalized instructions from your recent sent emails" into a writing-style field of up to 1,000 characters that the user can edit; repeated edits should go into those instructions | Fyxer learning hub "Make Fyxer sound exactly like you" (undated, read 2026-11-13, vendor) | Style = an editable text proposal from Sent, not raw examples in each prompt (§2.8) |
| Superhuman Auto Drafts 2.0: every message that needs a reply gets a draft; context from inbox, calendar and web; "40 % sent within 1 day, 60 % sent unedited" | Superhuman blog, 2026-07-14 (vendor, marketing numbers) | The market leads with automatic drafts. We refuse inbox, calendar and web context in Stage 2 (injection surface, §2.2). "Sent within 1 day" supports a short expiry |
| Inbox Zero: mail that needs an answer gets the label "To Reply" and a draft in the Drafts folder | docs.getinboxzero.com, introduction (2026, vendor docs) | Same pattern; the Drafts folder is the standard place |
| CVE-2026-55145 (Microsoft 365 Copilot in Outlook): hidden text in an external mail made Copilot search the inbox or OneDrive and put a summary below 50 blank lines in a reply draft to the attacker; no auto-send, so the leak needs the user's Send | "Context Collapse, Part 2", enklypesalt.com, 2026-07-14 (researcher blog) | Minimal drafter input; blank-line collapse; length cap; full text on the card (§2.2, §2.4) |
| An indirect prompt-injection mail made an agent with a Gmail connector put a token into an HTML draft; rendering the draft leaked it through CSS `image-set()` | Security Affairs, 2026-08-09; Black Hat USA 2026 talk by G. Heyes (secondary source) | Plain-text drafts only; no links in drafter output (§2.4) |
| EchoLeak (CVE-2025-32711): exfiltration from Copilot through a link or image URL that carries data | Simon Willison, 2025-06-11; arXiv 2509.10540 | Same rule: no links in drafter output |
| "Your Mailbox Is Mine" (ESPI): forged mailbox-state text makes email agents run attacker operations | arXiv 2507.02699, NDSS 2027, version 2026-09-27 | The drafter has no tools and no operations; injection can only shape text, which the code checks and the user reads |
| Practice guides: the AI leaves visible blanks for amounts, dates and policies, and the reply cannot be sent until every blank is filled, enforced on the server | Email Digit guide, 2026-10-08; Tutti guide, 2026-09-27 (vendors) | The gaps rule (§2.3) |
| Thunderbird drops custom headers when a saved draft is edited again | Mozilla bug 195716 (old, status not checked) | X-EA-Action-Id may not survive an edit; spike in E6b |
| `\Answered` is a standard IMAP flag; whether a reply from webmail sets it depends on the client | RFC 9051 §2.3.2; superuser.com 318667 (2011, Gmail case) | E3a stage 1 checks it on Interia; fallback: Sent sync (E5) |

Not found: a public benchmark for reply-draft quality in Polish. The E2a holdout and judge stay the measure.

## 4. Cross-epic notes (edits for the owner to approve)

| Epic | Edit |
| --- | --- |
| E2 (E2a) | The `needs_reply` bank cases carry `expected_points` (what the reply must answer) and `must_not` (decisions the reply may not make); the judge rubric adds: answers every question, no invented commitment, form of address matches, language matches, gaps used where a decision is missing. Injection cases for replies: hidden text asking to include other data, 50+ blank lines, a link or account number to insert, "reply to another address", a fake "the executive already agreed" line |
| E3 (E3a) | Header capture adds `Auto-Submitted`, `List-Id`, `Precedence` (E6 eligibility) and the `\Answered` re-check feeds E6 closing. M3: a sent reply that the user marks "mistake" counts; reject reason `wrong content` covers tone. M7 counts drafter calls (estimate ≈ $0.35 per mailbox per month, E3 notes §4). E3b: the phishing flag blocks reply drafts (already in E3 notes §5) |
| E4 (E4-A) | The approvals page renders kind `reply` (gaps first, version, Reply all, instruction field). E6 adds the reply kind; E4-A builds the page and the version rule. E4-B: the report gets "would draft N replies" and "Show 3 sample drafts"; quiet hours hold the "replies ready" notice |
| E5 | Follow-up drafts for waiting-for-reply: the default stays a template like the delegation reminder; switching to the E6 drafter is an eval-gated option. E5's read-Sent ADR is a dependency of E6b "Suggest my style from Sent" and improves `sent_by_user` detection. The `05` §2 graph gets `E5 → E6b` (style from Sent) |
| E7 | Flag `reply_drafts` (default off, pilot first). Send limits apply to replies unchanged. The DSR address map and the delete test add the reply payload columns (they already cover `actions.payload`) and the new mailbox columns (no addresses) |
| E8 | New log events (`reply.drafted`, `reply.draft_failed`, `reply.superseded`, `reply.closed`): ids and codes only |
| E9 | The Graph and Gmail adapters create reply drafts inside the thread (Graph `createReply`, Gmail `threadId`) and support the E6b read-back; the content-minimal Telegram switch (F075) also hides the reply body on the card |
| E11 | Contact context (relation, usual form of address) is an eval-gated drafter input later; E11 needs E6 only for that |

## 5. Questions that wait for numbers or a spike

| Question | Default now | Trigger | What changes the default |
| --- | --- | --- | --- |
| Automatic drafts for `needs_reply`, or on tap only | Automatic | E6a stage 1 prototype on the E2a `needs_reply` holdout, scored by the E2a judge | Fewer than 80 % of drafts rated "send as is or small edit", or any invented commitment that passed the gap check → on tap only until fixed |
| Drafter model | `gpt-6-luna` (writer role) | Same run, luna and `gpt-6.1-terra` side by side | Luna below the bar and terra above it, with M7 still ≤ $5 → terra for drafts only |
| Judge bar | ≥ 80 % "send as is or small edit"; 0 invented commitments; 100 % code checks; injection set 100 % | Same run | The owner reads 20 drafts by hand next to the judge scores; a judge that disagrees with the owner on more than 4 of 20 is fixed first |
| Matching an edited draft (F043) | `X-EA-Action-Id`, then `Message-ID`, then `In-Reply-To` + recipient | E6b stage 1 spike: the owner edits one system draft in Interia webmail and in the phone mail app (≈ 10 min) | No key survives in a client → for that client, "edit in the panel or send from the mail client"; F043 read-back only where it works |
| `\Answered` on Interia | Used for closing and `sent_by_user` | E3a stage 1 pilot check | Not set by Interia webmail → closing waits for E5 Sent sync; until then only expiry and supersede close drafts |

The prototype runs as stage 1 of E6a (the same pattern as the E9 spike). The second pass is a short session between stage 1 and stage 2.

## 6. Size

| Ticket | Stages | Source lines | Content |
| --- | --- | --- | --- |
| E6a Reply drafts | ≈ 17 | ≈ 3.6k | Stage 1 prototype (drafter prompt, output schema, code checks, gaps, holdout run with the judge, report); then: payload kind `reply` with version and `cc`; eligibility rules; compose step and drafter job (own status, cap share); supersede and close rules; time limit per kind; message builder for replies; Telegram "replies ready", one-at-a-time review, Redraft by reply text, Reply all, "✍️ Draft reply" on urgent notices; panel reply kind and instruction field (on the E4-A page), "Draft a reply" on activity rows; per-mailbox display name, signature, writing style (expand migration) and the style card with preview; shadow sample drafts; flag; eval cases; capability page; ADR 0029 |
| E6b Edits and style learning | ≈ 7 | ≈ 1.3k | Stage 1 client spike; read-back at the tap, new version on change, refuse on recipient change, `sent_by_user`; keep edited drafts at expiry; "Suggest my style from Sent" (after E5's read-Sent ADR); style from edits (cuttable); contract migration for `organizations.style_text` |
| **Total** | **≈ 24** | **≈ 4.9k** | Up from 14 / 2.5k: the drafter is the first free-text LLM output (new checks, gaps, a new pipeline step), the phone review flow, the style split and F043 were not in the estimate |

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| A draft promises what the executive never decided (M3, trust) | Gaps rule enforced at the send; judge item "no invented commitment"; card and panel show the full text; second pass can switch to on tap |
| Injection shapes the reply (hidden text, data to insert, hidden blank lines) | Minimal drafter input (nothing internal to leak); code checks on links, numbers, addresses, blank lines, length; reply injection cases in E2a; only an owner can send |
| Telegram noise with 20+ drafts a day | Batched notice at most every 2 h, quiet hours, one-at-a-time review; the panel is the full list |
| Stale drafts in the Drafts folder, sent later from the mail client by mistake | 7-day expiry, close on `\Answered`, supersede on a newer mail; E6b detects `sent_by_user` |
| `needs_reply` precision on real mail is unknown (1 kept label row, architecture §6.3) | E3 numbers; useless drafts cost noise, not a send; the second pass can move to on tap |
| Client drops `X-EA-Action-Id` on edit | Spike; fallback keys; else no read-back for that client |
| Drafts use the LLM cap and starve triage | Automatic drafts stop at 80 % of `LLM_DAILY_CAP` |
| Wrong Polish form of address (`ty` vs `Pan`) | Mirror rule in the prompt, judge item, style text override |
| Draft text in Telegram (third-party chat) | Accepted in the product brief (draft text for approval); E9 F075 switch hides it; the panel shows the body |
