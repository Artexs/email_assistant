# Product frame (Stage 2)

> Status 2026-11-12: proposed by the review session (Fable 5.1). Not accepted by the owner yet. Every later Stage 2 document checks against this page. The owner's words are in `~/.pi/agent/notes/2026-11-12-handoff-stage2-plan-review.md` § "The user's words".

## 1. Boundary: sell-ready, not sold

The product is built, tested, documented and operated as a real product for other people. It runs only on the owner's home VPS, for the owner's organization and test organizations. There is no real customer, billing account, company or lawyer. Each feature must meet the bar a paying customer would set.

In scope: everything a buyer or an auditor would expect to see. Out of scope: sales, a billing provider, hosted production, a lawyer, real customers. The deploy must be portable (a documented, once-tested install on a clean server).

## 2. Positioning (the thesis)

**An executive's assistant that makes sure nothing slips, on any mailbox.**

The product is not an "inbox zero" tool. Founders and executives name dropped follow-ups and the fear of missing something as the real cost of mail, not the unread count (market input: `04-review-result.md` §3). The product therefore owns three jobs, in this order:

1. **Nothing slips.** Urgent mail reaches the user in minutes. Delegated work, waiting replies and promises are tracked and chased.
2. **Less time in the inbox.** Noise (spam, notifications, newsletters) leaves the inbox automatically, with proof. Reply and delegation drafts wait for one tap.
3. **Trust and privacy.** Every action has a reason, a confidence and an Undo. The system never sends without a tap. Mail stays on the user's server and in the EU.

What makes it different from Fyxer, Superhuman, Inbox Zero, Slashy: any IMAP provider (Interia, WP, Onet, home.pl, own domains) plus Microsoft 365 and Gmail later; Polish and English; self-hosted; tracked delegation with a chaser as a first-class feature.

## 3. Users

| User | Who | What they need |
| --- | --- | --- |
| Executive (primary) | Owner or manager of a Polish or EU SME, 50–200 mails a day, mail on an own-domain IMAP host, Interia, or Microsoft 365 | A short "needs you" list, proof that delegated work moves, drafts ready to tap, control from the phone |
| Executive assistant (secondary, later) | Runs the executive's inbox and rules | Reviews drafts first, manages delegates and rules |
| Operator | The person who runs the service | Health, cost, per-organization status, a safe way to pause an organization |

Stage 2 serves the executive and the operator. The assistant role keeps its place in the data model and gets its own flow in Stage 3.

## 4. Product principles (unchanged from `spec/vision.md`, restated as rules for Stage 2)

- The LLM proposes, code checks, the user decides. No send without a tap on the exact rendered mail. An edit invalidates the approval.
- Every automatic action is earned: a category gets `auto` only after it passes the go/no-go bar on measured data, and the user sees that number.
- Every decision shows its reason and confidence. Every mailbox change has Undo.
- Hard rules (whitelist, VIP, blocklist) run before the AI. Whitelisted mail is never spam.
- Mail text is untrusted input: never a recipient, folder, command or rule.
- Every user action is a channel-neutral API command, so Telegram, the panel, a PWA and a later agent share one path.
- Privacy by construction: logs, Telegram and error reports carry ids and counts, not mail content.

## 5. Success metrics (Stage 2 exit)

Measured on the simulated week (E2) and reported weekly on real mail.

| # | Metric | Target | Why |
| --- | --- | --- | --- |
| M1 | Missed important mail: `urgent` or `needs_reply` that the user found by themselves (false negative) | < 2% of such mail | The core promise, "nothing slips" |
| M2 | Open loops closed on time: delegations and waiting-for-reply threads that got an answer or a chaser before their due date | ≥ 90% | Tracked follow-up is the differentiator |
| M3 | Serious mistakes per week: wrong auto move of important mail, off-tone or wrong-recipient draft, bad delegate | < 2 per user per week | Trust; one bad send costs more than ten saved minutes |
| M4 | Handled share: mail that left the inbox without the user, not undone within 7 days | ≥ 80% | Time saved (noise removal); the old main metric, kept as a secondary one |
| M5 | Urgent notice latency | < 5 min | Matches the market's "minutes, not hours" |
| M6 | Time to value: connect → first useful digest | < 1 h; first "what I would have done" report after 3 days | Onboarding and demo |
| M7 | Unit cost per mailbox per month (LLM + hosting) at 200 mails/day | ≤ 20% of a placeholder price of $25 (≤ $5) | Sell-ready economics; competitors charge $20–49 per user |
| M8 | Per-category precision on the simulator and on real labels | ≥ 98% for any category on `auto`; ≥ 90% for the rest | The go/no-go bar, now with recall reported too |

## 6. Non-goals for Stage 2

- Real sales, billing provider, hosted production, legal review by a lawyer.
- Auto-send of any mail, auto-booking of meetings.
- Calendar and meetings, the conversational agent and voice (Stage 3), native mobile app before a PWA, EA review flow (Stage 3).
- Event sourcing, a vector database before the evals show a gain, mail analytics dashboards, snooze.
- Enterprise identity beyond OIDC (SAML, SCIM) before a real organization asks for it.

## 7. Stage 2 exit criteria

- Every value category passes go/no-go on the simulator; `notification` and `spam` pass on real mail; M1–M8 are measured and reported weekly.
- The panel covers every user action (delegates, delegation dashboard, approvals with edit, "why" per decision, autonomy per category).
- Waiting-for-reply tracking and reply drafts work end to end on the simulator and on the pilot mailbox.
- Login, delete, export, legal drafts, cost model, operator console, send limits: done. A clean-server install from the README works once.
- Logs are structured and searchable; the five SLO alerts fire to the operator chat; a restore drill passed.
- A security-and-data page, a pricing placeholder, user docs and a demo from the demo organization exist.
