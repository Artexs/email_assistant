# F115 stage 17 — Docs and ADR

Part of [`../plan.md`](../plan.md). Needs 01–16.

The docs say what the code does (PD-009). No code change except a doc test that fails.

## Step 1 — Capability pages

- **Goal:** a new page `docs/capabilities/reply-drafts.md` in the shape of the others (What it does now, Rules, Entry points, Data, Limits, Decisions, Tests), checked against the code at the stage's `HEAD`. It covers: the gates (flag, switch, mode), eligibility reasons, the requests and their states, the drafter (context, checks, gaps, retry, cap share), the thread rule, the lifetime and close reasons, the pre-send pass, Telegram review and taps, the panel, samples, outcome counts, log events.
- **Also:** `deploy/README.md` § Reply drafts: turn on (flag, switch), turn off, and Roll back (flag off first; before `deploy/rollback.sh` to a release older than stage 03, an SQL that sets pending `outbox` rows of `replies_ready`, `reply_prompt`, `reply_result` to `failed`; no `db:rollback`). `drafts-and-send.md` (kind `reply`, the copy hash for every kind, the card line, the new reasons; remove the "PD-076 changes it" limit), `sent-mail.md` Limits (the pass before a system send exists now), `digest-and-notices.md` (`replies_ready`, `reply_prompt`, `reply_result`, the digest line, the Draft reply button), `web-panel.md` (reply kind, style card, samples), `retention.md` and `account-data.md` (the new columns), `triage.md` (`suspicionOf`), the capability `README.md` index.

## Step 2 — Architecture and ADR

- **Goal:** ADR 0033 status → "accepted (F115, <date>)". `docs/architecture.md` §4.5 loses "Do not send the draft from your mail client" and gains the hash check; §7 "The template" becomes "templates for delegation, clarification and reminder; checked free text for replies" (ADR 0033 Consequences). `docs/modules.md`: module `replies` (layer 3, its edges) and the `channels` table rows for the new kinds; `docs/architecture.md` §5 outbox rows (kind, dedup key). The module graph is current (`bun run graph:modules`).
- **Test:** the docs tests that exist (`layers.test.ts` graph check, any capability-map test) pass.
- **Check:** `bun run graph:modules` leaves no diff, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the epic page and `docs/product/stage-2/*` (the coordinator).
