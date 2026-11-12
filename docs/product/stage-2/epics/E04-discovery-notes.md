# E4 discovery notes (2026-11-13)

> Detail for the "Discovery" section of `E04-control-surface.md`. Written by the E4 discovery session (Opus 5.5). The E2 session ran at the same time and committed first (`356deeb`, PD-013–PD-028); this session read those decisions and took over the E4 item it added (PD-017 urgency editor). An E3 session also runs now; it did not change E4.

## 1. Code cross-check (what exists on master, 2026-11-13)

| Item | Exists today | Partly there | New |
| --- | --- | --- | --- |
| Delegates page | Service: `delegation/service.ts` `addDelegate` (name, address, competence tags, refuses a mailbox address), `setDelegateState` (active on or off); CLI `scripts/delegates.ts` | No edit of name or tags; no HTTP route; no page | Routes `GET/POST/PATCH /delegates`, page `/delegates`. CSV import: dropped (decision 10) |
| Delegation dashboard | `delegation/repo.ts` `listDelegations`, statuses `drafted`, `sent`, `answered`, `overdue`, `done`, `cancelled`; chaser `delegation/chaser.ts` (reminders every 3 days, at most 2, approval sets of up to 10); CLI `scripts/delegations.ts`; digest footer counts | Telegram ✅ Done on `delegation_answered` | Routes and page `/delegations` with filters; commands "remind now", "mark done", "cancel" |
| Approvals page | Service `actions/approvals.ts` (approve, reject, send again, went out; `via: "telegram" \| "cli"`); renderer `packages/core/src/digest/approvals.ts` `renderApprovalRequest`; reminder sets; 48 h expiry; `draft_not_ready` guard | Telegram card has recipient, external-sender warning, full draft text, quote | Routes and page `/approvals`; `via: "web"`; edit in the panel (new draft version); nav badge with the count |
| Edit invalidates approval (R14) | — | Approval happens only in `awaiting_approval`; the send uses the DB text | Edit = new version of the draft text; the Drafts copy is replaced; the send binds to the version; the Telegram card says "changed in the panel" |
| "Why" and confidence (R15) | Activity list row shows category and confidence (`ActivityRow.tsx:34`); detail panel shows the "why" text (`ActivityPanel.tsx:52–57`); digest line shows `💬` why and `→` what it does or would do (`core/digest/digest.ts:111–112`) | Digest has no confidence mark; rule hits other than blocklist show only the LLM reason; no "why this delegate" or "why this folder" | Confidence mark in the digest line; rule-hit reason text (VIP, whitelist); delegate choice reason |
| Autonomy per category | Settings card `CategoriesCard.tsx` with the go/no-go text per category from real labels (`triage/gate.ts`, bar 98%, at least 30 kept rows), "set anyway" dialog, audit rows | Shows precision from real labels only; the gate needs 30 labels | Card shows the three evidence sources of ADR 0028 (global holdout, history check, user signals); labels only block |
| Onboarding trust ladder | Onboarding checklist (`core/web/onboarding.ts`: mailbox, Telegram, mode, rules); shadow is the default mode; logged actions read "would …" in the digest (`core/digest/would-do.ts`) | Mode choice and "keep mode" step | Shadow report page, report-ready notice, evidence-based ladder per category |
| Evidence for `auto` | Real-label gate only (`triage/gate.ts`); backfill read-only (`scripts/mailbox-backfill.ts`); activity filter "not rated" plus ✅ / ✏️ | IMAP flags fetched for folder metadata, not stored | History check at connect, global holdout evidence, tripwire, optional panel review (ADR 0028) |
| Spam review | Activity filter by category `spam`, with ✏️ and Undo per row | No entry point from the digest | Digest line "N went to spam · review" with a link to the filtered list |
| Bulk unsubscribe | — | — | Sync fetches `List-Unsubscribe` and `List-Unsubscribe-Post` (today it fetches only `References` and `X-EA-Action-Id`, `mail/imap/client.ts:53`); migration; senders list; one-click POST |
| Focus or vacation mode | Fixed quiet hours 22:00–07:00 (`core/digest/local-time.ts:17`); `/pause` stops processing | — | Replaced by quiet hours per user (decision 6) |
| Mail digest channel | Channel port `channels/port.ts` (Telegram only); auth-mail SMTP sender (S6b, off on the VPS) | — | Report mail put into the user's INBOX by IMAP APPEND (ADR 0022 draft) |
| Style text | `organizations.style_text`, edited in `SignatureCard.tsx`, used only as the signature (`core/outgoing/message.ts:78–79`) | — | Moves to E6 (decision 1) |
| "What is urgent for me" editor (added by E2, PD-017) | VIP sender rules (Rules page); only the VIP flag reaches the classifier (`triage/classifier.ts` `SenderContext`) | — | Topics and deadlines per mailbox, a card on the Rules page; shape from E2a, prompt in E3 (decision 13) |
| Typed API commands, OpenAPI | Hono routes per module; request and response schemas in `packages/core/src/web/*` (zod 4) shared by web and server | No OpenAPI file; no check that every route has a schema | `hono-openapi` description at `/api/openapi.json` (ADR 0023 draft) |

