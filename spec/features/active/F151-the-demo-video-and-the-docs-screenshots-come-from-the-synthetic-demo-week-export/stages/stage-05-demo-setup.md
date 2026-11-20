# F151 stage 05 — Demo setup off camera `[risky]`

Needs stage 04 (landed): the demo branch of `record.ts`, `demo-plan.json`, `demoServerEnv`. Needs coordinator step C1a: an export of an ended run day 1 or later in `~/.local/share/email-assistant/demo/` (trial is enough, D12), and the `*_demo` database (F121 C3) in the main `.env`.

Part of [`../plan.md`](../plan.md): P1, D1, D5, D6, D12; [`../notes-for-stages-05-06.md`](../notes-for-stages-05-06.md). Risk: demo data changes; product paths and GreenMail only, never SQL.

## Goal

Before the recording, the demo organization is ready: flags on, mailbox A quiet, the owner on the fake Telegram with no quiet hours, B's INBOX holds the history mail with old internal dates. Nothing here is final-only.

## Interfaces (stage 06 uses these)

- `demoMessage(mail: DemoMail, opts: { to: string; seq: number; runTag: string; date: Date }): string` (pure): RFC 5322 text, Message-ID `<demo-<seq>.<runTag>@ea-seed.test>`, the seed sender, subject and text, `Date` = `date`.
- `deliverToB(messages: { raw: string; internalDate: Date }[])`: IMAP APPEND into B's INBOX on the dev GreenMail, with the internal date.
- `shiftedDates(seedDates: Date[], now: Date): Date[]` (pure).
- `readDemoPlan(file: string): DemoRunPlan`: reads `demo-plan.json`, ISO strings back to `Date`.
- `demo:record --setup-only`: setup and state check, no recording.

## Step 1 — setup (`global-setup.ts`, demo branch)

After the import and flags, in order:

1. Flag `user_quiet_hours` on (the same `org-flag.ts` path).
2. Sign in as the demo owner (API). Turn `auto` off for each category of A that has it (settings route), else the re-gate sends `autonomy_paused` into the chat of step 5. A trial seed may have none; the Proof tests the path on a probe copy.
3. Link the owner to the fake Telegram chat `9_200_001` (`telegram:link`).
4. Quiet hours none (`PATCH /api/me/notify`, equal start and end).
5. Empty B on GreenMail (every folder, IMAP); a failure is `demo_mailbox_purge_failed`.
6. APPEND the history set to B (`shiftedDates`, `seq` 1…n, a 4-hex `runTag` per run); log `demo_setup_done history=<n>`.

## Step 2 — `--setup-only`

`parseRecordArgs` accepts `--setup-only` (only with `--seed`, else `setup_only_needs_seed`). The spec gets tests `@setup` (state check) and `@record` (stage 06). `--setup-only` selects `@setup`, skips the encode and the replay `hits` check, keeps the `misses` check, and prints `demo_setup_ok`.

`@setup` checks as the owner: A `paused`, no `auto` category, no `autonomy_paused` notice in the fake chat; `open_loops` and `reply_drafts` off (else replay misses); a Telegram link; quiet hours none; B's INBOX holds `plan.history.length` messages; B not connected.

## Decisions

- **APPEND, not SMTP** (review F4): a first sync searches the last 24 h by internal date, so 2-day-old history mail goes to the backfill, not triage.
- **Dates.** `shiftedDates` keeps offsets, newest at now − 2 days; a span over 25 days is `demo_history_span`.
- A stays `paused`. A step with no product path is a question, not SQL.
- A job CLI with model scope gets the demo env (`assertLoopbackLlm`).
- Trial seed (D12): a `planDemoRun` refusal (for example `demo_seed_short history`) changes no pick rule. Commit, quote the code and seed day, finish; the coordinator continues on a later export.

## Test (`apps/web/e2e/lib/demo/*.test.ts`)

1. `demoMessage` (seq 7, tag `ab12`, date `2026-12-09T12:00:00Z`, to `office@kordelan.test`) → `Message-ID: <demo-7.ab12@ea-seed.test>`, seed `From` and `Subject`, that `To`, the RFC 5322 date; text null → empty body.
2. `shiftedDates([2026-11-23T08:00Z, 2026-11-27T09:00Z], 2026-12-10T12:00Z)` → `[2026-12-06T11:00Z, 2026-12-08T12:00Z]`.
3. Dates 26 days apart → `demo_history_span`.
4. Test 1's Message-ID passes the synthetic check (`mail/seed.ts`).
5. `parseRecordArgs(["--setup-only", "--seed", "x.json"])` → `setupOnly: true`; `["--setup-only"]` → `setup_only_needs_seed`.
6. `readDemoPlan` on a file written from a plan with `history[0].at` `2026-11-23T08:00:00Z` → a `Date` with that time.

Break check: newest date at now; test 2 fails.

## Proof

```
SEED=$(ls -1 "$HOME"/.local/share/email-assistant/demo/demo-seed-day*.json | sort -V | tail -1)
mkdir -p /tmp/f151-s05 && flock /tmp/email-assistant-shared-tests.lock bun run demo:record --setup-only --seed "$SEED" > /tmp/f151-s05/setup.log 2>&1 && echo SETUP_OK
```

Auto-off probe (review 2, F2): a script copies `$SEED` to `/tmp/f151-s05/seed-auto.json` (mode 0600) with `auto` true on one category in A's `mailbox_settings.category_policy`. The same command on it (`auto.log`) prints `demo_setup_ok`. Delete the copy. Then `bun run check:job`. Quote the seed file name, the `demo_setup_done` and `demo_setup_ok` lines of both logs, or the refusal code.

## Done when

- Tests 1–6 pass; both proof runs print `demo_setup_ok` on a trial or final export.

Out of scope: on-camera steps (stage 06).
