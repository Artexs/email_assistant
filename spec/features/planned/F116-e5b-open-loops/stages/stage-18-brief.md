# F116 stage 18 — "Needs you today" brief

Part of [`../plan.md`](../plan.md). `[risky]` (privacy, new Polish text). Needs stages 14 and 17.

## Step 1 — Sections (core)

- **Goal:** `loopSections` and `renderBrief` (`interfaces.md`) in `packages/core/src/loops/`, used by `renderDigest` when the input has a `brief`.
- **Decisions (D16, PD-125):**
  - Order: 🔴 Urgent · ✍️ Waiting on you · ⏳ Waiting on others · 🤝 Promised, then today's digest form. An empty section is not shown; no section → no brief header.
  - 🔴 Urgent: urgent mail of the digest window without an own answer; those rows leave the normal list.
  - ✍️ Waiting on you: `needs_reply` mail of the last 14 days without `\Answered` and without a user `sent_emails` row later in its thread; oldest first. Line: "✍️ Jan Kowalski · Oferta Q1 · 3 d".
  - ⏳ Waiting on others: open `waiting` and `delegated` loops and open delegations (`sent`, `overdue`) with a due by the end of the local day; oldest due first. Line: "⏳ No answer from anna@example.test since Tue 10.11 · Offer for Q1" (`text`, else the subject); markers: "auto-reply only", "would draft a follow-up" (shadow), "follow-up waits for your approval".
  - 🤝 Promised: open `promised` loops due by the end of the day: "🤝 You promised anna@example.test: send the offer · due Fri 20.11".
  - Each section: at most 5 lines, then "+n more in the panel" (with the link when `WEB_BASE_URL` is set).
  - One line per loop closed `stale` with `stale_notified_at` null: "⌛ Closed without an answer: Offer for Q1".
  - 4096 cut: normal rows go first, then loop lines from the bottom section up; a cut loop line counts into its section's "+n".
  - Consent (D17): for a user that `consentCovers` does not cover, ⏳ and 🤝 show one count line each and "Confirm the new Telegram terms in the panel to see them here."; the ⌛ lines show only their count (review G12); ✍️ and 🔴 hold incoming-mail data only and show.
- **Test (unit, pl and en, Warsaw, now Fri 2026-11-20 08:00):** T1 2 urgent, 7 waiting on you, 3 loops, 1 delegation, 1 promise → the four sections in order, ✍️ with 5 lines and "+2"; T2 the exact Polish lines of each kind (fixed values in the test; date "wt. 10.11"); T3 a 4096 overflow drops normal rows first, then the last 🤝 line, with "+1"; T4 an uncovered user → count lines, no address, no loop subject and no loop text in the message (also for a ⌛ line); T5 shadow → "would draft a follow-up".

## Step 2 — Build and send

- **Goal:** the digest job adds the brief to the first digest of the member's local day and a count line to the later ones.
- **Decisions:**
  - First of the day = no `digest` outbox row of that user earlier on the same local date (F7). The job computes it in the transaction that queues the digest.
  - The digest job in `channels` reads `consentVersionsOf` and passes `loopConsent: boolean` per member into `reports.buildDigestMessage` (`reports` may not import `channels`, review G7). `reports` builds the brief input from `briefLoopsOf` (`loops`) and a new reader `listWaitingOnYou(db, ctx, mailboxIds, { since, now })` in `triage` (the ✍️ rule); only for orgs with `open_loops` on. Flag off → today's digest, byte-equal.
  - The first digest drops the delegation footer (⏳ has it); later digests keep it and add "Open loops: 3 waiting, 1 promise due".
  - In the queue transaction, every loop shown as a line gets `surfaced_at` when it is null, and every shown stale loop gets `stale_notified_at`.
  - Quiet hours: digests are never held (as today); no new instant notice.
- **Test (integration, fixed clock):** T6 slots 08:00 and 16:00 → the 08:00 digest has the brief, the 16:00 one the count line; T7 the 08:00 slot missed and the 16:00 one sent → it has the brief; T8 `surfaced_at` set once, a second digest leaves it; T9 flag off → the text equals today's render.

## Check

`bun test packages/core/src/digest packages/core/src/loops apps/server/test/integration/reports-digest.test.ts`

## Done when

T1–T9 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s18`).

## Out of scope

Buttons on these lines (19).