Other facts found:
- `F034` (own-mail header check) is already built: `apps/server/src/main.ts:72` wires `isOwnActionId` into the sync (`mail/sync.ts:180`). The planned ticket is stale; E1's NEXT sweep should close it.
- The panel is reachable only through Tailscale Serve (ADR 0017). Approvals in the panel on the phone need the Tailscale app on the phone until a public address exists (S6 path in ADR 0017).
- `approved_via` is a free `text` column (`db/migrations/20261104000001_triage.sql:90`); `web` needs no constraint change, only the TypeScript union.
- Playwright e2e exists (`apps/web/e2e/tests/*.spec.ts`, 8 files); no accessibility check yet. UI parts are Radix (`radix-ui` 1.8), which gives keyboard and ARIA basics.

## 2. Research (web, 2026-11-13)

| Fact | Source, date | Effect |
| --- | --- | --- |
| RFC 8058 one-click: the sender puts one `List-Unsubscribe` header with an HTTPS URI and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; both must be covered by a valid DKIM signature; the receiver does a POST with that body | RFC 8058 (rfc-editor.org, 2017); Bird and WSS explainers (2026) | One-click POST only when both headers exist; check the provider's DKIM result (`Authentication-Results`) when present; else fall back to "open the link" in the user's browser |
| Inbox Zero groups newsletter senders, shows counts and read share, and offers unsubscribe, auto-archive or keep; its own advice: "Never click unsubscribe on obvious spam: mark it as spam instead" | docs.getinboxzero.com (2026); getinboxzero.com blog (2026-02-07). Vendor text, marketing | Senders list from `notification` and `info`; never for `spam` or phishing-flagged mail |
| Fyxer sends its morning briefing, digests and notices by mail; the user can reply to them ("Chat with Fyxer from your inbox") | support.fyxer.com and fyxer.com changelog (2026-09-06, 2026-11-05). Vendor text, marketing | A digest by mail is market standard. Reply-to-chat is Stage 3 (agent) |
| Approval design rules: render the request from the exact call that runs; store a digest of the approved operation and compare it at execution; any difference goes back for approval | agentexperience.tech, "Human approval workflow for AI agents" (2026-09-14); makeyouragent.ai (2026-07-23); ai-tldr.dev (2026-06-13) | Edit = new version, approval binds to the version; the existing renderer (`renderApprovalRequest`) already follows "render from the call" |
| Shadow mode as an onboarding stage: the agent runs on live traffic and writes what it would have done; a periodic comparison decides the go-live | Freshdesk support (2026); dev.to, Nylas example (2026-08-29); purpleorange.ai (2026-09-22) | Confirms the report as a product step; our gate (labels per category) is the comparison |
| EAA (Directive 2019/882) covers services to consumers; B2B SaaS sold only to companies is generally out of scope; service microenterprises (< 10 staff and ≤ €2 m) are exempt | dardo.studio (2026); buffermint.com (2026-10-25); scanready.eu (2026-08-27); eur-lex summary. Secondary sources, not legal advice | No legal duty for this product; WCAG AA stays a quality bar for "sell-ready" |
| Automated checks (axe-core) find a part of WCAG problems only: about 23 of 55 WCAG 2.2 A/AA criteria have an automated rule; Deque reports 57% of issues by count | skiplink.dev (axe-core 4.12.1 metadata); deque.com coverage report; playwright.dev accessibility docs | Axe in Playwright is cheap but not a pass; add a keyboard path test for the approvals page |
| `hono-openapi` 1.x supports Zod 4 through Standard Schema; 1.5.0 released 2026-10-18 | github.com/rhinobase/hono-openapi releases; npmjs.com | The repo uses Hono 4.13 and Zod 4.1: the OpenAPI file comes from the existing schemas, no second schema set |

