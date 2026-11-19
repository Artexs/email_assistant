# F118 stage 13 — papers, docs, ADR: notes for the next worker

Ticket: `spec/features/active/F118-e9b-phone-channel-pwa-push-telegram-detail/` (stage 13). No migration. Flags `web_push` and `telegram_minimal` stay OFF. Nothing is deployed. Checkpoint B (owner) follows the land.

## What changed
- Registry row `web-push` (`packages/core/src/legal/subprocessors.ts`), active when `VAPID_PRIVATE_KEY` is set. `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` map to it in `OUTSIDE_SERVICE_KEYS`; `VAPID_PUBLIC_KEY` stays exempt. Location is a `<to confirm: location>` placeholder; the privacy URL is the Google page (FCM), already read on 2026-11-17 for the `gemini` row.
- `TERMS_HISTORY` entry `2026-11-19` (digest covers: the registry row, the kept-text key, the privacy and DPA pages).
- Review N7 (stage 02): the shared key `legal_kept_until_delete` now reads "Until the mailbox, the member or the organization is deleted" / "Do usunięcia skrzynki, członka lub organizacji". It applies to every `untilDelete` category (one text for all). The `records-of-processing.md` rows follow it.
- Privacy page (en, pl): the member list names push devices; the digest-and-notices purpose names push; the Telegram paragraph names the two levels (`minimal`, `full`); a new paragraph "Push services"; a retention line (24 h); the delete line names push devices. DPA: digests by push; delete line. `tg_consent_text` and `TELEGRAM_CONSENT_VERSION` are UNCHANGED (D13): the level texts are the panel texts of stage 12. The DPIA draft says the consent text over-describes a `minimal` member.
- Claims list: C177, C182, C195 edited in place. New rows C243 to C254 are appended in a last section (no renumbering, so older ids in notes and tickets stay valid).
- Docs: ADR 0032 accepted with "Built" lines and D6, D9, D13, D19; `digest-and-notices.md` rule 3f (routes), Data, Limits, Tests; `web-panel.md` Data, Limits, Tests; `code-patterns.md` § Add a notice kind step 1; `architecture.md` outbox row, `push_subscriptions` line, new §6.4 Web Push with the `VAPID_*` keys; `deploy/README.md` new section "Phone notices and Telegram detail (F118)" (keys, Tailscale line, flags, rollback lines).
- Guards: `legal-privacy.test.ts` test 4 (both languages name the push services and both levels; the planned-feature regex no longer lists "push notification"); `outside-services.test.ts` test 3b (`web-push` row and the key map). The digest guard `legal-version.test.ts` test 2 is the old guard for the new entry.

## Open for the owner (checkpoint B, O5)
Read the changed legal texts. Write the `03-product-frame.md` §4 Telegram line (PD-092). The papers are drafts, not legal advice.

## Proof logs
`.f118s13-logs/` in the job worktree (untracked): `mutation-*.log`, `proof-*.log`, `int-env-i.log`, `lint-early.log`.

## Review fixes (FAIL 2663c767; `notes/2026-11-19-f118-s13-review-1.md`)
- B1 (verified in source, not at runtime): `git show v0.2.1:apps/server/src/modules/channels/repo.ts` shows `claimDueOutbox` with no channel filter. It sets `status = 'sending'` on every due row, then parses `channel` with `z.enum(noticeChannels)` (`["telegram"]` in v0.2.1) and `detail` with `noticeDetails` (`["full"]`). A push row or a `detail = 'minimal'` row throws after the claim; the caller logs `outbox_claim_failed` and returns, so the claimed batch stays `sending`. v0.3.0 filters on `channel` and has both enums wide. `deploy/README.md` step 5 now closes push rows (pending AND sending) and relabels `minimal` rows BEFORE `deploy/rollback.sh`; the second SQL (the `detail = 'minimal'` rows) is my own finding from the same source, not in the review. `docs/release-checklist.md`, ADR 0032 and rule 3c of `digest-and-notices.md` point to it. N8 text is in step 1.
- `untilDelete` has a `scope`: `mailbox` (default; unchanged wording), `member` (`chat-links`, `push-devices`: the member removes the item in the panel or the CLI), `organization` (`account`: no code removes a member). Texts: `legal_kept_until_mailbox|member|organization` (en, pl). `legal-tables.test.ts` checks the Kept column of the records against the same text.
- `TERMS_HISTORY` entry `2026-11-19` got a new digest in place (the first digest of that version was never deployed); no second entry.
- T1 to T5 are tests now (`telegram.test.ts`, `legal-papers.test.ts` 2b, `legal-tables.test.ts`, `push.test.ts` 3, claim C248 source `registry.test.ts`). Mutation logs `.f118s13-logs/mutation-r1..r7*.log`.
- Not done on purpose: `apps/docs/src/flagged-text.ts` still says of `web_push` that "no route, sender or text exists yet" (stale reason, found while editing faq.mdx; the flag now has panel texts). Not changed: a docs-site decision for checkpoint B.
- Groups 3 (notes) and 4 (Polish fixes) share one commit: the edits touch the same sentences.
