# F118 stage 07 — Fan-out and push-only recipients `[risky]`

Part of [`../plan.md`](../plan.md). Needs 06. No migration.

Carry-over reads: `plan.md` D4, D7–D9, D20, D21; `plan-review-1.md` B2, B3, T4; `interfaces.md`; `digest-and-notices.md` rules 5, 8; `channels/notice-queue.ts`, `notices/run.ts`, `notices/index.ts`, `consent.ts`.

Push rows wait for the stage 08 sender. No deploy between the lands of 07 and 08 (G-flag).

This stage adds `"push"` to `noticeChannels` and an optional `push` key to `NoticeRenderer` (no renderer yet; `renderNotice` answers `{ ok: false }` for push until stage 08).

> Done in stage 02 (accepted by the coordinator): `"push"` is already in `noticeChannels` and `NoticeRenderer` and `noticeEditRenderers` already have the optional `push` key, with a test in `notices/registry.test.ts`. Do not add them again; this stage writes the push rows.

## Step 1 — `queueNotice` fans out

- **Goal:** a producer calls `queueNotice` once per member and event; it writes the rows of the route.
- **Decisions:** D4, D20, D21. With no explicit `channel`: read the member's `notice_routes`, chat link and live device ids (`listLiveDeviceIds`, D9) in the caller's transaction; flag `web_push` off → no devices. Write the Telegram row (key as today) when the route says telegram, and one push row per live device with `createdAt ≤ eventAt` (`pushDedupKey`) when it says push. `eventAt` is required for a push kind (a missing one throws; each detector passes the time of its event: triage time, the time the send began to wait, the status change). `only` limits the rows to one channel. The check render is the Telegram render; stage 08 adds the push check. An explicit `channel: "mail"` keeps today's path.
- **Test (integration):**
  1. Member with chat and one device, flag on, kind `urgent` → two rows: `urgent:<id>` (telegram) and `urgent:<id>:push:<sub>` (push).
  2. Same, flag off → one Telegram row.
  3. Two devices, kind `approval` → one Telegram and two push rows; a second run → no new row.
  4. Kind `send_result`, no stored route → Telegram only; stored `{ updates: "both" }` → Telegram and push.
  5. Kind `digest` with a device → no push row.
  6. A device whose session expired → no push row.
  7. B2: member with a chat, an urgent mail triaged at 10:00, a device added at 11:00, a detector run at 11:01 → no push row; a mail triaged at 11:30 → one push row.
  8. `eventAt` missing for `urgent` → throws; for `digest` → fine.

## Step 2 — Push-only recipients

- **Goal:** D8. `detectNotices` also visits an org whose only recipients are push-only members (today it needs a chat or a report mailbox). `detectForOrg` builds `members` and `owners` as `NoticeRecipient[]`: linked chats, plus (flag on) members with a live device and no chat. A detector that needs the chat id gets it from the chat list.
- **Decisions:** a push-only recipient takes part only in detectors whose kinds are in `pushKinds`; the digest job, weekly report and report members do not change. `since` is the oldest live device `created_at`. D21: where a detector splits owners by the loop-consent gate (approval, send result, action failed of a follow-up), the withheld owners get `loop_consent` with `only: "telegram"` and the real kind with `only: "push"`; the covered owners get the real kind on both.
- **Test (integration):**
  1. Org with one owner: no chat, no report mailbox, one device, flag on; an urgent mail triaged after the device was added; run `detectNotices` (not `detectForOrg`) → one push row, no Telegram row.
  2. Same, urgent mail triaged before the device was added → no row.
  3. Same owner, a waiting approval → one push row; the approval is marked notified in the same transaction.
  4. Flag off → no row; the approval stays unmarked.
  5. A Telegram-only member in the same org → Telegram rows only, as before (today's `channels-notices` cases unchanged).
  6. B3: push-only owner with no consent row, a follow-up approval (`loop_id` set) → one push row of kind `approval`, no Telegram row; the approval is marked notified.
  7. Owner with a chat but no covering consent and one device, a follow-up approval → a Telegram `loop_consent` row and an `approval` push row.

- **Mutation guard:** remove the fan-out flag check, the live-session filter, the `eventAt` filter and the push-only flag check in turn; see a test fail each time; list them.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** sending push rows (08), the route UI (12).
