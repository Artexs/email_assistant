# F085 stage 01 — Core and panel know `host_blocked`

Part of [`../plan.md`](../plan.md). Read its D2, D9, D10, D12, D13 and "Rules for every stage" first.

No migration, no server change except what typecheck forces (none expected). After this stage the DB still refuses `host_blocked`; no row can hold it. Three steps, about 220 changed lines.

- [ ] **1.1 One status list, the digest line and the held cause (core)**
  - Goal: core knows the fourth mailbox status; the digest prints a line for it; a held send can name it as its cause.
  - Files:
    - `packages/core/src/web/mailboxes.ts`: `mailboxStatuses` becomes `["active", "paused", "auth_error", "host_blocked"] as const`; add `export type MailboxStatus = (typeof mailboxStatuses)[number];` next to it.
    - `packages/core/src/digest/digest.ts`: `DigestMailbox.status: MailboxStatus` (import the type from `../web/mailboxes`); `mailboxLine` becomes an exhaustive `switch (mailbox.status)` with no `default` (D10): `paused` → `texts.digest.mailbox.paused(...)`, `auth_error` → `authError(...)`, `host_blocked` → `hostBlocked(clock(mailbox.statusChangedAt), sync(lastSyncedAt))`, each with `${suffix}`; `active` → the existing sync-time lines (never, late, ok). The output of the three old cases must not change by one byte.
    - `packages/core/src/texts/digest.ts`: the interface gets `mailbox.hostBlocked: (since: string, last: string) => string`; `en` and `pl` get the D9 strings.
    - `packages/core/src/digest/approvals.ts`: `export type HeldBy = "scope" | "paused" | "auth_error" | "host_blocked";` above `approvalEdit`; its `heldBy?:` input uses `HeldBy`. Export `HeldBy` through `packages/core/src/digest/index.ts` if that file lists the exports by name (check it; `packages/core/src/index.ts` re-exports `./digest`).
    - `packages/core/src/texts/approvals.ts`: `held: { scope: string; paused: string; auth_error: string; host_blocked: string }` (line 77) and the `en` and `pl` entries (D9).
    - Tests: `packages/core/src/digest/digest.test.ts`, `packages/core/src/digest/approvals.test.ts`.
  - Interfaces:

    ```ts
    // packages/core/src/web/mailboxes.ts
    export const mailboxStatuses = ["active", "paused", "auth_error", "host_blocked"] as const;
    export type MailboxStatus = (typeof mailboxStatuses)[number];

    // packages/core/src/digest/approvals.ts
    export type HeldBy = "scope" | "paused" | "auth_error" | "host_blocked";
    ```

  - Decisions: D2, D9, D10, D12.
  - Test (Europe/Warsaw, `now = 2026-11-06T07:00:00Z`, the existing `line(...)` helper of the mailbox-lines test in `digest.test.ts`, near line 200):
    1. `line({ status: "host_blocked", statusChangedAt: 2026-11-06T06:40:00Z, lastSyncedAt: 2026-11-06T06:35:00Z })` → exactly `⛔ Mail server not allowed since 07:40 · last sync 07:35`.
    2. The same with `textTables.pl` → exactly `⛔ Serwer poczty niedozwolony od 07:40 · ostatnia synchronizacja: 07:35`.
    3. The existing `paused`, `auth_error`, late, never and ok lines keep their expected strings (no change to those assertions).
    4. `approvals.test.ts`, the test "approved_held keeps one Reject button; the line differs per cause" (near line 654): the list becomes `["scope", "paused", "auth_error", "host_blocked"]`, the set size 4, and `texts[3]` is exactly `${original}\n\n⏳ Approved 11:07. The mail server is not allowed, so the send waits; /status shows it. It expires 48 h after the tap if it is still held.` with the one ✖️ Reject button.
  - Check: `bun test packages/core/src/digest packages/core/src/texts`; `bun run typecheck`.
  - Done when: tests 1–4 pass; typecheck passes in all workspaces (the server and the web compile with the wider lists).
  - Out of scope: the server `MailboxStatus` type (stage 02); the notice kind (stage 02).

