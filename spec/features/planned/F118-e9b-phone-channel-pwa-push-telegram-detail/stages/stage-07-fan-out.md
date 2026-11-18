# F118 stage 07 — Fan-out and push-only recipients `[risky]`

Part of [`../plan.md`](../plan.md). Needs 06. No migration.

Carry-over reads: `plan.md` D4, D7, D8, D9; `interfaces.md` (`queueNotice`, `NoticeRecipient`, `pushDedupKey`, `listLiveDevices`); `docs/capabilities/digest-and-notices.md` rules 5, 7, 8; `channels/notice-queue.ts`, `channels/notices/run.ts` and `index.ts` (`detectForOrg`), `channels/report-members.ts`.

Push rows written here wait until stage 08 adds the sender; the sender expires rows older than 24 h. Keep `web_push` off for real members between the lands of 07 and 08 (the coordinator checks).

## Step 1 — `queueNotice` fans out

- **Goal:** a producer still calls `queueNotice` once per member and event; the function writes the rows of the route.
- **Decisions:** D4. With no explicit `channel`: read the member's `notice_routes`, chat link and live devices (`listLiveDevices`, D9) in the caller's transaction; with flag `web_push` off, `hasDevice` is false. Write the Telegram row (key as today) when the route says telegram, and one push row per live device (`pushDedupKey`) when it says push. The check render renders the Telegram text, and for a push row also the push render once stage 08 exists (until then the push row is written without a push render check: the kind is in `pushKinds`). Return value per `interfaces.md`. An explicit `channel: "mail"` keeps today's path.
- **Test (integration):**
  1. Member with chat and one device, flag on, kind `urgent` → two rows: `urgent:<id>` (telegram) and `urgent:<id>:push:<sub>` (push).
  2. Same, flag off → one Telegram row.
  3. Two devices, kind `approval` → one Telegram and two push rows; a second run → no new row.
  4. Kind `send_result`, no stored route → Telegram only; stored `{ updates: "both" }` → Telegram and push.
  5. Kind `digest` with a device → no push row.
  6. A device whose session expired → no push row.

## Step 2 — Push-only recipients

- **Goal:** D8. `detectForOrg` builds `members` and `owners` as `NoticeRecipient[]`: linked chats, plus (flag on) members with a live device and no chat. Detectors that need the chat id get it from the chat list, not from the recipient.
- **Decisions:** a push-only recipient takes part only in detectors whose kinds are in `pushKinds`; the digest job, weekly report and report members do not change. `since` is the oldest live device `created_at`. Urgent look-back uses `since`, as it uses `linkedAt` today.
- **Test (integration):**
  1. Org with one owner: no chat, one device, flag on; an urgent mail triaged after the device was added → one push row, no Telegram row.
  2. Same, urgent mail triaged before the device was added → no row.
  3. Same owner, a waiting approval → one push row; the approval is marked notified in the same transaction (a crash before commit leaves it unmarked).
  4. Same, flag off → no row and the approval stays unmarked.
  5. A Telegram-only member in the same org → Telegram rows only, as before (snapshot of today's `channels-notices` cases unchanged).

- **Mutation guard:** remove the flag check in the fan-out, the live-session join and the push-only flag check in turn; see a test fail each time; list them.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** sending push rows (08), the route UI (12).