## 3. Design decisions in detail (defaults; the owner answers in the chat)

### 3.1 Approvals (decision 2)
- Both channels approve. Telegram keeps its card (full draft, quote, recipient) and gets an "Open in panel" link. The panel shows the same render (`renderApprovalRequest` or its structured twin), the thread it answers (the quoted original), the recipient spelled out, the external-sender warning, and the time left before expiry.
- Edit only in the panel, only while `awaiting_approval`. An edit stores a new draft version (subject and body; the recipient is not free text). The committer replaces the Drafts copy (APPEND the new one, then remove the old one by its `X-EA-Action-Id`). The send binds to the version id and a text hash; the approve call carries the version it showed; a mismatch answers "changed, look again". The old Telegram card is edited to "Changed in the panel. Approve there." (absorbs F039: the card is edited in place with the result).
- Change of recipient: "pick another delegate" from the delegates list re-plans the draft. No free-text address in Stage 2 (wrong-recipient mistakes count in M3).
- Only an owner approves, rejects or edits; a member sees the page read-only (`can-write.ts`).
- Edits in the mail client (F043) stay in E6. Until then the panel and the card say "Edit here, not in your mail client" (today's line).

### 3.2 Trust ladder: evidence without user labels (decisions 3, 4, 15; ADR 0028 draft)

Owner's rule (2026-11-13): user labels never gate the system. The system works on global evidence; an automatic check of the user's own mail history adjusts it; labels and corrections are an optional bonus. See ADR 0028.

Three evidence sources, in this order:
1. **Global evidence (always present).** The category passes go/no-go on the frozen simulator holdout for the running prompt and model version (E2a; PD-024: at least 200 cases, Wilson 95% lower bound against the bar). It is one result per version, stored with the release, the same for every user.
2. **History check (automatic at connect, no user step).** The backfill reads the last 30 days of INBOX and the synced folders (read-only), with the IMAP flags `\Seen`, `\Answered`, `\Flagged`. The classifier runs on a capped sample (default at most 500 mails, cost cap from E3). The user's past behaviour gives weak labels:
   - "important to you": the user answered it (`\Answered`, or a reply in Sent once E5's read-Sent ADR lands), flagged it, or wrote to the sender before;
   - "noise to you": never opened, from a bulk sender (`List-Unsubscribe`, `List-Id`, no-reply), or the provider's spam folder.
   For each category that moves mail away (`notification`, `spam`, `info`) the check counts the "important to you" mail the system would have moved. Pass: the Wilson 95% upper bound of that share is at most 2% on at least 50 such mails (E3 owns the numbers). Fail: the category stays off with the reason and the example mails shown. Too little history, a provider that refuses, or the user skips it: no result, and global evidence alone decides. It never blocks.
3. **User signals (optional bonus).** Corrections, Undo, moved-back mail and the optional review. They never unlock anything that global evidence refused. They can only stop a category: a **tripwire** pauses `auto` for a category when its corrections pass a rate (E3 sets it; default 2 corrections of applied moves in 7 days, or one "important to you" mail moved), with a notice and the reason. With 30 or more labels the existing real-label gate also counts, as a block, not as a requirement.

What the user sees:
- The "what I would have done" report is a panel page, ready within the first hour (M6), because it starts from the history check: per category the mail count of the last 30 days, what the system would have done, the history-check result with the few "important to you" mails it would have moved, and the global number ("notification: 99.1% on 200 test cases").
- One tap "Turn on recommended" switches `auto` on for every category that passed (consent stays a tap: modes are the consent, D2). Per-category switches stay on the Settings card. Shadow stays the default mode until that tap.
- One notice (Telegram or mail) when the report is ready. A second one only if the tripwire pauses a category.
- The review "Check 10 decisions" is a suggestion on the report page, never a step that blocks. Telegram `/review` is F028, which moved to E2a (PD-018); E4 builds only the panel twin.

Feasibility facts: the backfill exists (`scripts/mailbox-backfill.ts`, 1–180 days, read-only); the IMAP client already fetches flags for folder metadata (`mail/imap/client.ts:55`) but the `emails` table stores no `\Seen` or `\Answered` (new columns or a history-check table). E3 stage 1 checks whether Interia sets `\Answered`; if not, the "answered" signal waits for the Sent read (E5) and flags plus bulk headers carry v1. History bodies follow the normal 30-day retention.

### 3.3 Mail report channel (decision 5, ADR 0022 draft)
- The digest and the report can go to the user's own INBOX as a mail that the system puts there by IMAP APPEND. No SMTP, no relay, no new sub-processor; the content never leaves the user's mail host.
- The mail carries `X-EA-Action-Id` (or a report id header) so the sync skips it (the own-mail check exists). From: the mailbox address with the display name "Email assistant"; links open the panel; no buttons.
- Per user: Telegram, mail, or both. Urgent notices stay on Telegram (an urgent notice by mail adds nothing; PWA push comes in E9).
- The port already has `appendMessage(folder, raw, flags, internalDate)` (`mail/port.ts:103`, used for drafts). Gmail and Microsoft 365 adapters (E9) must implement it (Gmail `insert`, Graph create message).

### 3.4 Quiet hours (decision 6)
- Replace "focus or vacation mode" by quiet hours per user (start, end; default 22:00–07:00 as today), applied to notices only. The digest keeps its times. Vacation auto-reply is a mail host feature. The phone's own focus modes cover the rest.

### 3.5 Bulk unsubscribe (decision 7)
- The sync fetches two more headers and stores them per mail (migration). A "Newsletters" view lists senders of `notification` and `info` mail with a count and the latest date.
- One-click: both RFC 8058 headers present → after the user's tap the server sends one POST `List-Unsubscribe=One-Click` to the HTTPS URI, through the existing host guard (no private, loopback or reserved addresses), with a short timeout and no redirects to other hosts. Audit row with the sender domain, never the URI query.
- Else: "Open unsubscribe page" opens the HTTPS link in the user's browser (the server does nothing). `mailto:` unsubscribe is later.
- Never offered for `spam` or for mail with a phishing flag (E3). Optional follow-up action: a sender rule "move to notifications" (exists in rules).

### 3.6 Command contract (decision 8, ADR 0023 draft)
- Every user action is an HTTP route with an input and output schema from `packages/core/src/web/*`; `hono-openapi` builds `/api/openapi.json` (behind login). A test fails when a route has no schema.
- Telegram handlers and CLIs call the same service function and pass `via`. No command bus, no event store (PD-008).
- The OpenAPI file is the contract for identity tier 1 (E7), the PWA (E9) and the mobile app (E12). Versioning starts when a second client exists (E12).

### 3.7 "What is urgent for me" editor (decision 13)
- A card on the Rules page, per mailbox (the classifier works per mailbox). VIP people are the existing VIP sender rules: the card links them, no second list.
- New: key topics (short phrases) and open deadlines (text plus an end date; a deadline drops out after its date). Limits on count and length; the text is the user's own, but it reaches the prompt, so it goes through the same untrusted-text marking as mail text.
- The data shape comes from E2a (PD-017); E3 puts it into the classifier prompt and measures urgent recall per source.

### 3.8 Accessibility (decision 9)
- Every panel page (old and new) gets an axe check in its Playwright test (`@axe-core/playwright`, WCAG 2.2 A and AA tags, zero violations). The approvals page also gets a keyboard-only test (reach, read, edit, approve). No formal audit; no VPAT.

## 4. Ticket split (input for `plan-task`)

| Ticket | Content | Stages | Lines |
| --- | --- | --- | --- |
| E4-A "Act from the panel" | Command contract (OpenAPI, route check); approvals page with edit, `via: web`, Telegram card sync (F039), nav badge; delegates page; delegation dashboard (remind now, mark done, cancel); axe checks on all pages; phone hand test | about 20 | about 4.5k |
| E4-B "Earn trust" | History check at connect (flags, sample classify, weak labels, result per category; ADR 0028); report page from the history check and "Turn on recommended"; tripwire auto-pause; autonomy card shows global, history and user evidence; optional panel review; why line gaps (confidence in digest, rule-hit and delegate reasons); onboarding step change; "what is urgent for me" editor (PD-017, after E2a fixes the shape); mail report channel (ADR 0022); quiet hours per user; spam review entry; bulk unsubscribe (last group, can be cut) | about 25 | about 6k |

Order: A first (E5, E6, E7 identity and E9 depend on its commands and the approvals page). B can start when A's command contract stage lands.

## 5. Cross-epic edits for the owner (this session did not edit other pages)

| Epic | Edit |
| --- | --- |
| E1 | NEXT sweep: close F034 as already built (`main.ts:72`). Mark F039 and the web-approvals half of F075 as "folded into E4" (F028 is in E2a, PD-018); F055 stays planned (polling is enough) |
| E2 | PD-018 ("only real labels decide `auto` on real mail") is changed by PD-030: the E2a holdout result is the global evidence every mailbox uses |
| E5 | The read-Sent ADR also feeds the history check ("the user replied", "the user wrote to this sender"); E4 works without it |
| E3 | ADR 0028 changes the gate: global holdout evidence plus the automatic history check decide `auto`; real labels only block (PD-030). E3 sets the history-check bound, the sample cap and the tripwire rate, and its exit line "`notification` and `spam` pass on real labels (≥ 98%, ≥ 30 rows)" becomes "pass the history check on the pilot mailbox". Use `List-Unsubscribe` as a classifier signal for `notification`. The phishing flag gates bulk unsubscribe. E3 stage 1 (`\Answered` on Interia) also decides the history-check signal |
| `03` §4, §7 | §4 "a category gets `auto` only after it passes the go/no-go bar on measured data" stays true; add "measured = the global holdout plus the user's history check; user labels are optional". §7 "`notification` and `spam` pass on real mail" = the history check on the pilot mailbox |
| E5 | Manual delegation is a new command on the E4 contract and appears in the delegation dashboard. The "needs you today" brief page is E5's; the mail channel (E4-B) renders it too |
| E6 | Takes the style text editor (separate from the signature) and keeps F043 (edits in the mail client). Reply drafts reuse the E4 approvals page and the version rule |
| E7 | New E4 pages need Polish strings when S6c keeps the Polish UI (the later of the two adds them). Identity tier 1 reads the OpenAPI file for the command list. Send limits apply to panel approvals too |
| E9 | The web-approvals half of F075 is done by E4; E9 keeps the Telegram content-minimal switch. The OAuth adapters must implement `appendMessage` into INBOX too (report mail, ADR 0022) |
| E10 | The shadow report page, filled by the simulator, is the demo artifact |
| E2 | The simulator needs `List-Unsubscribe` headers on newsletter mail and a shadow week for the report. The scripted executive (ADR 0021) can tap approve, reject and edit through the E4 commands instead of the fake Telegram |

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| Panel on the phone needs Tailscale on the phone (ADR 0017) | Telegram stays a full approval path; the panel adds edit. The S6 public path changes only the proxy |
| Two approval channels race | One locked service function (exists); the second tap sees the new status; the card is edited after a panel action |
| Edit in the panel and in the mail client at the same time | Version binding; the panel text is the source of truth until E6 (F043) |
| Unsubscribe POST is a server request to an address from untrusted mail (SSRF) and can confirm an address to a spammer | Host guard, HTTPS only, no cross-host redirects, short timeout, only after a tap, never for spam or phishing-flagged mail |
| A mail put into INBOX looks like a phishing mail from oneself | Fixed From (the mailbox), fixed subject prefix, links only to `WEB_BASE_URL`; the ADR records it |
| Weak labels from behaviour are noisy (the user answers some newsletters, ignores some real mail) | Use them only as a one-sided safety check (would we hide mail you acted on?), never as precision; show the example mails; E3 sets the bound |
| Global evidence is simulated mail, not the user's mail | History check at connect plus the tripwire after `auto` is on; the sim-vs-real gap check (PD-019) |
| History check cost and privacy | Capped sample, cost cap, read-only, normal retention; the user sees it run in onboarding |
| Owner is the only tester | One phone hand test per ticket checkpoint (decision 11); axe and keyboard tests in CI |
