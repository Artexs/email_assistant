# Product brief — AI Email Assistant

> **Accepted 2026-11-01.** Built from the old docs in `.ai/` and the user's answers (section 4).
> This file is the product source of truth. The `.ai/` files are history: read them for detail, not for decisions.

## 1. Problem and users

- **Problem:** executives spend too much time on email. They sort, forward and answer mail by hand. They can miss critical mail.
- **Primary user — Executive ("Prezes"):** wants a clean inbox, only important items, proof that delegated work is followed up.
- **Secondary user — Executive Assistant (EA):** configures rules, checks drafts, handles the manual folder.
- **Product value:** time saved and trust. The user must always see what the system did and why.

## 2. What the old docs already decided

| Topic | Decision | Source |
|---|---|---|
| Tenancy | MVP serves one tenant. Multi-tenant SaaS is the goal (**changed:** schema is tenant-aware from day one, see section 5). | `ddd/szczegółowe_…` "Skalowalność" |
| Roles | MVP merges Executive and EA into one "power user" account. Separate roles later. | `ddd/szczegółowe_…` "Role" |
| Mailboxes | One account can have many mailboxes. Replies go from the mailbox that got the mail; new mail from the primary one. | `prd.md` 3.1 |
| Processing | Fetch new mail every ~5 min, process at once, store results. Show results at fixed times (10:00, 14:00) + on demand. | event storming 1–2 |
| Categories | One physical folder per email, many tags. Priority: Urgent > VIP > Delegation > Meeting > Info > Spam. | event storming 4–5 |
| VIP / whitelist | VIP is a priority modifier, not a category. Whitelisted mail is never spam (hard rule, before AI). | event storming 8, `prd.md` US-006 |
| Low confidence | AI confidence < 70% → "Manual Handling" folder. | `prd.md` 3.2 |
| Manual Handling folder | Write-only: the system puts mail there and never touches it again. | `ddd/szczegółowe_…` |
| Delegation | A: delegate found → delegation draft + track (**changed:** send only after approval, Q5). B: data missing → draft with questions. C: no delegate → Manual Handling. | event storming 9 |
| Follow-up | Overdue delegations go to the report. The user can send a reminder (one or all). | event storming 20–22 |
| Meetings | MVP: conflict case only (propose 3–5 free slots). Auto-booking is Phase 2. Google Calendar first. | `ddd/szczegółowe_…`, HS9 |
| Info mail | AI summary (about 3 sentences), save it, archive the mail. | `prd.md` US-007 |
| Report | Sectioned: URGENT → NEEDS ACTION → DONE AUTOMATICALLY → REMINDERS. | event storming 14 |
| Control | Global "test mode" (drafts only, no send). Moving mail still works in test mode. ON/OFF switch per action. | `ddd/szczegółowe_…` "Testowanie" |
| Onboarding | Not blocking. The system starts at once; a checklist suggests the optional setup. HS13 suggests 1 week dry-run. | `prd.md` US-001, HS13 |
| Channel | A chat channel is the key interface, not only the web panel. (**Changed:** Telegram first, not WhatsApp, Q4.) | `ddd/szczegółowe_…` "Komunikacja" |
| Privacy | MVP: cloud LLM API with zero retention. Final goal: local models. | `ddd/szczegółowe_…` "Bezpieczeństwo" |
| Success metric | Share of mail handled without the user. Target 80–90%. Whitelist accuracy 100%. | `prd.md` 6, event storming |

## 3. Conflicts in the old docs and how they are resolved

| # | Conflict | Resolution (2026-11-01) |
|---|---|---|
| 1 | Style learning in MVP? | Phase 2. MVP uses fixed templates + one optional style text that the user writes. |
| 2 | Two-way chat in MVP? | Full chat (intents, voice) is Phase 2. MVP Telegram has notices, the report, and buttons: approve / reject / send. |
| 3 | EA review flow in MVP? | Phase 2. The data model has roles (owner, assistant) from day one. |
| 4 | Delegation auto-send? | No. Delegation is a draft; it is sent only after the user approves it (Q5). |
| 5 | Audit log? | Yes, minimal, in MVP (Q6). |
| 6 | Manual Handling folder | MVP: write-only. Phase 2 learning may read it, but never changes it. |

## 4. Decisions of 2026-11-01 (user answers)

| # | Question | Decision |
|---|---|---|
| Q1 | Goal | **A product (SaaS) for sale to business owners and managers.** Not only an own tool. |
| Q2 | First user and mailbox | The user is the first (pilot) user, with one Gmail mailbox. |
| Q3 | MVP scope | Shadow mode → spam / info / archive → report → delegation. Phase 2: style learning, two-way chat, voice, meetings, EA review flow. |
| Q4 | Channel | **Telegram first.** A dedicated mobile app can replace or join it later. |
| Q5 | Autonomy | The system never sends mail on its own. It sends only when the user directly tells it to (approve button or explicit command). Labels, moves and archive are allowed. |
| Q6 | Audit log | Yes, a minimal append-only log in MVP (agent recommendation, accepted). |
| Q7 | Language, volume | Polish + English mail, under 200 mails per day per mailbox (default accepted). |
| Q8 | Cloud LLM, budget | **Google Gemini** (user decision 2026-11-02). Free tier for development with test data; Cloud Billing (paid tier) before real users or real emails. |

## 5. Consequences of "a product for sale"

- **Multi-tenant data model from day one.** MVP has one tenant, but every table carries the tenant (organization) id.
- **Gmail access needs Google verification.** Gmail read/modify scopes are restricted. Before the first external customer:
  OAuth app verification + yearly security assessment (CASA). Plan time and money for it.
  During development the OAuth app stays in "Testing" (max 100 test users, refresh tokens expire after 7 days).
- **Microsoft 365 / Outlook support** is likely needed for business customers (Phase 2, Microsoft Graph).
- **Security and GDPR** are product features: token encryption, tenant isolation, data retention limits,
  EU data location, a data processing agreement with the LLM provider, account and data deletion.
- **Telegram privacy:** bot messages are not end-to-end encrypted and pass Telegram servers.
  Send short notices and links, not full mail bodies. The mobile app can fix this later.
- **Channel-neutral backend:** approvals and commands go through one backend API, so Telegram and a mobile app can share it.
