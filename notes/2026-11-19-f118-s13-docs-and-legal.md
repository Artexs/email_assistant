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
