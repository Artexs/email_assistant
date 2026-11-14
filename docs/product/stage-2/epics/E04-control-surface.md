# E4 · Control surface and trust UX

> Tier: Must. Status: ready to plan (discovery 2026-11-13, PD-029–PD-036). Size: about 45 stages, 10.5k lines, two tickets (E4-A about 20, E4-B about 25); the biggest product epic. Can run next to E2 and E3.

## Outcome

The panel covers every user action, and every decision shows why it was made, how sure the system was, and how to undo it. A new user walks a trust ladder from shadow to earned autonomy per category. Every action is a channel-neutral API command.

## Users

Executive; later the EA (Stage 3) and the mobile client (E12) on the same commands.

## In scope

- **Delegates page**: CRUD, competence field, block own address, CSV import (old UI spec, MVP item).
- **Delegation dashboard**: overdue, in progress, answered; filters; "send reminder" and "send all".
- **Approvals page**: every waiting draft with recipients spelled out, full body, the thread it answers, inline edit (F039, F043), approve, reject; an edit invalidates the earlier approval (R14).
- **"Why" and confidence** on every digest row and activity row: rule hit or model reason code, confidence mark (R15).
- **Autonomy per category**: the existing switches shown with the measured accuracy from E3 ("notification: 96% on your mail; auto ON"); the go/no-go bar as the visible criterion.
- **Onboarding trust ladder** (R9): connect → shadow 3–7 days → "what I would have done" report → turn on `auto` per category. The report is also the demo for E10.
- **Spam review**: a short list of what went to spam, to catch false positives (ES 6).
- **Bulk unsubscribe**: List-Unsubscribe header, one tap, with approval; small.
- **Focus or vacation mode**: notices off for a period; `/pause` stops processing, this does not.
- **Mail digest channel**: the digest by mail as an alternative to Telegram (users without Telegram).
- **Style text**: edited as a writing style, separate from the signature (`SignatureCard.tsx` today).
- **"What is urgent for me" editor** (PD-017): VIP people, key topics, open deadlines; the data shape comes from E2a; E3 feeds it to the classifier prompt.
- Every new action is an API command with typed input and output (`03` §4); OpenAPI description of the commands.

## Out of scope

Waiting-for-reply, commitments, manual delegation (E5). Reply drafts (E6). Operator console (E7). PWA and push (E9). Live updates (F055) unless cheap.

## Dependencies

- The Polish i18n frame (F098) lands before the E4-A page stages. Every new page key goes in `en.ts` and `pl.ts` (the typecheck enforces it). New notice texts go in `packages/core/src/texts/` in en and pl. (Applied 2026-11-14 from the F098 plan.)

E1. Blocks E5, E6, E9, E12. Identity tier 1 (E7) builds after this epic's API commands exist.

## Open product questions

1. Panel first or Telegram first for approvals with full context: the panel is the proposal; Telegram keeps the short card and a link (F075 later).
2. The "what I would have done" report: a page, a mail, or both.
3. Accessibility bar: WCAG AA pass on the new pages, or later.

## Risks

- Six new pages is a large web build; split into two tickets (delegation and approvals first; trust ladder and the rest second).
- The owner is the only user: do a hand test of each page on the phone (the skipped S5e checks come back here).

## Exit

- Each in-scope item has a page or a flow, a Playwright test, and an API command with a typed schema.
- A new test organization walks the trust ladder end to end on the simulator and gets the report.
- The digest and the activity page show a "why" line on every row.

## Discovery (2026-11-13)

Detail, sources and the ticket split: [E04-discovery-notes.md](E04-discovery-notes.md). ADR drafts: `docs/decisions/0022-report-mail-into-own-inbox.md`, `docs/decisions/0023-user-commands-openapi-contract.md`, `docs/decisions/0028-autonomy-evidence-without-user-labels.md`.

### Verdict: modify

