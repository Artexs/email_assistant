# F115 stage 12: "replies ready" notice and the review in Telegram (2026-11-18)

Stage file: `spec/features/active/F115-e6a-reply-drafts/stages/stage-12-telegram-review.md`. Behaviour: `docs/capabilities/drafts-and-send.md` bullets "Telegram review (F115 stage 12)" and "Consent (F115 D16, stage 12)"; `docs/capabilities/digest-and-notices.md` (`replies_ready` row, callback prefixes `rv`, `rk`).

## Where the code is

- Core: `packages/core/src/digest/callback.ts` (`reply_review` `rv[:<send>]`, `reply_skip` `rk:<send>`), `digest/approvals.ts` (reply card: To, Cc, Reply-To, gaps first, no Send with a gap, Skip, the "cannot see your sent mail" line; edit outcome `skipped`), `digest/notices.ts` (`renderRepliesReadyNotice`: Review button or consent line, panel link), `digest/digest.ts` (`repliesReady` footer line), `outgoing/view-schema.ts` + `sender.ts` (view fields `gaps`, `replyTo`), `notices/views.ts` (`replies_ready` view: `review`, `panelUrl`), texts in `texts/approvals.ts`, `notices.ts`, `digest.ts`, `bot.ts`.
- Server (`apps/server/src/modules/channels/`): `notices/replies-ready.ts` (detector), `reply-review.ts` (`listReviewableReplies`, `queueReviewCard`, `queueNextReviewCard`), `reply-taps.ts` (the taps; `nextAfterReplyDecision` after Send and Reject), `review-keys.ts` (`approval:<send>:r<n>`), `consent.ts` `replyConsentOf`, `repo/review-cards.ts`, `card-edits-repo.ts` and `repo/cancel.ts` (both key forms), `sender.ts` (a review card is not held in quiet hours), `digest-job.ts` (the count line for owners). `actions/repo/notify.ts` `listOpenReplySends`; `listSendsToNotify` still skips `reply` for good.

## Decisions (defaults, none needs the owner now)

- **No consent text change, no TERMS bump (coordinator rule).** `tg_consent_text` is a legal text in the digest of `legal-version.test.ts`; a change needs a `TERMS_HISTORY` entry. So `REPLY_CONSENT_SINCE` is the placeholder `2099-12-31`, above `TELEGRAM_CONSENT_VERSION`: no user is covered, no review card goes out, `replies_ready` shows count, consent line and panel link only. Stage 17 must, in one commit: add the reply sentence to both consent texts (en: "reply drafts that the AI writes for you, and the addresses of the other recipients of a mail (To, Cc, Reply-To) when a reply goes to them"; pl: with "(Do, DW, Reply-To)"), bump `TELEGRAM_CONSENT_VERSION` (land date or `<date>.2`) and `TERMS_VERSION`, set `REPLY_CONSENT_SINCE` to the new version. Test `T8` in `apps/web/src/i18n/i18n.test.ts` fails if the version is offered while a text does not name reply data. The stage text asked for the consent bump in this stage: this part is NOT done. The integration test "old link version → 409, new version → linked" was not added (the link route is unchanged).
- **Detector semantics.** `replies_ready` counts the open reply sends of the org that the DB facts do not close (not answered, not suspicious; notes §3.7 "flagged" read as suspicious). One row per owner at most every 2 h from the queue time; none while that owner's last row is still `pending`/`sending`. The sends it counted get `notified_at` (stage 05 ignores it). With several owners whose histories differ, the counted sends are marked when at least one owner was reached: an owner held back by the gap sees them in the next count only.
- **Review card keys.** `approval:<send>:r<n>`; the card sync (`listCardsOfSend`), the edit target and the cancel of waiting cards of a closed send read both key forms. A card of that send still `pending`/`sending` is not doubled. The tapped card is found by the message id of the tap.
- **Quiet hours.** `replies_ready` is held like every notice; a review card (asked for by a tap) is not (`isReviewCardKey` in the sender).
- **Skip** edits the tapped card ("⏭ Skipped HH:MM. The draft stays in the panel.") and asks for the next card. `ApprovalItem.sentVisible` is the existing `view.sentVisible` of the approval view (set by `approvalViewFor`); the panel UI for it is stage 15.
- **Reply `timeout` result text** names 7 days (a reply), not 48 h. The tap answer `expired` names no hours for any kind. The `draft_missing` text was already settled in stage 09.
- The stage 07 test "N1" (`replies-drafter-review.test.ts`) follows the new design: no approval card for a reply; the `replies_ready` row holds a count only.

## For later stages

- Stage 13 adds Redraft, Reply all, Use Reply-To buttons to the same card (callback codes are new and unique; the test in `callback-loop.test.ts` lists every kind).
- Stage 15: the panel "Confirm the new Telegram terms" button for an already linked user calls `POST /api/telegram/consent` (exists since F116 stage 17).
- Stage 17: the legal batch above; the capability pages already describe the review.
- The sweep (stage 09) and the review use the same DB facts; a Sent row whose header is not read (`content = 'pending'`) is not an answer in the sweep (stage 12 first commit) but is in the review count (default `listUserAnswers`).
