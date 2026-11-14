# F104 stage 11 — Notice `sent_missing`

Part of [`../plan.md`](../plan.md). **[risky]**: a migration and a message to people (review job before the land; no other migration in build at the same time). Needs stage 07 on `master` (it reads `listSentHealth`); it may run next to stages 08–10. Read D15 and D17 first, and `docs/code-patterns.md` § Notices are facts and § "Add a notice kind" (this stage follows its five steps; `send_held` of F099 is the newest example).

After this stage an owner gets one Telegram notice when a mailbox with the switch on shows no sent mail for 7 days: "📭 No sent mail seen for <address> since <day>. Does your mail app keep a copy in Sent? …". A new sent mail or a new first pass starts a new period.

## Step 1 — Core: kind, view, texts, renderer

**Goal.** Steps 1 of the checklist: the kind, a strict view, the `en` and `pl` texts, the renderer.

**Files.** `packages/core/src/notices/kinds.ts`, `packages/core/src/notices/views.ts`, `packages/core/src/notices/renderers.ts`, `packages/core/src/texts/notices.ts`, `packages/core/src/digest/notices.ts` (`renderSentMissingNotice`, next to `renderSyncStaleNotice`), the core tests next to them (`packages/core/src/notices/registry.test.ts`, the notice render tests the file of `renderSyncStaleNotice` has).

**Interfaces.**

```ts
// kinds.ts: append "sent_missing" as the LAST entry of noticeKinds (the CHECK order). Keep every kind that master has at
// your base (F100 stage 16 may have added "weekly_report" before you).

// views.ts
const sentMissingView = z.strictObject({ address: text, since: isoDate, now: isoDate, timeZone });
// noticeViewSchemas.sent_missing = sentMissingView

// texts/notices.ts, NoticeTexts:
sentMissing: { first: (address: string, since: string) => string; ask: string };
// en
sentMissing: {
  first: (address, since) => `📭 No sent mail seen for ${address} since ${since}.`,
  ask: "Does your mail app keep a copy in Sent? The assistant needs it to see what you wait for.",
},
// pl
sentMissing: {
  first: (address, since) => `📭 Brak wysłanej poczty dla ${address} od ${since}.`,
  ask: "Czy Twój program pocztowy zapisuje kopię w folderze Wysłane? Asystent potrzebuje jej, żeby wiedzieć, na co czekasz.",
},

// digest/notices.ts
export function renderSentMissingNotice(
  input: { address: string; since: Date; now: Date; timeZone: string },
  texts: CoreTexts
): OutMessage; // text = first(address, formatClock(since, timeZone, now, texts.locale)) + "\n" + ask; buttons []

// renderers.ts
sent_missing: defineRenderer({
  schema: noticeViewSchemas.sent_missing,
  telegram: { full: (view, opts) => renderSentMissingNotice(view, textsFor(opts.locale)) },
}),
```

**Decisions.** D15, D17.

**Test** (unit):

1. `renderSentMissingNotice({ address: "boss@x.test", since: 2026-11-12T09:00Z, now: 2026-11-20T10:00Z, timeZone: "Europe/Warsaw" }, textsFor("en"))` → the exact two lines, the day as `formatClock` prints it for that input (compute the expected value with `formatClock` in the test, so the clock format is not copied by hand); `buttons []`.
2. The same with `textsFor("pl")` → the Polish lines.
3. `noticeViewSchemas.sent_missing` refuses an extra field and a missing `since`.
4. The core registry test passes (every kind has a renderer and a view schema).

**Check.** `bun test packages/core/src/notices packages/core/src/digest packages/core/src/texts`

**Done when.** Cases 1–4 pass.

## Step 2 — Migration

**Goal.** Step 2 of the checklist: the CHECK list and a mailbox check.

**Files.** `db/migrations/<YYYYMMDDHHMMSS>_outbox_sent_missing.sql` (new; later than the newest file at your base), `apps/server/src/platform/db/schema.ts` (only if `bun run db:types` changes it).

**Interfaces.** Read the newest migration that sets `outbox_kind_check` at your base (`20261114100003_outbox_send_held.sql` at the plan base; F100 stage 16 may add a newer one). `up`: drop and add `outbox_kind_check` with every kind of that list plus `'sent_missing'` last; `ALTER TABLE outbox ADD CONSTRAINT outbox_sent_missing_mailbox_check CHECK (kind <> 'sent_missing' OR mailbox_id IS NOT NULL);`. `down`: `DELETE FROM outbox WHERE kind = 'sent_missing';`, drop the new check, restore the list without `'sent_missing'`.

**Decisions.** D15.

