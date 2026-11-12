# Project review and next steps (2026-11-12)

Source: a full read of `docs/product-brief.md`, `spec/vision.md`, `docs/roadmap.md`, `spec/build.md`,
`tasks/active/s6-pre-sale.md`, `tasks/planned/s6*.md`, F077 ticket and plan, F025 (S1b results), F037, F047,
the 34 planned tickets, `docs/known-alerts.md`, and a size count of the code. Nothing here is decided. The owner decides section 5.

## 1. Short verdict

The engineering is strong. The product proof is weak.
The system is built far past the MVP plan, but the core promise (find urgent mail, delegate work, save the executive's time)
has almost no evidence on real mail. The S6 plan adds more production shape (login hardening, Polish UI, legal drafts)
for zero outside users. Recommendation: finish F077, then prove the core value before S6b, S6c and S6e.

## 2. What is good

- Clear product source of truth (`docs/product-brief.md`), 17 ADRs, a vision file, notes for each learned fact.
- Safe design: plan, policy, commit; never send without a tap; Undo for each change; Zod on every LLM answer; injection evals.
- Multi-tenant from day one; encrypted credentials; audit log; retention job (F077).
- Slices S0–S5 each ended with something that runs on the home VPS on real mail.
- Test discipline: 232 test files, integration DB per job, Playwright, fake Telegram, AgentMail test traffic.

## 3. Findings

### 3.1 The pilot cannot prove the product (most important)

- S1b go/no-go (F025, 123 real labels, 180 days): `notification` 96.2% (52 rows), `spam` 83.6% (67 rows).
  `urgent`, `needs_reply`, `info`: **1 row each**. `delegation`: no real row. Every category is no-go at the 98% bar.
- The pilot Interia mailbox gets fewer than 100 real mails in 30 days, mostly notifications and spam.
  The target user gets up to 200 mails a day, mostly business mail.
- So the four categories that carry the product value (urgent, needs_reply, delegation, info summary) are measured only on synthetic cases.
- `notification` runs `auto` with `--force` below the bar (F037). This is a fair pilot choice, but it is not proof.
- F047 part A (the first real delegation round trip: draft, tap, SMTP send, reply, reminder) **never ran**. S4 is proven only on GreenMail.
- F037 and F047 part B (the one-week counts) end 2026-11-14. Their results are not in yet.
- F033 / F042 (the "handled share" metric, the product success metric, target 80–90%) are not built. Nothing measures the main KPI.

### 3.2 The documents disagree on the goal

- 2026-11-12 scope change (`tasks/active/s6-pre-sale.md` § "Scope change"): educational, production-shaped, home VPS only, no outside customer.
- `docs/product-brief.md` Q1 still says "a product (SaaS) for sale"; §5 still lists hosted EU server and Vertex AI for customers.
- `spec/vision.md` "Current direction" still says "so the first external customer can sign up … runs in the old flow". Both are stale (vision is owner-owned; the coordinator only proposes).
- `docs/roadmap.md` row S6 has the new scope, but §1 "Sellable MVP" and §5 (billing gate, Vertex before customers) keep the old one.
- Effect: each new agent reads two goals. S6b still carries "public login" decisions (enumeration, HIBP, lockout mails) that serve a public internet exposure that the owner cut.

### 3.3 S6 effort does not match the new goal

With no outside user and the panel behind Tailscale:

- S6b (lockout, HIBP, lockout mails, session list, terms dialog, auth-mail sender built but off): high cost, little value. Hashed reset tokens (F059) already landed. Keep the cheap items (mail host address check, session list); defer the rest.
- S6c: `delete_organization` and `org:export` have value (GDPR shape, test of tenant isolation). The full Polish UI has value only if a Polish user uses the panel; the owner is that user, so it is a choice, not a need.
- S6e: legal drafts with "DRAFT, not legal advice" have learning value but no product value now. The cost model has real value (it needs real volume data, see 3.1).
- S6f: high value. CI green, env split (F021), a verified Backblaze restore. These protect the one real production system.

### 3.4 Size and process cost

- Estimate (roadmap §3): 10–16 thousand lines with tests. Actual: about 41 thousand lines of source and 100 thousand with tests; 14 migrations; 635 commits.
- Plans are very heavy (S6 master plan 340 lines, D1–D33, P1–P24, A1–A30; F077 has 18 stages). Each segment gets a cold review that finds 20+ items.
  This finds real bugs, but it also builds detail for scenarios that do not exist (second customer, suspended org, public login).
- Two workflows live side by side (`tasks/` for S6, Limen for the rest). `spec/build.md` NEXT is empty. 34 planned tickets have no order.
- `docs/known-alerts.md` is 755 lines; two flaky CI timing tests keep CI red (S6f fixes them).

## 4. Recommended order

### Now (finish what is open)

1. F077 stage 18: checkpoint, group review, deploy to the VPS with the owner's go. This closes S6a.
2. 2026-11-14: run F037 and F047 part B. Run F047 part A (one real delegation round trip, about 15 min on the phone). Without it, S4 is not proven.
3. Make the docs agree: update `product-brief.md` Q1 and §5, `roadmap.md` §1 and §5 to the 2026-11-12 goal. Propose the `spec/vision.md` text to the owner.
4. Fill `spec/build.md` NEXT with an order, and move S6b–S6f into Limen tickets, so one workflow remains.

### Next (prove the core value; this is the real MVP gap)

5. Real evaluation data for the value categories. Options, best first:
   a. Connect a second, busy mailbox (a work or business mailbox of the owner) in `shadow` mode for 2–4 weeks. This is what F077 makes possible. Label with `/review` (F028, small).
   b. A public business-mail corpus (for example the Enron set, English) as a labeled eval set for `urgent`, `needs_reply`, `delegation`.
   c. AgentMail personas that send realistic executive mail at realistic volume (Polish and English), including delegate replies (F065, F066).
6. Build the KPI: F033 + F042 (handled share in the weekly digest). Then each change has a number.
7. Classifier work driven by 5 and 6: F061 (folder hint), per-category thresholds, a stronger model for `urgent` only if the data shows it.
8. Then the cost model of S6e (it needs the volume data of step 5).

### Then (production shape that protects real data)

9. S6f: CI green, env split (F021), Backblaze restore test, ADR 0019.
10. S6c: `delete_organization` and `org:export` only. Polish UI: owner's choice.
11. S6b: the mail host address check and the session list only. Defer lockout, HIBP, terms dialog and the auth-mail sender until a public exposure is planned (they stay ready as a ticket).
12. S6e legal drafts: optional, as a learning item.

### Phase 2 candidates (after the core value is proven)

- Gmail and Microsoft 365 by OAuth (F048): the largest reach gain; most business users are not on Interia. For a self-hosted single user, Gmail OAuth in "testing" mode needs no Google verification (up to 100 test users).
- Web approvals and content-minimal Telegram (F075): better privacy story.
- Reply drafts for `needs_reply` (now only delegation and clarification drafts): high user value; uses the style text.
- Send the draft as the user edited it (F043).
- Thread view and digest quality (summaries per thread, not per mail).

## 5. Decisions for the owner

1. Goal: is the project "educational, production-shaped, self-hosted" for good, or is "sell later" still a goal? The answer decides S6b and S6e depth.
2. A second, busy mailbox in `shadow` mode for real evaluation data: yes or no, and which one.
3. S6 depth: the cut in § 4 (do S6f and part of S6c; defer most of S6b and S6e), or the full plan.
