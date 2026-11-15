FAIL 399360e1dc3dcace6bdf66f5cda972ca67dffe40

The candidate matches HEAD (`git rev-parse HEAD` = 399360e1dc3dcace6bdf66f5cda972ca67dffe40). The refresh base 17b2a369 is HEAD~1 (`git log --oneline 17b2a369..HEAD` shows only the refresh commit), so no commit landed after the refresh. I checked the landed work since 9341d9f0 against the stages that the refresh did not change.

## Blocking

**B1. The refresh sends OAuth mailboxes into a history backfill that cannot log in. The ticket acceptance "a new mailbox gets a history check … and its report page shows the result" breaks for every OAuth mailbox.** Proven by code read.
- Stage 05 now queues a check on an OAuth connect (`stages/stage-05-history-backfill.md:28`, test 5 at :34). Stage 06 runs that check through `backfillMailbox(..., { purpose: "history" })` (`stages/stage-06-history-job.md:25`). It also calls `refreshFlags`, which needs an open provider (:28).
- At HEAD, `backfillMailbox` (`apps/server/src/modules/mail/tools.ts:258-279`) opens IMAP through `loadImapOptions` (`tools.ts:53-71`). That function always builds `auth: { kind: "password", password }` from the decrypted secret.
- For an OAuth mailbox (`secret_kind = 'oauth'`, `mail/oauth/apply.ts:239`), the secret is the encoded OAuth secret. Only `openMailboxProvider` (`mail/open.ts:48-55`) turns it into an XOAUTH2 access token. `loadImapOptions` does not.
- Result: the history check of every OAuth mailbox (Gmail, Microsoft) fails at login on each attempt. It ends `no_result` / `stopped` after 3 attempts (stage 06:11), and `trust_report_ready` then reports no result (stage 07:86). The refresh's own "Not verified" line (`plan-refresh-1.md:73`) leaves this to the worker to "check". The code shows the path is broken, and no stage holds the decision or a test for the fix.
- Fix in the plan:
  - Stage 05 Step 1 gets a decision: the history path opens the mailbox through `openMailboxProvider` with `oauthTokens` wired by the composition root, not through `loadImapOptions`. The `refreshFlags` call of stage 06 uses the same opener.
  - Add a test: an OAuth mailbox (fake `oauthTokens`, fake `openProvider` that records `auth.kind`) gives `auth.kind === "oauth"`, and the backfill stores the history rows.
  - Also decide what happens to an auth refusal during a check (`protocolDisabled` / `MailAuthError`). Today it is a plain step error, so a check against a revoked grant burns 3 attempts.

## Unverified checks

- None for this plan-only candidate. I ran no stage Proof (no code changed). I ran no `test:int` (the job has no DB).

## Notes

**N1. Stage 04 and stage 08 conflict, and the conflict pauses `auto` for flag-off orgs.** Proven by reading (not blocking: no ticket acceptance bullet covers it, but P8 and D7 break).
- Stage 04 flag-off path: the old real-label `setCategoryAutoWithGate` "also writes a grant with the running key (`by: "evidence"` on a real-label `go`…)" (`stages/stage-04-grant-and-gate.md:26`). At HEAD that function grants on a real-label `go` (`apps/server/src/modules/triage/gate.ts:88-101`).
- Stage 08 checks each `evidence` grant every 5 min, "for every org, with or without `trust_ladder`" (`stage-08-regate.md:13,16`). If the global evidence "is no longer a non-provisional `go`", it pauses the category with `evidence_changed`.
- At HEAD the running key has no non-provisional `go` file (v2: `info` provisional `go`, the rest `no-go`). So a flag-off user who turns `auto` on from real labels gets it turned off within 5 min. They also get the misleading text "new test results no longer support them" (stage 10:107). Every org is flag-off after the deploy.
- Stage 08:13 is also wider than plan D8 (`plan.md:30`: "A newer `no-go` file for the same key → trip `evidence_changed`").
- Fix: the flag-off path writes a distinct `by` (for example `real_labels`) that the evidence check skips, or the evidence check runs only for grants made under `trust_ladder`. Add a stage 08 test: a flag-off real-label grant plus a provisional-only index gives no pause.

**N2. Stage 16 test 7 cannot fail.** Proven by code read. `renderDigest` (`packages/core/src/digest/digest.ts:214-222`) drops items until the text is ≤ 4096. So "a 15-item digest … ≤ 4096 characters" (`stage-16-why-lines.md:28`) always holds. The real risk is that the suffixes and the F109 `📎` line push items out of the digest. Test 7 should assert that all 15 items stay listed, or it should state the accepted drop.

**N3. The confidence or rule suffix can have no line to sit on.** Plausible. The suffix goes on the `💬` line (stage 16:17). That line exists only when `aiText` is non-empty (`digest.ts:132`), and `aiTextFor` returns `reason`, which can be null (`packages/core/src/digest/ai-text.ts:24-25`). No decision covers an item without a `💬` line. Also, an `unsure` item's `aiText` already holds a percent (`ai-text.ts:21`), so the suffix shows a second percent. No decision covers that either.

**N4. Stage 18 SLO: "first urgent outbox row" is ambiguous.** Plausible. `stage-18-quiet-hours-channel.md:14` does not say whether "first" means first created or first sent. `noticeAt` is `MIN(sent_at)` over all urgent rows of the mail (`apps/server/src/modules/channels/metrics-repo.ts:84-87`). If the worker takes the quiet hours of another row's user, `lateMin` can hide a real delay or report a false one. Also no decision covers the case where no row has been sent yet (`noticeAt` null, `now` used, several pending rows with different hours).
- Suggestion: the user of the row that gave `noticeAt`. With no sent row, compute `lateMin` per pending row's user and take the smallest.

