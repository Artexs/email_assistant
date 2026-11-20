# F151 stage 05 — Demo setup off camera `[risky]`

Needs stage 04: the demo branch of `record.ts`, `demo-plan.json`, `demoServerEnv`. Needs coordinator step C1: the export at `~/.local/share/email-assistant/demo/demo-seed-day5.json` and the `*_demo` database (F121 C3) in the main `.env`.

Part of [`../plan.md`](../plan.md). Decisions P1, D1, D5, D6. Risk: the setup changes demo data; only product paths and GreenMail delivery, never SQL.

## Goal

Before the recording starts, the demo organization is ready: flags on, mailbox A quiet, the owner linked to the fake Telegram with no quiet hours, and mailbox B's GreenMail INBOX holds the history mail with old internal dates. A `--setup-only` run proves it on the export.

## Interfaces (stage 06 uses these)

- `demoMessage(mail: DemoMail, opts: { to: string; seq: number; runTag: string; date: Date }): string` (pure): RFC 5322 text, Message-ID `<demo-<seq>.<runTag>@ea-seed.test>` (the synthetic marker), the seed sender, subject and text, `Date` = `date`.
- `deliverToB(messages: { raw: string; internalDate: Date }[])`: IMAP APPEND into INBOX of B on the dev GreenMail, with the internal date. Stage 06 uses it with `new Date()` for live mail.
- `shiftedDates(seedDates: Date[], now: Date): Date[]` (pure).
- `demo:record --setup-only`: setup, a state check, no recording.

## Step 1 — setup (`global-setup.ts`, demo branch)

After the existing import and flags, in this order:

1. Flag `user_quiet_hours` on (the same `org-flag.ts` path).
2. Sign in as the demo owner (API, off camera). Turn `auto` off for each category of mailbox A that has it (settings route). Reason: the re-gate job pauses an `auto` grant of another model key and sends `autonomy_paused` into the chat that step 5 shows.
3. Link the owner to the fake Telegram chat `9_200_001` through the product link path (`telegram:link`, as the lab seed does).
4. Quiet hours none: `PATCH /api/me/notify` with equal start and end.
5. Empty the GreenMail mailbox of B (every folder) through IMAP; a failure is `demo_mailbox_purge_failed`.
6. APPEND the history set to B with `shiftedDates`, `seq` 1…n, a 4-hex `runTag` per run.
7. Log `demo_setup_done history=<n>`.

## Step 2 — `--setup-only`

`parseRecordArgs` accepts `--setup-only` (only with `--seed`, else `setup_only_needs_seed`). The spec gets two tests: `@setup` (the state check below) and `@record` (the recording, stage 06). A normal run selects `@record`; `--setup-only` selects `@setup`, skips the encode and the replay `hits` check, keeps the `misses` check, and prints `demo_setup_ok`.

The `@setup` test checks as the owner: A is `paused` with no `auto` category; the owner has a Telegram link; quiet hours none; B's INBOX on GreenMail holds `plan.history.length` messages; B is not connected yet.

## Decisions

- **APPEND, not SMTP** (review F4): the first sync of a folder searches the last 24 h by internal date. History mail with an internal date of 2 days or more is left to the history backfill (30 days), so it is not triaged as new mail. Live mail (stage 06) gets the time of delivery.
- **Dates.** `shiftedDates` keeps the seed's offsets and moves the newest to now − 2 days. A span over 25 days is `demo_history_span`.
- Mailbox A stays `paused`; the setup never changes its password or status.
- A step with no product path is a question, not SQL.

## Test (`apps/web/e2e/lib/demo/*.test.ts`)

1. `demoMessage` with seq 7, run tag `ab12`, date `2026-12-09T12:00:00Z`, to `office@kordelan.test` → `Message-ID: <demo-7.ab12@ea-seed.test>`, the seed `From` and `Subject`, `To: office@kordelan.test`, the RFC 5322 date; text null → empty body.
2. `shiftedDates([2026-11-23T08:00Z, 2026-11-27T09:00Z], 2026-12-10T12:00Z)` → `[2026-12-06T11:00Z, 2026-12-08T12:00Z]`.
3. Seed dates 26 days apart → throws `demo_history_span`.
4. The Message-ID of test 1 passes the product's synthetic check (`mail/seed.ts`).
5. `parseRecordArgs(["--setup-only", "--seed", "x.json"])` → `setupOnly: true`; `["--setup-only"]` → `setup_only_needs_seed`.

Break check: put the newest date at now; test 2 fails.

## Proof

```
mkdir -p /tmp/f151-s05 && flock /tmp/email-assistant-shared-tests.lock bun run demo:record --setup-only --seed "$HOME/.local/share/email-assistant/demo/demo-seed-day5.json" > /tmp/f151-s05/setup.log 2>&1 && echo SETUP_OK
```

Then `bun run check:job`. The final message quotes the `demo_setup_done` and `demo_setup_ok` lines and any refusal code of `planDemoRun` on the export.

## Done when

- Tests 1–5 pass; the proof run prints `demo_setup_ok`.

## Out of scope

- Connect of B and every on-camera step (stage 06).
