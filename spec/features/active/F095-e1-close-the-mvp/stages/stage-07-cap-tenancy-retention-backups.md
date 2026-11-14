# F095 stage 07 — Pages `tenancy-and-plans.md`, `retention.md`, `backups.md`; final shape of `architecture.md`

Part of [`../plan.md`](../plan.md). Decisions D1, D2, D4–D7, D19, D5. Read "Rules for every stage" and the method box of [`stage-03-cap-sync-triage.md`](stage-03-cap-sync-triage.md) ("How to write a page", items 1–8) first.

The last three pages, the last §8 moves, and a check that `architecture.md` has the D5 frame. Four steps. Docs only.

## Step 1 — `docs/capabilities/tenancy-and-plans.md` ("Tenancy and plans")

- **Goal:** an agent knows how organizations, members, roles, plan states, the mailbox limit, feature flags and the operator role work.
- **Seams:** `apps/server/src/modules/tenancy/` (`index.ts`, `service.ts`, `repo.ts`, `features.ts`, `routes.ts`, `operator-routes.ts`), `packages/core/src/tenancy.ts`, `packages/core/src/features.ts`, `apps/server/src/platform/http.ts` (`requireTenant`, `requireOwner`, `requireOperator`), scripts `org-create.ts`, `org-plan.ts`, `org-status.ts`, `org-flag.ts`, `org-invite.ts`; `docs/architecture.md` §5 (tenant tables) and §7 (isolation rules) stay; link them. ADR 0001, 0027.
- **Must cover:** organizations and memberships, the owner role, the tenant filter rule (`TenantContext`, `org_id`; link `docs/code-patterns.md` § Data access), plan states `trial`, `active`, `suspended` and what `suspended` stops, resume and `resumed_at`, the 48 h rule, the mailbox limit, `bun run org:create`, `org:plan`, `org:status`, `org:flag`, `org:invite`, feature flags (`isFeatureOn`, `org_features`, `FEATURES_OFF`), the operator role (`OPERATOR_USER_IDS`, `/api/operator/flags`).
- **Moves from `architecture.md`:** §8 bullets "Plan state (S6a)" (with its sub-bullets) and "Feature flags (F087)" → "Rules".
- **Limits (at least):** no sign-up and no billing (PD-001, PD-047); no account delete or export (E7-T3 F106); no operator console page (E7-T2 F099); RLS not in place (F092, by folder name).
- **Decisions:** ADR 0001, 0027 (proposed or accepted: read its status line); PD-045, PD-046, PD-047.
- **Tests:** `apps/server/test/integration/tenancy-*.test.ts` (list the files), `scope-two-orgs.test.ts`, `org-cli.test.ts`, `org-flag-cli.test.ts`, `packages/core/src/features.test.ts`, `packages/core/src/tenancy.test.ts`.
- **Done when:** the page exists; method items 1–8 hold.

## Step 2 — `docs/capabilities/retention.md` ("Retention")

- **Goal:** an agent knows which stored texts expire, when, and which code clears them.
- **Seams:** `apps/server/src/retention.ts`, the clear functions it imports (`clearMailBodies`, `clearMailHeaders`, `clearTriageTexts`, `clearActionPayloads`, `clearActionErrors`, `clearDelegationTasks`, `clearOutboxTexts`, `deleteOldLinkTokens`, and the `auth_verifications` delete of F078: find it), `organizations.data_retention_days`; `docs/architecture.md` §7 retention table (stays: the page links it for the periods and does not copy the table).
- **Must cover:** the `platform.retention` job and schedule, each clear function with its table and period source (link the §7 row), the keep rule for open delegation drafts, one log line with counts only, crash safety (batches, safe to repeat), suspended organizations are cleared too.
- **Moves from `architecture.md`:** the retention-job sentence of the §8 Scheduler bullet (detail only; the job name stays in the list).
- **Limits (at least):** no account delete or export (E7-T3 F106); no DSR erase (E7-T3, PD-038).
- **Decisions:** ADR 0008 (audit rows are kept), PD-038 (Limits).
- **Tests:** `apps/server/test/integration/retention-job.test.ts`, `retention-clear.test.ts`.
- **Done when:** the page exists; method items 1–8 hold.