**N5. Stage 26 check 3 expects "one line", but stage 08 logs more.** Proven by reading. `stage-26-vps-deploy.md:25` expects one `trust_regate_done` line in `--since 15m`. Stage 08 logs that event on each run: at start and in the 5-min job (`stage-08-regate.md:8,34`), so 15 minutes hold up to 4 lines. Name which line counts (the first), or add a code field (`run: start|job`) to `platform/log-fields.ts`.

**N6. Stage 26 skips the checklist's contract-mark paragraph.** Plausible. Stage 26 cites checklist steps 1–7 (:10). It omits the last paragraph of `docs/release-checklist.md`: a migration with `-- contract: v<x.y.z>` needs that release "deployed already, and it must be the release that you can roll back to. Check this before step 8." Stage 03 writes the mark at build time (`stage-03-migration.md:17`, Q17). If another release ships before stage 26, the named release is not the rollback target. Stage 26 should state that this is expected for this expand-only mark and is no stop.

**N7. Stage 20's out-of-scope line is out of date.** Plausible, low risk. `stage-20-mail-append.md:75` says "OAuth adapters (E9 implements `appendMessage` there)". F117 is landed: OAuth mailboxes are IMAP XOAUTH2, and the committer opens them through `openMailboxProvider` (`apps/server/src/modules/actions/committer.ts:220`). The draft path that stage 20 points to therefore covers OAuth already. The old line can make a worker exclude OAuth report mailboxes.

**N8. The facts heading still names the old base.** Proven by reading, drift only. The status line says the base is 17b2a369 and refresh 1 updated F1. The heading still reads `## Facts checked (2026-11-15, 9341d9f0)` (`plan.md:41`).

**Refresh changes confirmed sound:**
- Stage 02 role filter: needed. `extractor-…-vsent-v1.json` fails `gateFileSchema`; the v2 and v3 classifier files parse (probe).
- Stage 03 Q17: confirmed. The probe flags exactly the `memberships` FK and the pair check as `add_constraint`. It does not flag the drop-and-add of `outbox_kind_check` / `outbox_channel_check` or the inline new-column CHECKs.
- Stage 03 outbox kind list: `20261115150001_outbox_sent_missing.sql` is still the newest that changes the list. F116's migrations did not change it.
- F113 demo seed (`lab/demo-seed/tables.ts`): it covers no F110 table, and the stage 22 bool column adds no FK or JSON. No stage break.
- Stage 18 `local-time.ts`: `isQuietTime`, `quietEnd` and `lateMin` already take `quiet` (`local-time.ts:125-163`).
- Stage 26: the `release.sh` and `rollback.sh` last lines match `deploy/release.sh:116` and `deploy/rollback.sh:71`.

**Plan size:** no stage is too big. Stage 05 grows with the B1 fix and stays at two steps.

## Checks run

- `git rev-parse HEAD` → 399360e1dc3dcace6bdf66f5cda972ca67dffe40.
- `git log --oneline 17b2a369..HEAD` → only 399360e1 (the refresh commit).
- `git log --oneline 9341d9f0..HEAD` → 537 commits (read).
- `bun install --frozen-lockfile` → 991 packages installed.
- `bun run db:check-migrations` → `ok: 1 migration file(s) after 20261115160001`.
- Probe (temporary `bun test` file in the worktree, deleted after):
  - `checkMigrationSql` on a stage-03-shaped migration → `[{"line":11,"rule":"add_constraint"},{"line":12,"rule":"add_constraint"}]` (the FK and the pair check only).
  - `gateFileSchema.safeParse` over `evals/results/gate/*` → classifier v2 true, classifier v3 true, extractor false.
- Code reads at HEAD:
  - B1: `mail/tools.ts:53-71,258-279`, `mail/open.ts:37-90`, `mail/oauth/apply.ts:173-265`.
  - N1: `triage/gate.ts:71-101`.
  - N2, N3: `digest/digest.ts:124-222`, `digest/ai-text.ts`.
  - N4: `operator/slo-checks.ts:63-93`, `channels/metrics-repo.ts:48-125`, `digest/local-time.ts`.
  - N5, N6, stage 26: `deploy/release.sh`, `deploy/rollback.sh`, `docs/release-checklist.md`, `docs/code-patterns.md:197-200`.
  - N7: `actions/committer.ts:220`.
  - Demo seed: `lab/demo-seed/tables.ts`, `lab-demo-seed.test.ts:339-376`.

## Note check

- HEAD is 399360e1dc3dcace6bdf66f5cda972ca67dffe40: proven. `git rev-parse HEAD` (run alone, exit 0, output 399360e1dc3dcace6bdf66f5cda972ca67dffe40).
- Each refresh-1 stage (02, 03, 05, 08, 16, 18, 26) is checked against code at HEAD, with file:line per finding: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-15-f110-plan-review-refresh-1-91928f01/findings.md` (B1, N1–N8 with paths).
- Landed changes since 9341d9f0 are checked against unchanged stages: proven. `git log --oneline 17b2a369..HEAD` (run alone, exit 0, only the refresh commit) shows nothing landed after the refresh base. The cross-check of F117, F113, F114 and F116 is recorded in `findings.md`.
- The final message's first line is `PASS <sha>` or `FAIL <sha>`, and only a proven break is blocking: proven. This message opens with `FAIL 399360e1dc3dcace6bdf66f5cda972ca67dffe40`, and its one blocking finding (B1) is proven by code read against an acceptance bullet.
- Easy-to-miss rule ("Missing code detail … is not a finding; a missing decision, edge case, test or interface is"): followed. Each finding in `findings.md` names a missing decision (B1, N1, N4), a test that cannot fail (N2), an edge case (N3), a runbook conflict (N5, N6) or doc drift (N7, N8). None asks for line numbers, edit text or file lists.
