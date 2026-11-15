# F116 stage 18 — "Needs you today" brief

Part of [`../plan.md`](../plan.md). `[risky]` (privacy, new Polish text). Needs stages 14 and 17.

## Step 1 — Sections (core)

- **Goal:** `loopSections` and `renderBrief` (`interfaces.md`) in `packages/core/src/loops/`, used by `renderDigest` when the input has a `brief`.
- **Decisions (D16, PD-125):**
  - Order: 🔴 Urgent · ✍️ Waiting on you · ⏳ Waiting on others · 🤝 Promised, then today's digest form. Empty sections hide; no section → no header.
  - 🔴 Urgent: urgent mail of the digest window without an own answer; those rows leave the normal list.
  - ✍️ Waiting on you: `needs_reply` mail of the last 14 days without `\Answered` and without a user `sent_emails` row later in its thread; oldest first. Line: "✍️ Jan Kowalski · Oferta Q1 · 3 d".
  - ⏳ Waiting on others: open `waiting` and `delegated` loops and open delegations (`sent`, `overdue`) with a due by the end of the local day; oldest due first. Line: "⏳ No answer from anna@example.test since Tue 10.11 · Offer for Q1" (`text`, else the subject); markers: "auto-reply only", "would draft a follow-up" (shadow), "follow-up waits for your approval".
  - 🤝 Promised: open `promised` loops due by the end of the day: "🤝 You promised anna@example.test: send the offer · due Fri 20.11".
  - Each section: at most 5 lines, then "+n more in the panel" (linked when `WEB_BASE_URL` is set).
  - One line per loop closed `stale` with `stale_notified_at` null: "⌛ Closed without an answer: Offer for Q1".
  - 4096 cut: normal rows go first, then loop lines from the bottom section up; a cut loop line counts into its section's "+n". A row's 📎 line (F109 flag `attachment_line`) goes with its row; brief lines get none (refresh 1 default).
  - Consent (D17): for a user that `consentCovers` does not cover, ⏳ and 🤝 show one count line each and "Confirm the new Telegram terms in the panel to see them here."; the ⌛ lines show only their count (review G12); ✍️ and 🔴 hold incoming-mail data only and show.
- **Test (unit, pl and en, Warsaw, now Fri 2026-11-20 08:00):** T1 2 urgent, 7 waiting on you, 3 loops, 1 delegation, 1 promise → the four sections in order, ✍️ with 5 lines and "+2"; T2 the exact Polish line of each kind (date "wt. 10.11"); T3 a 4096 overflow drops normal rows first, then the last 🤝 line,, "+1"; T4 an uncovered user → count lines; no address, loop subject or loop text (also ⌛); T5 shadow → "would draft a follow-up".

## Step 2 — Build and send

- **Goal:** the brief in the first digest of the member's local day, a count line in later ones.
- **Decisions:**
  - First of the day = no `digest` outbox row of that user earlier on the same local date (F7), computed in the queue transaction.
  - The digest job in `channels` reads `consentVersionsOf` and passes `loopConsent: boolean` per member into `reports.buildDigestMessage` (`reports` may not import `channels`, review G7). `reports` builds the brief input from `briefLoopsOf` (`loops`) and a new reader `listWaitingOnYou(db, ctx, mailboxIds, { since, now })` in `triage` (the ✍️ rule); only for orgs with `open_loops` on. Flag off → today's digest, byte-equal.
  - The first digest drops the delegation footer (⏳ has it); later digests keep it and add "Open loops: 3 waiting, 1 promise due".
  - In the queue transaction, each shown loop gets `surfaced_at` when null; each shown stale loop gets `stale_notified_at`.
  - Quiet hours: digests are never held; no new instant notice.
- **Test (integration, fixed clock):** T6 slots 08:00 and 16:00 → brief at 08:00, count line at 16:00; T7 08:00 missed → the 16:00 digest has the brief; T8 `surfaced_at` set once, a second digest leaves it; T9 flag off → today's render, also with `attachment_line` on (the F109 test stays unchanged); T10 both flags on, an urgent and an `info` mail with a PDF each → no 📎 under 🔴, "📎 1: faktura.pdf (120 kB)" under the `info` subject.

## Check

`bun test packages/core/src/digest packages/core/src/loops apps/server/test/integration/reports-digest.test.ts`

## Done when

T1–T10 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s18`).

## Out of scope

Buttons on these lines (19).

## Carry-over from stage 12 review

- The loop text (ask, subject) can hold markdown and the remains of an escape sequence: escape it in the brief and in the Telegram cards (review-12.md N6).

## Carry-over from stage 17 review

- N5: the digest reads the gate per member through the choke point of stage 11 and passes loopConsent into buildDigestMessage; N4: count only consent rows newer than the last chat.unlinked row (review-17.md).

## Carry-over from stage 11 review

- N8: add the digest sender to the consent-gate source scan on purpose (review-11.md).
