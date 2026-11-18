# F116 stage 22: Delegate action, loop settings and the new Telegram terms

Written by the stage 22 worker. Read before stage 23, stage 24 (docs) and the C3 review.

## What the panel does now

- **Delegate action** (`apps/web/src/components/activity/DelegateAction.tsx`, `lib/delegate-action.ts`): a "Delegate" button in `ActionButtons` (row and panel of the Activity page). Rule (`showDelegateAction`): category urgent, needs_reply or unsure (`NEEDS_ACTION_CATEGORIES`, the Telegram rule); no suspicious reason; no open delegation (`drafted`, `sent`, `overdue`); the mailbox is in `assist` with `create_draft` on; at least one active delegate. The organization part (`delegateHintWanted`): role owner, not suspended, flags `delegate_button` AND `delegation_pages`.
- **The hint** is read once per page by `DelegateHintProvider`: `GET /api/delegates` plus `GET /api/settings/:id` for each assist mailbox (the mailbox list has `mode`, but not the draft switch). A failed read gives no button, never an error. The server checks every rule again at the pick (`POST /api/emails/:id/delegate`); each 409 code has one text (`exists` links to `/delegations`). The success text links to `/approvals?id=<sendId>`.
- **Loop settings card** (`LoopSettingsCard`, `data-card="loops"`) after the Sent card: select 1–10 working days (`PATCH /loop-wait`) and the switch `auto_follow_up` (`PATCH /switches/auto_follow_up`). It shows only while `toolSwitches.auto_follow_up` is present (the server sends it only while `open_loops` is on). Both controls are disabled for a member and while `sentTracking` is not `on`; then the line "Turn on 'Track my sent mail' to use open loops." shows.
- **New Telegram terms** (`components/telegram/NewTerms.tsx`, in `TelegramLink`): a linked user whose consent is older than `TELEGRAM_CONSENT_VERSION` (no consent counts as older) sees the title, `tg_consent_text` and a Confirm button that calls `POST /api/telegram/consent`. Only while `open_loops` is on.
- **Server:** `GET /api/channels/telegram` has a new field `consentVersion` (own consent that an unlink did not withdraw; null when not linked). It reads through `ownConsentVersion` in `channels/consent.ts`, so the consent-gate source scan still sees `consentVersionsOf` in one file.

## Facts and deviations (decisions for the coordinator)

1. **The Telegram card is not on the settings page.** `TelegramLink` renders on `/mailboxes` and in onboarding only. The stage text says "the Telegram card of the settings page"; the block is in `TelegramLink`, so it shows on those two pages. If the owner wants it on the settings page too, mount `NewTerms` in the general section.
2. **`GET /delegates` is a 404 without `delegation_pages`.** The panel action needs that flag next to `delegate_button`. The docs stage must say so; the flag text of `delegate_button` in `features.ts` does not.
3. **TG-4 (Playwright S11, loop closes while Edit is open) is NOT done here.** The stage 21 file carries it too (line 37), and a stage 21 job is running. Do not add it twice.
4. The `consentVersion` field is the only server change. No migration, no new route (no new `apiDoc`).
5. `open_loops` can stay off until the owner decides; N6 of review 17 is satisfied now: the Confirm button exists.

## e2e

New spec `apps/web/e2e/tests/loops-panel.spec.ts` (T5–T9) and a new seeded organization per project (`E2E Loops mobile|desktop`, `e2e-loops-rows.ts`): flags `open_loops`, `delegate_button`, `delegation_pages`, `sent_sync`, `approvals_page`; one delegate (Anna Nowak); an assist mailbox with drafts on and Sent tracking on; mails needs_reply, unsure, info; the owner linked to Telegram with consent version `2026-11-14`. The spec does not call `cleanUpOrg` (it would unlink the chat). Do not seed an `urgent` mail there: the notifier then queues a Telegram notice to the fake chat id and logs `outbox_refused`.