The outcome is right for the thesis: trust ("every action has a reason, a confidence and an Undo") and "less time in the inbox" need a panel where the user acts, sees why, and earns autonomy per category. Changes:
- Split into two tickets: **E4-A "Act from the panel"** (command contract, approvals with edit, delegates, delegation dashboard) and **E4-B "Earn trust"** (history check at connect, report and "Turn on recommended", tripwire, why-line gaps, optional review, "what is urgent for me" editor, mail report channel, quiet hours, spam review entry, bulk unsubscribe).
- Drop: focus or vacation mode (replaced by quiet hours per user), delegates CSV import.
- Move out: style text editor and F043 to E6.
- Add: evidence for `auto` without user labels (owner's rule, ADR 0028): global holdout evidence, an automatic history check at connect, a tripwire; user reviews are optional. Also a nav badge for waiting approvals and axe checks on every page.
- Correct the page: R15 ("why is stored, not shown") is mostly built; autonomy per category with measured precision is built.

### Code cross-check (summary; full table in the notes §1)

| Item | Exists today | New |
| --- | --- | --- |
| Delegates | Service add and activate (`delegation/service.ts`), CLI | Edit, routes, page |
| Delegation dashboard | `listDelegations`, chaser, CLI, digest counts | Routes, page, remind now, mark done, cancel |
| Approvals | Service `actions/approvals.ts`, renderer `core/digest/approvals.ts`, Telegram card | Routes, page, `via: web`, edit as a new version, card sync (F039) |
| Why and confidence | Activity row and detail; digest `💬` and `→` lines | Confidence in the digest, rule-hit and delegate reasons |
| Autonomy per category | `CategoriesCard.tsx` with the gate from real labels (`triage/gate.ts`) | Progress, recall, link to review |
| Trust ladder | Shadow default, "would …" lines, onboarding checklist; real-label gate only | History check at connect, report page, "Turn on recommended", tripwire, optional panel review |
| Spam review | Activity filter `spam` with ✏️ and Undo | Digest entry line |
| Bulk unsubscribe | — (sync fetches 2 headers only) | Headers, migration, senders view, one-click POST |
| Mail digest | — (Telegram only) | Report mail by IMAP APPEND into the own INBOX |
| Style text | Used as the signature (`core/outgoing/message.ts:78`) | Moves to E6 |
| "What is urgent for me" (PD-017) | VIP sender rules on the Rules page; only the VIP flag reaches the classifier | Topics and deadlines per mailbox, editor card on the Rules page |
| Typed commands | Hono routes, zod 4 schemas in `core/web` | OpenAPI from the same schemas, route check |

### Cross-epic notes

Edits for the owner to apply on other pages are in the notes §5. Short: E1 closes stale F034 and marks F039 and F075 (web half) as folded into E4 (F028 stays in E2a); E3 sets the history-check and tripwire numbers of ADR 0028 and rewrites its real-label exit line; E6 takes the style text and F043; E9 keeps only the Telegram content-minimal switch and implements `appendMessage` in its adapters; E3 owns the gate bar and the phishing flag that gates unsubscribe; E5 adds manual delegation as a command on this contract.

### Research facts (sources and dates in the notes §2)

- RFC 8058 one-click unsubscribe needs both headers under DKIM; the receiver POSTs `List-Unsubscribe=One-Click`.
- Fyxer delivers briefings and digests by mail (vendor text, 2026): a digest by mail is market standard.
- Approval design (2026 guides): render from the exact call, bind the approval to a version, any change needs a new approval.
- The EAA does not cover B2B SaaS sold to companies (secondary sources, 2026); automated axe checks cover about 40–57% of WCAG problems.
- `hono-openapi` 1.5 (2026-10-18) builds OpenAPI from Zod 4 schemas.

### Decisions (defaults; the owner's answers become PD rows)

1. Verdict "modify", split A and B, drops and moves as above. [accept]
2. Approvals: both Telegram and panel approve; Telegram card unchanged plus an "Open in panel" link; edit only in the panel, only while waiting; an edit is a new version that replaces the Drafts copy and needs a new tap; no free-text recipient (pick another delegate). [yes]
3. Report: a panel page built from the history check, ready within the first hour, with "Turn on recommended" (one tap); one notice when it is ready, one more only when the tripwire pauses a category. [yes]
4. Review: "Check 10 decisions" in the panel is an optional suggestion, never a step. Telegram `/review` stays F028 in E2a. [changed by the owner]
5. Mail channel: digest and report put into the user's own INBOX by IMAP APPEND; per user Telegram, mail or both; urgent notices stay on Telegram (ADR 0022). [yes]
6. Focus or vacation mode: drop; quiet hours per user instead. [replace]
7. Bulk unsubscribe: keep as the last, cuttable group of E4-B; RFC 8058 POST after a tap through the host guard, else open the link in the browser; never for spam or phishing-flagged mail. [yes]
8. Command contract: OpenAPI from the existing zod schemas with `hono-openapi`, every route has a schema, no command bus (ADR 0023). [yes]
9. Accessibility: axe WCAG 2.2 A/AA check on every panel page plus a keyboard test for approvals; no formal audit. [yes]
10. Delegates CSV import: drop. [drop]
11. One 10-minute phone hand test per ticket checkpoint (approve from the panel and from Telegram). [yes]
12. Close stale F034 in the E1 NEXT sweep. [yes]
13. "What is urgent for me" editor (PD-017): a card on the Rules page, per mailbox; VIP people are the existing VIP rules (no second list); topics and deadlines are new, a deadline drops out after its date; the shape comes from E2a, the prompt use is E3's. [yes]
14. Commit the changed files by explicit path. [yes]
15. (Owner, 2026-11-13) Evidence for `auto` never needs user labels: global holdout evidence decides by default; the history check at connect runs by itself and only blocks a category that would hide mail the user acted on; no history means global evidence alone; user signals only block (tripwire). ADR 0028. [decided]

No question waits for E2 or E3 numbers: E3 sets the history-check bound, sample cap and tripwire rate inside its own tickets; E4 builds the mechanism with the ADR 0028 defaults.

### Corrected size and risks

Size: E4-A about 20 stages, 4.5k lines; E4-B about 25 stages, 6k lines; total about 45 stages, 10.5k lines. Built parts (why line, gate card, spam filter) are offset by the history check, edit versions, the contract and the urgency editor that E2 added (PD-017). Risks with mitigations: notes §6 (Tailscale on the phone, two-channel races, edit in two places, unsubscribe SSRF, own-INBOX mail looks like phishing, users who never label, one tester).

### Owner's answer (2026-11-13) and planned tickets

Owner: "The rest is fine. Use the default values." with one change: user labels are optional and never block (decision 15, PD-030). Decision rows PD-029–PD-036.

| Planned ticket | Effect |
| --- | --- |
| F039 approval edit in place | Absorbed by E4-A (Telegram card sync) |
| F075 content-minimal Telegram | Web-approvals half absorbed by E4-A; the Telegram switch stays for E9 |
| F043 send draft edits | Moves to E6 |
| F034 own-mail header check | Dropped: already built (`main.ts:72`) |
| F028 `/review` | Not E4: stays in E2a (PD-018); E4 builds only the optional panel review |
| F055 live updates | Not absorbed; polling stays |

## Input from the E3 discovery (2026-11-13, PD-056–PD-068)

- Approvals page: the reject action offers the reason select "wrong person / wrong content / not needed" (optional); E3a builds the command and the Telegram buttons (PD-057).
- The autonomy page reads the E3a stats route (PD-066).
- `List-Unsubscribe` and the IMAP flags come from the E3a header capture; the E4-B history check and bulk unsubscribe read them, no second capture (PD-063, PD-068).
- History-check and tripwire numbers: the ADR 0028 defaults, adopted by E3 (PD-068).
- The urgency editor writes through the E3b urgency-profile command (PD-061).
