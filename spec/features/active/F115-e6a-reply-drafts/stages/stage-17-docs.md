# F115 stage 17 — Docs and ADR

Part of [`../plan.md`](../plan.md). Needs 01–16.

The docs say what the code does (PD-009). No code change except a doc test that fails.

## Step 1 — Capability pages

- **Goal:** a new page `docs/capabilities/reply-drafts.md` in the shape of the others (What it does now, Rules, Entry points, Data, Limits, Decisions, Tests), checked against the code at the stage's `HEAD`. It covers: the gates (flag, switch, mode), eligibility reasons, the requests and their states, the drafter (context, checks, gaps, retry, cap share), the thread rule, the lifetime and close reasons, the pre-send pass, Telegram review and taps, the panel, samples, outcome counts, log events.
- **Also:** `deploy/README.md` § Reply drafts: turn on (flag, switch), turn off, and Roll back: flag off first; before `deploy/rollback.sh` to a release older than stage 03, one SQL transaction (a) sets `outbox` rows of `replies_ready`, `reply_prompt`, `reply_result` in `pending` and in `sending` to `failed` (else the old claim fails its whole batch for all orgs), and (b) for a release older than stage 04 ends every open `reply` action (draft not applied, send not sent) as the expiry job ends them, reason `rollback` (else the old detector errors each run and the old committer ends them `bad_payload`); no `db:rollback`. Test the SQL on the dev DB. `docs/code-patterns.md` § The consent version: linked chats are asked again through `consentCovers` (D16). `drafts-and-send.md` (kind `reply`, the copy hash for every kind, the card line, the new reasons; remove the "PD-076 changes it" limit), `sent-mail.md` Limits (the pass before a system send exists now), `digest-and-notices.md` (`replies_ready`, `reply_prompt`, `reply_result`, the digest line, the Draft reply button), `web-panel.md` (reply kind, style card, samples), `retention.md` and `account-data.md` (the new columns), `triage.md` (`suspicionOf`), the capability `README.md` index.

## Step 2 — Architecture and ADR

- **Goal:** ADR 0033 status → "accepted (F115, <date>)". `docs/architecture.md` §4.5 loses "Do not send the draft from your mail client" and gains the hash check; §7 "The template" becomes "templates for delegation, clarification and reminder; checked free text for replies" (ADR 0033 Consequences). `docs/modules.md`: module `replies` (layer 3, its edges) and the `channels` table rows for the new kinds; `docs/architecture.md` §5 outbox rows (kind, dedup key). The module graph is current (`bun run graph:modules`).
- **Test:** the docs tests that exist (`layers.test.ts` graph check, any capability-map test) pass.
- **Check:** `bun run graph:modules` leaves no diff, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the epic page and `docs/product/stage-2/*` (the coordinator).

## Carry-over from the stage 07 review

- N6: fix the `dataReceived` text of the `openai` and `gemini` rows (`packages/core/src/legal/subprocessors.ts`), the claims C136 and C139 and the privacy text: the drafter sends the mailbox profile, the instruction and the org time zone as well; one TERMS_VERSION bump with the F107 P5 rule.

## Carry-over from stage 08

- `docs/capabilities/drafts-and-send.md` already has the bullet "Copy hash (F115 stage 08)", and the lines about mail client edits (rule 16 text and the Limits bullet) are updated; this stage re-reads them with the final behaviour and the stage 09 pass.
- The docs site pages `apps/docs/src/content/docs/explanation/never-sends-alone.mdx` and `how-to/approve-a-send.mdx` (and `pl/how-to/approve-a-send.mdx`) still say "Do not send the draft from your mail client". Rewrite them in the F107 style once the flag `draft_copy_check` is on for the pilot; the flag is default off, so a page must not state the stop as sure (`apps/docs/src/flagged-text.ts` `NO_VISIBLE_TEXT.draft_copy_check` holds the reason).
- `docs/known-alerts.md` has the entry `draft_copy_unhashed`. New events: `draft_copy_unhashed`, `draft_copy_kept`, `reply_send_checked` (code field `result`, new in `platform/log-fields.ts`).

## Carry-over from the stage 12 review (2026-11-18)

- N14: do Step 3 of stage 12 here, in one commit with the legal text batch: the reply sentence in both consent texts (en: "reply drafts that the AI writes for you, and the addresses of the other recipients of a mail (To, Cc, Reply-To) when a reply goes to them"; pl: with "(Do, DW, Reply-To)"), a bump of `TELEGRAM_CONSENT_VERSION` and `TERMS_VERSION`, `REPLY_CONSENT_SINCE` = the new consent version, and the test "an old link version gives 409, the new one links". Test `T8` in `apps/web/src/i18n/i18n.test.ts` guards the order.
- N2: until this stage lands, an owner with `reply_drafts` on gets "Confirm the new Telegram terms in the panel" and no panel version can cover reply data. Keep `reply_drafts` OFF in any pilot until this stage lands; write it in the pilot steps of stage 18 and `deploy/README.md`.
- N5: rollback text: an older release slices `approval:<id>:r1` into a bad send id (the sender throws 22P02), and it rejects the new `replies_ready` view as `bad_view`. Put both in the rollback SQL with N11 of review-9 (fail the `replies_ready` rows and the `approval:<id>:r<n>` rows that are `pending` or `sending`).