- [ ] **1.2 Texts of the notice, the bot and the renderer function (core)**
  - Goal: every Telegram text of the ticket exists in `en` and `pl`, and the notice text renders from a view, before any producer exists.
  - Files:
    - `packages/core/src/texts/notices.ts`: `NoticeTexts` gets `hostBlocked: { first: (address: string, since: string) => string; why: string; noRead: string; recheck: string }`; `en` and `pl` get the D9 strings.
    - `packages/core/src/digest/notices.ts`: `renderHostBlockedNotice`, next to `renderAuthErrorNotice`.
    - `packages/core/src/texts/bot.ts`: `BotTexts.status` gets `stateHostBlocked: (since: string) => string` (after `stateAuthError`) and `approvedHostBlocked: (count: number) => string` (after `approvedAuthError`); `switch` gets `hostBlocked: (address: string) => string` (after `loginError`); `taps` gets `approvedHostBlocked: string` (after `approvedAuthError`); `taps.sendAgainHeld` and `taps.heldNotes` get `host_blocked: string`. `en` and `pl` get the D9 strings.
    - Tests: `packages/core/src/digest/notices.test.ts`; `packages/core/src/texts/index.test.ts` and `bot.test.ts` must pass unchanged.
  - Interfaces:

    ```ts
    // packages/core/src/digest/notices.ts — four lines joined by "\n", no buttons
    export function renderHostBlockedNotice(
      input: { address: string; since: Date; now: Date; timeZone: string },
      texts: CoreTexts
    ): OutMessage;
    //   const since = formatClock(input.since, input.timeZone, input.now, texts.locale);
    //   text: [
    //     texts.notices.hostBlocked.first(cutText(input.address, 60), since),
    //     texts.notices.hostBlocked.why,
    //     texts.notices.hostBlocked.noRead,
    //     texts.notices.hostBlocked.recheck,
    //   ].join("\n"), buttons: []
    ```

  - Decisions: D7 (the view has no mailbox id), D8, D9.
  - Test (`notices.test.ts`, the file's `now` = `2026-11-06T07:00:00Z`, `timeZone` = `Europe/Warsaw`):
    1. `renderHostBlockedNotice({ address: "me@firma.test", since: 2026-11-06T06:40:00Z, now, timeZone }, textTables.en)` → text exactly:
       `⛔ The system stopped connecting to the mail server of me@firma.test at 07:40.\nThe server name points to a private or local network address, and the system never connects there.\nThe system does not read or send mail of this mailbox now. No mail is lost: it stays on the mail server.\nThe system checks the server again at each sync and starts the mailbox again by itself. /status shows the state.`; buttons `[]`.
    2. The same input with `textTables.pl` → the first line exactly `⛔ System przestał łączyć się z serwerem poczty skrzynki: me@firma.test. Od: 07:40.` and four lines in all.
    3. A `since` of the day before (`2026-11-05T13:00:00Z`) → the first `en` line ends `at 5 Nov 14:00.`
    4. An address of 80 characters is cut to 60 code points (`cutText`), as in the `auth_error` test.
  - Check: `bun test packages/core/src/digest/notices.test.ts packages/core/src/texts`.
  - Done when: tests 1–4 pass; `texts/index.test.ts` (it walks every entry of both tables) passes.
  - Out of scope: the registry entry (`noticeRenderers`, `noticeKinds`, `noticeViewSchemas`): stage 02, with the DB CHECK.

- [ ] **1.3 Panel badge and hint**
  - Goal: the panel shows the status on the mailbox card and in the operator detail.
  - Files:
    - `apps/web/src/components/mailboxes/StatusBadge.tsx`: `variants` gets `host_blocked: "destructive"`; `texts` gets `host_blocked: "status_host_blocked"`. Type `variants` as `Record<MailboxView["status"], "default" | "secondary" | "destructive">` so a later status fails typecheck here too (D10).
    - `apps/web/src/components/mailboxes/MailboxCard.tsx`: next to the `auth_error` alert, `{isOwner && mailbox.status === "host_blocked" && (<Alert variant="destructive"><AlertDescription><p>{t("mb_host_blocked_hint")}</p></AlertDescription></Alert>)}`. No new button: the pause, resume and password buttons stay bound to `active`, `paused` and `auth_error`; the "More" menu stays as it is (D13).
    - `apps/web/src/i18n/en.ts`: `status_host_blocked` (after `status_auth_error`), `mb_host_blocked_hint` (after `mb_auth_error_hint`); `apps/web/src/i18n/pl.ts`: the same keys (D9).
  - Interfaces: none new.
  - Decisions: D9, D13.
  - Test:
    1. `apps/web/src/i18n/i18n.test.ts` passes (both keys in `en` and `pl`, no placeholder; the Polish texts differ from the English ones, so they are not in `SAME_IN_BOTH`).
    2. `bun run typecheck` passes for `@ea/web` (`StatusBadge` covers every status).
  - Check: `bun test apps/web/src/i18n`; `bun run typecheck`; `bun run lint`.
  - Done when: tests 1–2 pass.
  - Out of scope: the operator list count and `op_col_mailboxes` (stage 03, with the server count); a banner (D13: none).

## Done when

- Steps 1.1–1.3 are done and committed by explicit paths.
- The final message lists any `pl` word that differs from D9 and why (D9: the neighbouring entries win).
- The Proof command of `plan.md` for stage 01 (`/tmp/f085-s01`) prints `PROOF_OK`.