## Step 3 — `docs/capabilities/backups.md` ("Backups")

- **Goal:** an agent knows how the database is backed up, where the copy goes, how a restore is tested, and what a restore must do after.
- **Seams:** `deploy/backup.sh`, `deploy/backup.env.example`, `deploy/restore-test.sh`, `deploy/README.md` § Backups and § Update, `apps/server/src/platform/heartbeat.ts` (the heartbeat is in §8 Liveness; link it, do not move it).
- **Must cover:** the nightly run (03:30), `pg_dump`, `age` with the public key only on the VPS, `rclone` to Backblaze B2 with a write-only key, the remote lifecycle rule, `deploy/restore-test.sh` (throwaway container, row counts), the rule after a real restore (`delete from auth_sessions;`), the backup before each deploy (`deploy/README.md` § Update).
- **Moves from `architecture.md`:** §8 bullet "Backups" → "Rules".
- **Limits (at least):** no timed restore drill on a clean VM yet (E8b F114, PD-054); no backup-age alert (E8b, PD-052).
- **Decisions:** ADR 0011; PD-052, PD-054 (Limits).
- **Tests:** none in the suites; write "No automated test. The restore test is `deploy/restore-test.sh`, run by hand (`deploy/README.md` § Backups)."
- **Done when:** the page exists; method items 1–8 hold.

## Step 4 — Final shape of `docs/architecture.md`

- **Goal:** `architecture.md` has the D5 frame and the index lists ten pages.
- **Edits:**
  1. §8 "Scheduler" bullet becomes a job list: one table `| Job | Schedule | Page |` with every `scheduler.add(...)` of `apps/server/src/main.ts` at your base (name, cron text, link to the page that describes it), plus the one-line rules that stay: "one tick never overlaps the next" and the `croner` scheduler. The detail sentences that stages 03–06 did not move yet move now to the page of the job.
  2. §8 keeps only: Scheduler (the table), Work queue, Liveness, `GET /health`, Logging, and the link lines. Any other §8 bullet that is left: move it to the page whose module owns it and name it in the final message.
  3. `docs/capabilities/README.md`: delete the line `Planned pages (F095 stages 03–07): …` under the index table (all ten pages exist now).
- **Check:**
  1. `awk '/^## 8\./,/^## 9\./' docs/architecture.md | grep -c "^- \*\*"` → 5 (Scheduler, Work queue, Liveness, `GET /health`, Logging), plus the link lines.
  2. `grep -c "Moved to \[docs/capabilities/" docs/architecture.md` → 14 or more.
  3. `grep -c "^| \[" docs/capabilities/README.md` → 10 and `ls docs/capabilities/*.md | wc -l` → 11.
  4. `wc -l docs/architecture.md` → write the number in the final message (it was 814 at `9d9bfb8`).
  5. `bun test apps/server/src/capability-map.test.ts` → 0 fail.
- **Done when:** checks 1–3 and 5 hold.
- **Out of scope:** §1–§7 and §9–§12 (apart from link lines that earlier stages wrote).

## Review focus

Ten claims against the code across the three pages (plan-state effects, mailbox limit, flag read order, retention periods against §7, backup script steps). §8 keeps exactly the D5 bullets. No moved rule is lost: compare `git show <stage 01 base>:docs/architecture.md` §4.1 rules 6–8, §4.4–§4.6 and §8 with the ten pages (a reviewer greps three distinctive phrases per moved block).

## Done when

- Steps 1–4 hold.
- The Proof command of `plan.md` (`/tmp/f095-s07`, files: `docs/capabilities/tenancy-and-plans.md docs/capabilities/retention.md docs/capabilities/backups.md docs/capabilities/README.md docs/architecture.md` plus each other `.md` file whose references you changed) prints `PROOF_OK`.