**Test.** `telegram-schema.test.ts` compares the CHECK with `noticeKinds` (case "outbox_kind_check"); it passes after steps 1–2. One new case there: a `sent_missing` row without `mailbox_id` fails with `23514`.

**Check.** `bun run db:migrate && bun run db:rollback && bun run db:migrate && bun test apps/server/test/integration/telegram-schema.test.ts`

**Done when.** Both directions run; the test passes.

## Step 3 — Detector

**Goal.** Step 3 of the checklist: one detector file; one row per owner per quiet period (D15).

**Files.** `apps/server/src/modules/channels/notices/sent-missing.ts` (new), `apps/server/src/modules/channels/notices/index.ts` (`detectors`: after `sendHeldDetector`), `apps/server/src/modules/channels/repo.ts` (`cancelPendingOutbox` filter kind union gains `"sent_missing"`), `apps/server/test/integration/channels-notices.test.ts`.

**Interfaces.**

```ts
export const SENT_MISSING_AFTER_MS = 7 * 24 * 3_600_000;

export const sentMissingDetector: Detector = {
  name: "sent_missing",
  kinds: ["sent_missing"],
  async detect(run) { … },
};
```

`detect`: `on = await isFeatureOn(run.db, run.ctx, "sent_sync")`; `health = on ? new Map((await listSentHealth(run.db, run.ctx)).map((row) => [row.mailboxId, row])) : new Map()`. For each `mailbox` of `run.mailboxes`: `row = health.get(mailbox.id)`; when `mailbox.status !== "active"` or no `row` → `cancelPendingOutbox({ kind: "sent_missing", mailboxId })`, next. `quietSince` = the later of `row.newestUserAt` and `row.firstPassAt`; `run.now − quietSince < SENT_MISSING_AFTER_MS` → cancel pending, next. `row.lastErrorCode !== null` → cancel pending, next (the card names the error). Else `key = \`sent_missing:${mailbox.id}:${quietSince.getTime()}\``; for each `owner` of `run.owners`: `queue(run.db, run.ctx, { userId: owner.userId, locale: owner.locale, kind: "sent_missing", dedupKey: key, mailboxId: mailbox.id, view: { address: mailbox.address, since: quietSince, now: run.now, timeZone: run.timeZone } }, run.now)` inside `try … catch → warnSkipped("sent_missing", mailbox.id, error)` (the `sync.ts` detector form); then `cancelPendingOutbox({ kind: "sent_missing", mailboxId, exceptDedupKey: key })`.

**Decisions.** D15; Q6 (owners only).

**Test** (integration, `channels-notices.test.ts`, its notifier helpers; `NOW = 2026-11-20T10:00:00Z`; one org with two linked owners and one linked member; flag on; the switch on with `first_pass_at = NOW − 8 d`):

1. No sent mail → one `sent_missing` row per owner (2), none for the member; dedup key `sent_missing:<mailbox>:<NOW − 8 d ms>`; the view `since = NOW − 8 d`.
2. A second notifier run → still 2 rows.
3. Newest user sent mail at `NOW − 9 d`, `first_pass_at NOW − 20 d` → rows with `since NOW − 9 d`.
4. Newest user sent mail at `NOW − 6 d` → no row; a pending row of an older period → `failed` / `outdated`.
5. Only a system send at `NOW − 1 d` (no user mail), `first_pass_at NOW − 8 d` → 2 rows (system sends do not count).
6. `first_pass_at NOW − 6 d` → no row.
7. Flag off, or the mailbox `paused`, or the switch off → no row, and pending rows of the kind for that mailbox are cancelled.
8. Org B's mailbox in the same run state never gets a row in org A.
8b. The state has `last_error_code "folder_missing"` (no sent mail for 8 days) → no row; a pending row of the kind is cancelled.
9. `channels/notices/registry.test.ts` passes (one producer per kind, every kind covered).

**Check.** `bun test apps/server/test/integration/channels-notices.test.ts apps/server/src/modules/channels/notices/registry.test.ts`

**Done when.** Cases 1–9 and 8b pass.

## Step 4 — Docs

Step 5 of the checklist: `docs/architecture.md` §5 `outbox` row (kind `sent_missing`, dedup key `sent_missing:<mailbox id>:<quiet since ms>`, needs `mailbox_id`); `docs/modules.md` §3.8 channels table (the detector file); `docs/capabilities/digest-and-notices.md` (the notice list and its rule); `docs/capabilities/sent-mail.md` (a rule for the notice; Entry points row for `sentMissingDetector`).

**Check.** `bun test apps/server/src/capability-map.test.ts`

## Done when (stage)

Steps 1–4 done; the Proof command of `plan.md` passes (`/tmp/f104-s11`).
