# F110 stage 14 — Report page and onboarding step

Part of [`../plan.md`](../plan.md). Web stage. Polish text: review by `claude-opus-5-5`.

## Step 1 — The "what I would have done" page

- **Goal:** a panel page that shows the history check and offers "Turn on recommended" (P2, PD-032; the E10 demo artifact).
- **Files:** new `apps/web/src/pages/report.astro` and island `ReportPage.tsx`; nav entry only behind `trust_ladder` (keep the phone tab bar at ≤ 5 tabs: the report goes in the Settings header or the onboarding flow, not a new tab); page keys en and pl.
- **Decisions:**
  - Reads `GET /api/trust/:mailboxId`; a mailbox select when the org has several (default: the newest connected).
  - States: no check → "Starting the check…"; `queued` … `classifying` → "Checking your last 30 days… (<n> of up to 500 mails)" and polls every 30 s (polling, no live updates: F055 out of scope); `no_result` → one sentence per `no_result_reason`, "The test results alone decide", and the recommendation part below (review 1 T8); `done` → the content below.
  - Content per moving category: the count checked, the count it would move, the history outcome sentence, the global line (as the card, stage 13), and for a `fail` up to 3 example mails (sender name, subject, date; no link: history mail has no Activity row, review 1 N10).
  - One primary button `Turn on recommended (<categories>)` for owners, in the `done` and the `no_result` state, when at least one is recommended and not on; it calls the stage 11 route, then shows `turnedOn` and the new mode. Members see the text, not the button. Nothing recommended → no button, a sentence why.
  - Under it, the optional suggestion: "Want to check 10 decisions yourself? It is optional." linking to the panel review (stage 15; hide the link until stage 15 lands — the stage 15 worker turns it on).
  - Owners get `Check again` in an end state (the stage 11 `history-check` route; hidden while one is open).
  - The page states once that the check read the last 30 days of INBOX read-only and changed nothing (Q8).
  - No `is:inline` script, no `on*=` attribute (ADR 0016).
- **Test** (new `apps/web/e2e/tests/report.spec.ts`):
  1. Flag on, a seeded `done` check with `notification` recommended and `spam` failed → the page shows both; the button names `notification`; tap → `auto` on and mode `assist` (read back from the API).
  2. A seeded `classifying` check → the progress text.
  3. Member login → no button.
  4. A seeded `no_result` / `no_history` check and a fixture non-provisional `go` for `notification` → the button shows; tap → `notification` on.
  5. `expectNoA11yViolations`, `cspErrors` empty.

## Step 2 — Onboarding step change

- **Goal:** with `trust_ladder` on, onboarding leads to the report instead of the bare mode choice.
- **Files:** `packages/core/src/web/onboarding.ts` (`onboardingOf` gains `report: boolean` = a `done` or `no_result` check exists, and `channel: boolean` = Telegram linked or `report_channel` is `mail`); `OnboardingPage.tsx`; the server that builds the input.
- **Decisions:** flag on: steps mailbox → report channel (Telegram or mail, stage 18 sets `mail`) → "See what I would have done" (link to `/report`) → rules. `done` = mailbox, channel and report. The mode step goes: the report's button is the mode choice. Flag off: as today.
- **Test:** unit `onboarding.test.ts`: flag on, mailbox and Telegram, no check → `done` false; with a `no_result` check → `done` true. Flag off → today's cases pass.

## Done when

- `csp checked in` counts one more page than before.
- Proof (`s14`, with the web part) prints `PROOF_OK`.

## Out of scope

"Show 3 sample drafts" (E6a, PD-071). The panel review itself (stage 15).
