# F118 stage 13 — Papers, docs, ADR

Part of [`../plan.md`](../plan.md). Needs 12. Checkpoint B follows.

Carry-over reads: `plan.md` (all decisions); `docs/decisions/0032-phone-channel-push-and-telegram-detail.md`; `packages/core/src/web/terms.ts` (`TERMS_HISTORY`), `packages/core/src/legal/subprocessors.ts`, the legal pages and `apps/web/src/lib/legal-version.test.ts`; `docs/capabilities/digest-and-notices.md`, `web-panel.md`; `docs/code-patterns.md` § Notices are facts.

## Step 1 — Papers

- **Goal:** the papers name the push services and the Telegram detail levels (E9 notes §4, E7 row).
- **Decisions:** a subprocessor row `web-push`: "Google (FCM), Mozilla, Apple, Microsoft push services: receive an encrypted notice with a kind, a count and an id; they cannot read it." The privacy text: Telegram gets mail content only in `full`, which the user turns on; `minimal` sends counts and links. A new `TERMS_HISTORY` entry with today's date and the new digest. Do not change `tg_consent_text` or `TELEGRAM_CONSENT_VERSION` (D13): the level texts are the panel texts of stage 12, so a linked user keeps their loop consent. Texts en and pl.
- **Test:** `legal-version.test.ts` passes with the new digest; the subprocessor list test includes `web-push`.

## Step 2 — Docs and ADR

- **Goal:** the docs say what the code does now.
- **Files and content:**
  - ADR 0032: status `accepted` (F118), with a "Built" line per point and the D-decisions that refine it (D6 groups, D9 session end, D19 host list).
  - `docs/capabilities/digest-and-notices.md`: rules for push rows, the push sender, routes per group, `minimal`, the detail at send time; the job `channels.push` in Entry points; Data (`push_subscriptions`, the new columns); Limits (no push for digest and reports; iOS untested); Tests.
  - `docs/capabilities/web-panel.md`: the device card, the routes, the public paths, the manifest and worker rule (never `/api`).
  - `docs/code-patterns.md` § Add a notice kind: step 1 also needs `telegram.minimal`, a phrase in `texts/minimal.ts`, and, for a kind in a group, a push renderer and `noticeFactsOf`.
  - `docs/architecture.md`: the outbox row (channel `push`, `push_subscription_id`, detail `minimal`) and the env keys `VAPID_*`.
  - `deploy/README.md`: owner steps to make VAPID keys (`bun run push:keys`), and "Tailscale on the phone to open the panel; the push arrives without it".
- **Test:** the docs tests that exist (link checks, capability page checks) pass.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** `docs/product/stage-2/03-product-frame.md` §4 (the owner writes that line, PD-092); `docs/owner-decisions.md` (coordinator).

## Checkpoint B (owner, after the land)

Owner steps O4–O5 in `questions.md`: deploy; flags `web_push` and `telegram_minimal` on for the pilot org; a planted urgent mail gives a push on the phone within the M5 target and its tap opens `/activity?category=urgent`; a test member linked with `minimal` gets counts and links only. Pass → the coordinator closes F118.

## Carry-over from the stage 02 review (2026-11-18)
See `../review-2.md` (the lines for stage 13).

## Gate note (from the stage 08 review, PASS 7c500177)
The sub-processor registry has no push row. Proposed row (adds the clear-text urgency header the stage 13 draft lacked): id `web-push`; name "Browser push services (Google FCM, Mozilla, Apple, Microsoft)"; purpose "Deliver phone and browser notices"; dataReceived "an encrypted message (kind, count, item id, language) that they cannot read; the device push address; the time, size, lifetime (24 h) and urgency (high or normal) of each message; the operator contact in the VAPID token"; personalData true; activeWhen env `VAPID_PRIVATE_KEY`; texts in en and pl. The new row changes the legal digest (`legal-checks.ts:80`), so this stage bumps `TERMS_VERSION` and adds a `TERMS_HISTORY` entry. Update claims.md C182/C195 too. Gate G-papers: `web_push` only for the owner's pilot org until this stage lands.
