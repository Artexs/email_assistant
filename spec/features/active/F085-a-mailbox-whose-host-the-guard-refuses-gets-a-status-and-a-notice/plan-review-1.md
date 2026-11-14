FAIL aad960ed9cd8b56517ebd02a1a574c7f3a4642c1

The plan fails with 2 major and 11 minor findings. Both major findings are proven and cheap to fix. Most facts in the plan match HEAD: 77 named paths, all present; the line numbers mostly agree; `scripts/plan-drift.sh … 8720bb0` printed "no drift". The stage order holds D18: no landed commit lets a reader meet an unknown status, and no mailbox can enter `host_blocked` without a way out. Each stage is small enough for one job.

Pre-mortem: if a bug reaches the user, stage 06 most likely lets it through. It ships an output that breaks the privacy promise that Q3 makes to the owner (M2). Stage 03 cannot meet its own "Done when" as written (M1).

## Major (blocking)

**M1. The grep check in stage 03 "Done when" can never pass.** Proven by a reproduction.
- `stages/stage-03-server-readers.md:170` requires that `grep -rn '"scope" | "paused" | "auth_error"' apps/server/src packages/core/src` print nothing.
- Stage 01 adds `export type HeldBy = "scope" | "paused" | "auth_error" | "host_blocked";` to `packages/core/src/digest/approvals.ts` (`stages/stage-01-core-and-panel.md:70,81`).
- That line contains the pattern. `echo '<that line>' | grep '"scope" | "paused" | "auth_error"'` matched it, exit 0.
- A Sonnet worker must break the check or change the type to pass. Fix: grep for `heldBy?: "scope"` and for `Promise<"scope"`, or use a word-bounded pattern that excludes `HeldBy =`.

**M2. Two rules conflict: D8/Q3 and D14/stage 06.** Proven by the plan text.
- `plan.md:49` (D8) says no "CLI line … prints … which side (IMAP or SMTP) was refused". `questions.md:19` (Q3) tells the owner the same: "never prints … which server (IMAP or SMTP) was refused. No … CLI line".
- `plan.md:75` (D14) and `stages/stage-06-mailbox-check.md:222-225` print `imap-host: refused|allowed|lookup_failed` and `smtp-host: …`.
- `stages/stage-07-docs.md:275` documents this too: "it prints which side is refused".
- The worker must choose between the two rules, and the owner default misstates what ships. Fix: exempt the operator CLI `mailbox:check` in D8 and Q3, or drop the side lines from D14.

## Minor (notes)

1. **Gap: a notice can be lost after a suspend.** Proven by code reading.
   - `plan.md:109` says "organization `suspended` | no re-check, no notice sent until the resume". This implies that the notice comes after the resume.
   - At HEAD, the suspend hook `cancelPendingOutboxOfOrg` (`channels/repo.ts:478-487`) makes every pending non-approval row `failed`/`outdated`. After the resume, the detector rebuilds the same key `host_blocked:<id>:<status_changed_at ms>`. `UNIQUE (org_id, user_id, dedup_key)` (`db/migrations/20261106000001_telegram.sql:72`) then stops a new row. The episode's notice never comes.
   - `auth_error` has the same behaviour. Fix the table text, or accept the gap explicitly.
   - The test that the table names (04: 4.1 integration test 5) checks only the re-check.
2. **Gap: no "active again" text after a password change in the panel.** Proven by code reading.
   - `apps/web/src/components/mailboxes/PasswordDialog.tsx:49` shows `password_saved_active` only for `auth_error`.
   - When `host_blocked` becomes `active` through a password change (D5), the dialog shows only "password saved". D10 and D13 do not name this reader.
3. **Gap: the D17 rollback SQL can race the running code.** Plausible.
   - `plan.md:89-92` runs the two UPDATEs before the code rollback, but does not say to stop the app first.
   - A new-code sync run can set `host_blocked` again before the old release starts. The old `mailboxStatusSchema` then throws in `listMailboxes`.
   - Fix: add "stop the app container first" to D17 and to the `deploy/README.md` step of `stages/stage-07-docs.md:278`.
4. **Gap: the re-check has no time limit.** Plausible.
   - `stages/stage-04-way-out.md:15` puts `recheckBlockedHosts` first in `run()`. The DNS lookups run one after another, two per blocked mailbox.
   - A slow resolver delays every sync run. Consider a cap on the count, or a timeout per lookup.
5. **Acceptance with weak proof.** "The panel shows the badge … and the owner hint" (`plan.md:152`, Done when 5) has only typecheck and `i18n.test.ts` as proof. The unit glob (`package.json:15`) runs no component tests, and no e2e or visual check is planned. Mark it unproven, or add a check.
6. **A Sonnet worker must guess in `stages/stage-06-mailbox-check.md:211` (test 6.1-2).** The `lookup` answer is not given.
   - With a public answer, `inspectMailbox` calls `checkMailbox`, which throws `mailbox has no stored password` (`mail/check.ts:49`). `createOrgWithMailbox` inserts no credentials.
   - Fix: state a refusing answer.
7. **A Sonnet worker must guess in `stages/stage-06-mailbox-check.md:232` (test 6.2-2).** The plan names `insertMailbox` and `insertCredentials` as if the file already used them. The file does not import either.
   - The file's `runCheck` hardcodes `MAIL_ALLOW_LOCAL_HOSTS: "true"` (`apps/server/test/integration/mail-check.test.ts:292`), so it needs an env parameter. Say so in the plan.