## Carry-over from stage 13

- Stage 13 changed no legal text and did not bump `TERMS_VERSION`; `REPLY_CONSENT_SINCE` is still the placeholder, so none of Redraft, Reply all, Use Reply-To and Draft reply shows to a user. The legal batch of stage 12 and 17 stands. Notes: `notes/2026-11-18-f115-s13-telegram-redraft.md`.
- Rollback text: an older release does not know the callback codes `rd`, `ra`, `ru`, `dr` (they parse to null and answer "invalid") and the audit event `reply.requested` (free text column; harmless); the views of `reply_prompt` and `reply_result` kept their shape.
- Privacy: the user's line of instruction is stored only in `reply_requests.instruction` (retention clears it); the audit row `reply.requested` holds ids and codes only; the Telegram message of the user stays in Telegram.

## Carry-over from the stage 13 review (2026-11-18)
See `../review-13.md`: rollback text N1 (strict view fields), the tap-flood cost N3 and a per-mail tap limit, the ended-request window limit N9.

## Carry-over from stage 15 and its review (2026-11-19)

- Rollback text: stage 15 added two optional strict fields to the panel read model, `ApprovalDetail.endReason` and `replyAllAdds` (item and detail), and `reply` on each activity row. A browser tab that runs the older page code rejects an answer that holds them until the tab reloads (`z.strictObject`); an older server never sends them. Write it next to the stage 13 note on strict view fields. No migration.
- Limit: a page reload while a redraft waits turns Redraft on again, and a second line gets the same `requestId` from the server (only the first line is stored). The server never refuses a redraft while one waits for the same send. A fix would be a 409 for a waiting redraft of the same send.
- Consent: stage 15 added no consent text and no panel button of its own. The panel reuses the F116 card (`TelegramLink`, `POST /api/telegram/consent`; e2e `loops-panel.spec.ts` T8). The consent sentence for reply data, `TELEGRAM_CONSENT_VERSION`, `TERMS_VERSION` and `REPLY_CONSENT_SINCE` stay in this stage (N14 above).
- Texts: the panel and the Telegram card now say "The system sent nothing." / "System nic nie wysłał." for `answered` and `sent_by_user` (a user may have sent the reply). The card text for `draft_missing` still says "Not sent: …" and was left as it is. Describe the final wording in the capability page.

## Carry-over from stage 16 (2026-11-19)

- Rollback text: stage 16 added the strict key `replyDrafts` to `weekStatsSchema` (always present in the output; the input default reads all 0). A queued `weekly_report` row (view `week`) and every `GET /api/stats` answer now hold it. An older release rejects the key: a `weekly_report` row that carries it fails the old view check (`bad_view`), and a browser tab that runs the older stats page rejects the stats answer until reload. Put it in the rollback SQL with the other view items: fail the `pending` and `sending` `weekly_report` rows before the rollback (the next Monday queues a new one). The new routes `POST` and `GET /api/mailboxes/:id/reply-samples` are unknown to an older release (404). The audit event `reply.requested` now also has `trigger: "sample"` (free text column; harmless). Sample requests are `reply_requests` rows with `trigger = 'sample'`, a value that exists since stage 03 and that the drafter handles since stage 07: a release from stage 07 on finishes them and nothing reads the text; a release older than stage 03 has no table.
- Limits to write in `docs/capabilities/reply-drafts.md`: `made` is not the sum of the other counts (a waiting pair, a `policy_changed` close and a `suspicious` close are only in `made`); the `no_draft` and `failed` counts also count requests, by end time; a pair counts in the week of its first version, with the end of its newest version as of the day the number is computed; the stats page does not show the counts; the sample run is one a day for each mailbox (a run with no qualifying mail does not use it up) and the panel waits at most one minute (a reload shows the rest); a sample counts in the daily cap like a tap and shows the owner the text of a real mail's reply (owner only, retention clears the text after 90 days).
- Texts: fourteen Polish and English texts of the style card (`rs_samples*`, fixed table in `apps/web/src/i18n/reply-style.test.ts`) and one weekly line (`texts.notices.weekly.replyDrafts`, fixed in `packages/core/src/digest/weekly.test.ts`) were added without a legal text change; no `TERMS_VERSION` bump. The user doc page for the style card (`apps/docs`) is yours.
- Notes: `notes/2026-11-19-f115-s16-samples-and-outcomes.md`.
