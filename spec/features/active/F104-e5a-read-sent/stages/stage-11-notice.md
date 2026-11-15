# F104 stage 11 — Notice `sent_missing`

Part of [`../plan.md`](../plan.md). **[risky]**: a migration and a message to people (review before the land; no other migration in build). Needs stage 10 (it reads `listSentHealth` of stage 07). Read D15, D17, and `docs/code-patterns.md` § "Notices are facts" and § "Add a notice kind"; `host_blocked` (F085) is the newest example of a mailbox notice.

## Step 1 — Core: kind, view, texts, renderer

**Files.** `packages/core/src/notices/kinds.ts`, `packages/core/src/notices/views.ts`, `packages/core/src/notices/renderers.ts`, `packages/core/src/texts/notices.ts`, `packages/core/src/digest/notices.ts`, and their tests.

**Interfaces.**

```ts
// kinds.ts: "sent_missing" is the LAST entry of noticeKinds (the CHECK order); keep every kind of your base.
// views.ts
sent_missing: z.strictObject({ address: text, since: isoDate, now: isoDate, timeZone })
// texts/notices.ts, NoticeTexts
sentMissing: { first: (address: string, since: string) => string; ask: string };
// en: first → `📭 No sent mail seen for ${address} since ${since}.`
//     ask   → "Does your mail app keep a copy in Sent? The assistant needs it to see what you wait for."
// pl: first → `📭 Brak wysłanej poczty dla ${address} od ${since}.`
//     ask   → "Czy Twój program pocztowy zapisuje kopię w folderze Wysłane? Asystent potrzebuje jej, żeby wiedzieć, na co czekasz."
// digest/notices.ts, next to renderHostBlockedNotice
renderSentMissingNotice({ address, since, now, timeZone }, texts): OutMessage // first(cutText(address, 60), formatClock(since, …)) + "\n" + ask; no buttons
// renderers.ts: the sent_missing renderer. privacy/outbox.ts NOTICE_MAIL_CONTENT: sent_missing: "no_mail" (a mailbox address)
```

**Test** (unit):

1. `boss@x.test`, since `2026-11-12T09:00Z`, now `2026-11-20T10:00Z`, `Europe/Warsaw`, `en` → the two lines (the day by `formatClock` in the test); no buttons. An 80-character address is cut as in `renderHostBlockedNotice`.
2. The same in `pl`; the Polish one-colon test passes.
3. The view schema refuses an extra field and a missing `since`.
4. The core notice registry test passes.

## Step 2 — Migration

**Files.** `db/migrations/<timestamp>_outbox_sent_missing.sql`, later than every file at your base.

Read the newest migration that sets `outbox_kind_check` at your base (`db/migrations/20261114154826_mailbox_host_blocked.sql` at the plan base). Up: the CHECK with every kind of that list plus `'sent_missing'` last; `outbox_sent_missing_mailbox_check`: `kind <> 'sent_missing' OR mailbox_id IS NOT NULL`. Down: delete `sent_missing` rows, drop the new check, restore the list.

**Test.** `apps/server/test/integration/telegram-schema.test.ts` compares the CHECK with `noticeKinds`; one new case: `sent_missing` without `mailbox_id` → `23514`.

**Check.** `bun run db:migrate && bun run db:rollback && bun run db:migrate`.

## Step 3 — Detector

**Files.** `apps/server/src/modules/channels/notices/sent-missing.ts` (new); `apps/server/src/modules/channels/notices/index.ts` (`detectors`, after the host-blocked one); `apps/server/src/modules/channels/repo.ts` (the kind union of `cancelPendingOutbox`); `apps/server/test/integration/channels-notices.test.ts`.

**Interface.** `SENT_MISSING_AFTER_MS = 7 d`, `SENT_PASS_FRESH_MS = 1 h`, `sentMissingDetector: Detector` (kind `sent_missing`).

Rule per mailbox: flag off, mailbox not `active`, no health row, an error code, `lastPassAt` older than `SENT_PASS_FRESH_MS` (no fresh read after a flag-off or pause period), or `now − quietSince < 7 d` → cancel pending rows of the kind for the mailbox. Else `quietSince` = the later of `newestUserAt` and `firstPassAt`; key `sent_missing:<mailbox id>:<quietSince ms>`; queue one row per owner (`run.owners`, Q6) with the view; each queue in its own try (skip warning as the other detectors); then cancel pending rows of the kind with another key.

**Test** (two linked owners, one member; flag on; switch on, `first_pass_at NOW − 8 d`, `last_pass_at NOW − 5 min`):

1. No sent mail → 2 rows (owners only); key `sent_missing:<mailbox>:<NOW − 8 d ms>`; `since NOW − 8 d`.
2. A second run → still 2.
3. Newest user mail `NOW − 9 d`, first pass `− 20 d` → `since NOW − 9 d`.
4. Newest user mail `− 6 d` → no row; an older period's pending row → cancelled.
5. Only a system send at `− 1 d` → 2 rows.
6. First pass `− 6 d` → no row.
7. Flag off, mailbox `paused` or `host_blocked`, or switch off → no row; pending rows cancelled.
8. Org B's mailbox never gets a row in org A.
9. `last_error_code "folder_missing"`, or `last_pass_at NOW − 2 h` → no row; pending cancelled.
10. The channels notice registry test passes.

## Step 4 — Docs

`docs/architecture.md` §5 `outbox` row (kind, key, needs `mailbox_id`); `docs/modules.md` §3.8 (the detector); `docs/capabilities/digest-and-notices.md`; `docs/capabilities/sent-mail.md`.

## Done when

Steps 1–4 done; the Proof passes (`/tmp/f104-s11`).

## Carry-over from the stage 08 review (F104)

A stale pass can run `markSentPass` after an off then on and set `last_pass_at` and `last_error_code` on the new period (guard is only `enabled=true`). Keep this in mind for the 'first pass done' notice (review-8.md N3).