8. **The wording of `stages/stage-04-way-out.md:72` (test 6) contradicts itself.** It says "making `getMailbox` see `paused`", but the row changes inside `lookup`, which runs after `getMailbox`.
   - `stages/stage-04-way-out.md:71` (test 5) is garbled: "neither `imap.x.test` call for this mailbox".
9. **Wrong helper and line citations.**
   - `stages/stage-02-migration-and-notice.md:81`: the `send_held` null-mailbox check uses a local `insert`, not `insertOne` (`telegram-schema.test.ts:282`).
   - `stages/stage-03-server-readers.md:136`: the `edit` extra is near line 205 in the plan, but it is at `callbacks.ts:166`.
   - `plan.md:31`: `openSmtpSender` is at `mail/imap/smtp.ts:260-264`; line 70 is `smtpConnectOptions`.
   - `plan.md:132`: `SwitchResult` is at `mail/status.ts:11-15`, not at line 42.
10. **Ticket and board drift.** `ticket.md:31` gives the chain "01 → 02 → 03 → 04 → 05 → 07" with stage 06 next to 05. It does not make stage 07 wait for stage 06. `stages/stage-07-docs.md:243` needs 01–06, so add "06 → 07" to the ticket slice. Separately, `spec/build.md:82` still says "needs plan".
11. **Polish texts against the F098 glossary.**
    - `plan.md:62-63`: `taps.approvedHostBlocked` and `taps.sendAgainHeld.host_blocked` end in Polish with "/status pokazuje stan.". Every neighbouring tap text ends with "/status pokazuje szczegóły." (`packages/core/src/texts/bot.ts:361-379`).
    - D9 (`plan.md:70`) lets the worker change the word, so the worker must decide. Fix: use "szczegóły" in D9.
    - "sam wznowi skrzynkę" (`plan.md:57,67`) uses the /resume verb ("/resume wznawia je", `bot.ts:346`), so it can read like a user resume. This is a wording note only.
    - All other Polish texts follow the glossary: skrzynka, synchronizacja, wiadomość, no case ending on an address. They pass the `i18n.test.ts` rules (glossary words, `SAME_IN_BOTH`).

Smaller notes:
- `stages/stage-05-way-in.md:115` lets `committer.ts` (399 lines) go past the "under about 400 lines" rule of `docs/code-patterns.md:41`. The stage says this on purpose.
- `plan.md:40` (D6, "F100 stage 07 may make it 2 min") has no source. It does not change the design.

## Checks run
- `git rev-parse HEAD && bash scripts/plan-drift.sh spec/features/planned/F085-a-mailbox-whose-host-the-guard-refuses-gets-a-status-and-a-notice 8720bb0 && git status --short && echo CLEAN`, one call, exit 0. It printed `aad960ed9cd8b56517ebd02a1a574c7f3a4642c1` (matches the candidate), then "named paths: 77; changed since base: 0; gone: 0 / no drift", then an empty status, then `CLEAN`.
- `git diff --stat 8720bb0 HEAD`: only the 10 files of the F085 folder changed, so the code at HEAD is the code of the plan base.
- The M1 grep reproduction is shown above.
- I checked every path that the plan and stages name for existence. None is missing.
- I read every function, helper, test name and line that the plan cites: `jobs.ts`, `committer.ts`, `open.ts`, `host-guard.ts`, `port.ts`, `repo/mailboxes.ts`, `repo/targets.ts`, `status.ts`, `routes.ts`, `connect.ts`, `commands.ts`, `callbacks.ts`, `notices/*.ts`, `channels/repo.ts`, `notice-queue.ts`, `views.ts`, `renderers.ts`, `kinds.ts`, the texts files, `i18n.test.ts`, the migrations, `eslint.config.js`, `log.ts`, `log-fields.ts`, and the named test files with their line anchors.
- I ran no test suites. The candidate changes only plan files, so no suite can tell this diff apart.

## Note check
- Final message starts with the verdict and the counts: proven. Evidence: the first line of this message and the opening paragraph ("2 major and 11 minor"); HEAD sha from `git rev-parse HEAD && bash scripts/plan-drift.sh spec/features/planned/F085-a-mailbox-whose-host-the-guard-refuses-gets-a-status-and-a-notice 8720bb0 && git status --short && echo CLEAN`.
- Each finding quotes file and line, and the code facts are checked against HEAD: proven. Evidence: the file:line in each finding above; no drift since the base from `git rev-parse HEAD && bash scripts/plan-drift.sh spec/features/planned/F085-a-mailbox-whose-host-the-guard-refuses-gets-a-status-and-a-notice 8720bb0 && git status --short && echo CLEAN`.
- The review covers all asked classes: proven. Evidence: this message covers each class:
  - gaps: minor 1–4;
  - conflicts: M2 and minor 10;
  - steps a Sonnet worker must guess: M1 and minor 6–8;
  - missing or wrong paths and lines: minor 9 (no path is missing);
  - facts without a source: smaller notes, D6;
  - F098 glossary: minor 11;
  - stage order: the opening paragraph (D18 holds) and minor 10;
  - stage size: the opening paragraph (each stage fits one job).
- Easy-to-miss rule "Write no files; your final message is the review": followed. Evidence: the empty status and `CLEAN` from `git rev-parse HEAD && bash scripts/plan-drift.sh spec/features/planned/F085-a-mailbox-whose-host-the-guard-refuses-gets-a-status-and-a-notice 8720bb0 && git status --short && echo CLEAN`. The only file I wrote is the Limen job note outside the worktree, which the job requires.
