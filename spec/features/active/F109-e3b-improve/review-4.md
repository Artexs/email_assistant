# F109 stage 04 review (Opus PASS, 2026-11-15)

Candidate `7a85435c`. Fixes in the follow-up commit: N1, N6, TG1. Notes below are for later tickets.

## Fixed

- N1: the urgent producer writes `suspicious` only for a flagged mail with the flag on. A view without the field renders in the code before F109 (rollback safety; the old `urgentView` is strict). Test: flag off gives no `suspicious` key.
- N6: the digest prints `no draft: suspicious mail` only for a flagged `delegation` item without an original `create_draft` action (`DigestItem.hasDraft`).
- TG1: `channels-notices` asserts the whole warning line, so extra text (a sender) in the line fails an integration test.

## Notes

- N2: no consent bump. `TELEGRAM_CONSENT_VERSION` stays. The line holds fixed phrases chosen from our own enum codes (DB CHECK, view `z.enum`, `suspiciousLine`); no mail-derived data reaches it. Owner decision recorded (user-visible/privacy default). Stage 16 clarifies the rule in `docs/code-patterns.md`; stage 06 needs a bump for attachment names or types.
- N3: `suspiciousReasonsOf` returns the same "absent" for an untriaged mail and a clean mail. The F115 plan (reply drafts on tap for any mail) must also require a `triage_results` row, or use a three-state return.
- N4: `emails` has no `(mailbox_id, thread_key)` index (`sent_emails` has one). E5b (F116) should add one if it calls `suspiciousThreadKeysOf` per mail.
- N5: F110 bulk unsubscribe works per sender; `suspiciousReasonsOf` is per mail. A rule "any flagged mail of this sender" needs a new per-sender reader (new work for F110).
- N7: "podejrzana wiadomość" shows on two lines in a row in the digest for a flagged delegation (warning line, then no-draft line). Accepted.
