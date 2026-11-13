# Reply drafts (E6): code and market facts

Written 2026-11-13 by a discovery session that started E6, then switched to E11 because another session claimed E6. Facts only; no decision. The E6 session owns the decisions.

## Code (checked 2026-11-13)

- All drafts today are fixed templates (`packages/core/src/outgoing/templates.ts`). The LLM fills only `task` (≤ 300 chars) and `question` (≤ 200 chars); `oneLine()` in `outgoing/message.ts` removes line breaks and runs `markUntrustedText` (addresses → `[address]`, links → `[link]`, numbers → markers). A reply draft is the first free LLM text in an outbound mail: `docs/architecture.md` §7 "The template" rule changes, so an ADR is needed.
- The writer role exists in config but is unused: `OPENAI_MODEL` (default `gpt-6.1-terra`), `GEMINI_MODEL` (`gemini-3.8-flash`); `config.ts:101–110, 184–194`. Classifier: `gpt-6-luna` ($0.10 / $0.50 per 1M, `triage/cost.ts`). Terra is about 10× luna (E3 notes §2).
- Cost estimate: 200 mails/day × 13% `needs_reply` ≈ 26 drafts/day ≈ 780/month. At about 3k tokens in and 400 out on luna ≈ $0.0005 per draft ≈ $0.40 per mailbox per month; on terra ≈ $4 (most of the M7 $5 target).
- `planActions("needs_reply")` returns `[]` (`packages/core/src/triage/planners.ts`). Draft kinds: `delegation`, `clarification`, `reminder` (`triage/payloads.ts`). `clarification` already replies to the sender (`In-Reply-To`, `Re:` subject, quote, noreply check): the nearest model for a `reply` kind.
- The message is rebuilt from the payload at commit and at send (`actions/drafts.ts` `buildDraftMessage`, D8). Plain text only. `From` = the mailbox address.
- `organizations.style_text` is the signature only (`outgoing/message.ts:78–79`), edited in `apps/web/src/components/settings/SignatureCard.tsx`. It is per organization, not per mailbox.
- Approval TTL 48 h after `notified_at`; a send never shown to an owner expires after 7 days `not_notified` (`actions/constants.ts`).
- `emails` has `to_addresses`, `cc_addresses`, `thread_key`, `in_reply_to`, `references_header`, `body_text`; no IMAP flags (`\Answered` is not stored; E3a adds a flag store, notes/2026-11-13-control-surface-facts.md).
- Interia: a draft APPEND keeps the `x-ea-action-id` header, and RFC822.SIZE = the raw length (notes/2026-11-07-send-approval-facts.md). Size + header can detect a draft that the user changed in the mail client. Not checked: how the Interia webmail and phone app show an APPENDed reply draft (in the thread or only in Drafts).
- `LLM_DAILY_CAP` (300) is per mailbox per day and counts every LLM call (`docs/architecture.md` §4.1 rule 8).

## Market and security (web, read 2026-11-13; vendor text is marketing)

- Fyxer: a draft for every mail labelled "To do"/"To respond"; none for FYI, newsletters, notifications, mail before setup. Drafts sit in Drafts and in the thread with conversation view. At connect it reads about 300 sent mails and writes editable "Writing style" instructions. Unused drafts are deleted after a user-set period. Fast threads can stack drafts. (support.fyxer.com "How Fyxer drafts your emails"; docs.fyxer.com "Work with drafts", about 2026-03.)
- Superhuman Auto Drafts 2.0 (2026-07-14): a draft for every message that needs a reply; style per recipient from sent mail; drafts "keep themselves up to date"; "60% are sent unedited", "40% sent within 1 day" (blog.superhuman.com/auto-drafts-2-0; TechCrunch 2026-07-14).
- Inbox Zero: "To Reply" label plus a draft in Drafts (docs.getinboxzero.com).
- Microsoft 365 Copilot, CVE-2026-55145 (fixed 2026-07-14): a hidden instruction in an external mail made Copilot append a summary of the inbox or a OneDrive file to a reply draft, after 50 empty lines, out of view. Fix: external mail goes to a less-privileged agent first. Lesson: the writer must see only the thread it answers; collapse empty-line runs; show the full body on approval (enklypesalt.com "Context Collapse, Part 2", 2026-07-14).
- Black Hat USA 2026 (2026-08-06): an injected mail made an agent put a token into an HTML draft; viewing the draft leaked it through CSS. Lesson: plain-text drafts only (securityaffairs.com, 2026-08-09).
- Proton Bridge: drafts APPENDed over IMAP were not linked to the thread in the webmail even with `In-Reply-To`/`References` (github.com/ProtonMail/proton-bridge PR 526). "Draft in the thread" depends on the provider.
- Polish: a formal greeting is a gendered vocative ("Szanowny Panie" / "Szanowna Pani"); with an unknown gender a neutral form is needed (lukrena.com docs; elon.io Polish grammar). A risk for off-tone drafts (M3).

## Added by the E6 discovery session (2026-11-13, code at `f63f41d`)

- The send path never looks at the Drafts copy before SMTP: `actions/send.ts` calls `locateByActionId` only in Sent (for the copy and for crash recovery). A user who sent the system's draft from the mail client and then taps Send in Telegram gets a second mail today. ADR 0033 draft adds a hash check before every system send.
- Expiry, reject and send remove the Drafts copy found by `X-EA-Action-Id` (`actions/drafts.ts` `removeDraft`) without comparing its content. If a mail client keeps the header on an edited draft, the system deletes the user's edit. ADR 0033 draft: remove only an unchanged copy.
- `from.name` of every outgoing mail is the organization owner's display name for every mailbox (`actions/committer.ts` `loadFacts`, `core/outgoing/message.ts`). A mailbox has no owning user (`mailboxes` has `org_id` only).
- Decisions and the full design: `docs/product/stage-2/epics/E06-reply-drafts.md` § Discovery and `E06-discovery-notes.md`.
