# F118 stage 12 — Settings cards

Part of [`../plan.md`](../plan.md). Needs 11. No migration.

Carry-over reads: `plan.md` D7, D12, D13, D14; `interfaces.md` (routes of stages 06 and 11); `apps/web/src/components/settings/NotifyCards.tsx`, the Telegram link card, the org cards in `SettingsPage.tsx`; `docs/code-patterns.md` § Texts carry a locale.

## Step 1 — Telegram detail in the link card

- **Goal:** the link step shows two choices with their words, `minimal` preselected (P1); the linked card shows the current level and a change button.
- **Texts (en; pl too):** "Counts and links only (recommended): Telegram gets how many items wait and a link to the panel. No sender, subject, summary or draft." / "Full: Telegram gets the sender, subject, AI summary and drafts, with Send buttons. Telegram stores these messages on its servers." `full` needs the existing consent tick and text. Locked → the `full` choice is disabled with "Your organization allows only counts and links."
- **Test (e2e, flag on through the seed):**
  1. The link dialog has `minimal` checked by default; picking `full` without the tick keeps the link button disabled.
  2. A linked member switches to `minimal` → the card shows "Counts and links only".
  3. `expectNoA11yViolations`.

## Step 2 — Org lock card and route choice

- **Goal:** the owner sees a switch "Telegram: counts and links only for everyone" (members see the state, read only). With `web_push` on, the notify card shows three selects (Urgent mail, Approvals, Updates) with Telegram, Phone, Both and a "(default)" mark from `routeDefaults`.
- **Decisions:** the card sends a value only for a select that the user changed; an untouched select keeps following the default (D7). A member without a chat and without a device sees the hint to link Telegram or turn on phone notices.
- **Test:**
  1. (unit) the select model: stored none and default `both` → shows "Both (default)"; stored `push` → "Phone".
  2. (e2e) the owner turns the lock on → the member's link dialog has `full` disabled; the member sets Urgent to Phone → `PATCH` sent with `{ routes: { urgent: "push" } }`.
- **Check:** the touched tests, `bun run web:build`, then the Proof with the e2e step as in stage 04.
- **Done when:** the Proof with the e2e step prints `PROOF_OK`.
- **Out of scope:** papers and docs (13).

## Carry-over from the stage 11 review (PASS 2d2984bf)

First commit of this stage (each with a test and a mutation log):
- Link route default (coordinator decision, replaces the stage 11 rule): when `detail` is absent, KEEP the stored value (the column default is already `minimal`, so new members still get `minimal`). Change test 1 of `web-telegram-detail.test.ts`. Reason: an old cached panel bundle (D15) must not drop a pilot member from `full` to `minimal`. The stage 12 card always sends `detail`, preselected from the stored value.
- TG1: a user in two organizations: add review probe P1 to `web-telegram-detail.test.ts` (PATCH changes only the row of the session org; the lock route answers 403 where the user is not owner) and a repo-level test of `setMemberTelegramDetail` with a scope-free `db` (mutation m08: no `org_id` filter in the UPDATE survives today).
- NOTE 1 (hardening, small): read the org row `FOR SHARE` inside the transaction of `changeTelegramDetail` and the link route, and check the lock again there.
- NOTE 3: with the flag off the link route answers 400 to a bad `detail`; ignore the value instead, as the stage 11 file says.
- NOTE 4: `renderNoticeEdit` has no length check; with the panel link line a card near 4096 characters could be refused by Telegram. Cut or check the length (fall back to the text without the link line).
- NOTE 2 (cosmetic): link route checks consent before the lock, PATCH checks the lock before consent; make the order equal.
