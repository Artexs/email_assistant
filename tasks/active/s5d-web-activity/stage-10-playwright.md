# s5d-web-activity — Stage 10

Part of [`../s5d-web-activity.md`](../s5d-web-activity.md). Read that file's "Done when", "Owns", A1–A10, "Facts checked", B1–B15, "Rules for every step", "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first. User step 1 (GreenMail runs) comes before this stage.

## Stage 10 — e2e data and `activity.spec.ts`

Two steps. Read `notes/2026-11-11-web-settings-rules-facts.md` § "The e2e members" and `notes/2026-11-11-web-mailboxes-facts.md` (the e2e setup) first.

- [ ] **10.1 The second organization in the seed, the activity rows script (B12)**
  - Goal: the e2e run has a mail of another organization, and a spec can fill its own connected mailbox with activity rows.
  - Files: change `apps/server/src/scripts/e2e-seed-args.ts`, `e2e-seed.ts`, `apps/server/test/integration/e2e-seed.test.ts` (only if a case reads `SeedFile`); create `apps/server/src/scripts/e2e-activity-rows.ts`, `apps/server/src/scripts/e2e-activity.ts`, `apps/server/test/integration/e2e-activity.test.ts`.
  - Interfaces:

    ```ts
    // e2e-seed-args.ts
    export const E2E_OTHER_ORG_NAME = "E2E Other";
    export const E2E_OTHER_OWNER_EMAIL = "e2e-other-owner@x.test";
    export interface SeedFile {
      // … the S5c fields stay
      otherOrg: { orgId: string; emailId: string };
      activityMembers: Record<E2eProject, { userId: string; email: string; password: string }>;
    }
    export const E2E_ACTIVITY_MEMBER_EMAILS: Record<E2eProject, string> = {
      mobile: "e2e-activity-mobile@x.test",
      desktop: "e2e-activity-desktop@x.test",
    };

    // e2e-seed-args.ts (values the Playwright runner imports; this file imports only `pg`)
    export const ACTIVITY_SUBJECTS = {
      moved: "E2E moved notification",
      reply: "E2E reply needed",
      unsure: "E2E unsure mail",
      delegated: "E2E delegated task",
    } as const;
    export const activityFillerSubject = (n: number): string => `E2E filler ${n}`;
    export const ACTIVITY_FILLERS = 52;

    // e2e-activity-rows.ts
    export interface ActivitySeedResult {
      emailIds: { moved: string; reply: string; unsure: string; delegated: string };
      total: number; // 56
    }
    export async function seedActivityRows(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      mailboxId: string,
      now: Date
    ): Promise<ActivitySeedResult>;
    export async function seedOtherOrgMail(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      now: Date
    ): Promise<{ mailboxId: string; emailId: string }>;
    ```

  - Decisions:
    - Both seed functions write with direct Kysely inserts in one transaction (the pattern of `test/integration/fixtures.ts`; a script never imports from `test/`). Columns: `emails` (`org_id`, `mailbox_id`, `dedup_key` `e2e:<random>`, `thread_key` `e2e:<random>`, `content_hash` `e2e`, `uid` from 900001 up, `received_at`, `status: "triaged"`, `folder` and `source_folder` `"INBOX"` (fact 9), `subject`, `from_address`, `message_id_header` `<e2e-activity-<n>-<random>@ea-seed.test>`), `triage_results` (`category`, `confidence`, `reason_code`, `reason`, `fields`, `created_at` = `received_at` + 1 min), `actions` (`type`, `status`, `payload`, `idempotency_key` `e2e:<random>`, `applied_at` for `applied`, `approved_at` only where the CHECK needs it), `delegates`, `delegations`. The rows of B12 (b): M1 moved notification (move `{ folder: "ai_notifications" }` + `mark_read`, applied at `now − 1 h`, sender `shop@e2e.test`), M2 reply (`flag` applied, sender `anna@e2e.test`), M3 unsure (`fields: { model_category: "info" }`, no action), M4 delegated (delegate "Ola" `e2e-delegate-<random>@x.test` (the unique index is `(org_id, email)`; the mailbox is removed after each test, the delegate row is not: use a random address), `create_draft` applied with the payload `draft: DraftPayload = { kind: "delegation", delegate_id, delegate_name: "Ola", to: [address], task: "Send the Q4 report", due_date: "", language: "en" }`, `send` `awaiting_approval` with `depends_on_action_id` = the draft, payload `sendPayloadFor(draft)` (`@ea/core`; the shape of `insertDraftAndSend`, `fixtures.ts:351-450`), and `notified_at = now` (so the e2e server's approval notice job leaves it alone); a `delegations` row `drafted` with `due_at = now + 2 days` and `task_summary` "Send the Q4 report"), F1–F52 fillers (`info` 0.9, `received_at = now − 2 days − n min`, reason "A newsletter.", no action).
    - `seedOtherOrgMail`: a mailbox `e2e-other@e2e.test` with `status: "paused"` (`imap_host` `127.0.0.1`, ports 3143/3025, `capabilities` `{}`, no credentials row), its INBOX row in the sync folder table if a mailbox needs one (read `insertInboxFolder` in `mail/repo.ts:198` and copy its insert), one `notification` mail with an applied move (synthetic Message-ID).
    - `e2e-seed.ts`: after the S5c part, `createOrganizationWithOwner(db, { orgName: E2E_OTHER_ORG_NAME, timezone: "Europe/Warsaw", email: E2E_OTHER_OWNER_EMAIL, displayName: "E2E Other Owner" })`, then `seedOtherOrgMail`; `SeedFile.otherOrg`; one more `assistant` per project in the `E2E` organization with the password `E2E_MEMBER_PASSWORD`, set in process like the S5c members (`SeedFile.activityMembers`): `account.spec.ts` changes the password of `members[project]` and runs before `activity.spec.ts` (cold review finding 1). `wipe` deletes `organizations WHERE name = ANY($1)` with both names and adds `E2E_OTHER_OWNER_EMAIL` and the two activity member e-mails to the user list. `cleanUpOrg` (web helper) does not change.
    - `e2e-activity.ts`: args `--mailbox-id <uuid>` (else usage and exit 2); `seedTargetOk(config.DATABASE_URL, process.env.MIGRATOR_DATABASE_URL ?? "")` → refuse with exit 1 before any connection; read the organization with a `pg` `Client` on the migrator URL (`SELECT org_id FROM mailboxes WHERE id = $1`; none → exit 1 "mailbox not found"); `createDb(config.DATABASE_URL)`, `assertAppRole(db)`, `seedActivityRows(db, { orgId }, mailboxId, new Date())`; one `info` line `seeded <total> activity rows for mailbox <id>`; exit 0. The same `main().then(process.exit)` frame as `e2e-seed.ts`.
  - Test (`e2e-activity.test.ts`, integration, `withRollback`; the functions take a `Db`: pass the transaction (`Transaction<DB>` is a `Kysely<DB>`; widen the parameter type to `Db | Transaction<DB>` and open the inner transaction only when `!db.isTransaction`)):
    1. `seedActivityRows` on a `createOrgWithMailbox` mailbox → 56 mails; `listActivity(trx, ctx, { notRated: false, limit: 100 }, now)` returns 56 items; M1 has `phrase` `"done: move to AI/Notifications, mark read"` and `undoable: true`; M3 has `category: "unsure"`; M4 has `delegation.status` `"drafted"`, `delegateName` "Ola" and a `phrase` with `"draft a delegation to Ola"` and `"waits for your approval"`.
    2. `undoWithFeedback` on M1 with scope `synthetic` → `started` (the synthetic Message-ID and the active mailbox pass the M9 check).
    3. Two calls on two mailboxes of one organization do not clash (unique keys are random), and the delegate insert does not hit `delegates_org_email_key`.
    4. `seedOtherOrgMail` → a paused mailbox; the mail id is found by `getLabelTarget` with its own context and not with another context.
    5. The script refuses a non-e2e database: run `bun apps/server/src/scripts/e2e-activity.ts --mailbox-id <uuid>` with `DATABASE_URL` and `MIGRATOR_DATABASE_URL` of the test database (names without `_e2e`) → exit code 1 and `refusing` on stderr; no row written (the pattern of `e2e-seed.test.ts:50-75`).
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: the spec (10.2).

- [ ] **10.2 `activity.spec.ts` (B14)**
  - Goal: the S5d done-when holds in the browser, in both projects.
  - Files: create `apps/web/e2e/tests/activity.spec.ts`; change `apps/web/e2e/helpers.ts` (one helper).
  - Interfaces:

    ```ts
    // helpers.ts
    // Fills the connected mailbox with the activity rows (B12). Runs the server script with the e2e env.
    export function seedActivity(mailboxId: string): void;
    ```

  - Decisions:
    - `seedActivity`: `execFileSync("bun", ["apps/server/src/scripts/e2e-activity.ts", "--mailbox-id", mailboxId], { cwd: repoRoot, env: e2eEnv(), stdio: "pipe", timeout: 30_000 })` (`e2eEnv` and `repoRoot` from `./env`; `node:child_process`). It throws with the script's stderr on a non-zero exit.
    - The spec (serial, block 90/190, `test.setTimeout(90_000)` in `beforeEach` or per test: a GreenMail connect plus the seed script plus a long test 1; `settings.spec.ts:48` needs 60 s for less): `beforeEach`: `x-forwarded-for` = `nextAddress(base)`; `errors = await cspErrors(page)`; sign in as the owner (`readSeed().owner`), expect `/onboarding`; `page.goto("/mailboxes?connect=1")`; `connectGreenMail(page, project)`; the mailbox id from `GET /api/mailboxes` (the one with `mailboxAddress(project)`); `seedActivity(id)`; `page.goto("/activity")`. `afterEach`: `cleanUpOrg(page)`; `expect(errors).toEqual([])`.
    - Locate a row by its subject: `page.locator("li[data-email-id]").filter({ hasText: ACTIVITY_SUBJECTS.moved })` (`ACTIVITY_SUBJECTS` from `e2e-seed-args.ts`, which `env.ts` already imports in the Playwright runner).
    - Radix `Select`: `page.getByRole("combobox", { name: en.act_filter_category }).click()` then `page.getByRole("option", { name: en.act_needs_action }).click()`.
    - Tests (each runs in both projects):
      1. "rows, panel, filters and load more": 50 rows (`li[data-email-id]`), the "Updated" line shows; the M1 row contains `🔔 Notification`, `93 %` and `done: move to AI/Notifications, mark read`; the M3 row has no button named `t("act_btn_right", { category: "Unsure" })` and the M4 row has no button named `t("act_btn_right", { category: "Delegate" })` (✅ only on a label category, finding 2); the M4 row contains `Ola · Drafted`; a click on the M1 text opens the panel (`getByRole("dialog")` with `en.act_panel_title`), which contains `Automated shipping update.`, `done: move to AI/Notifications` and `done: mark read`; Escape closes it. Category "Needs my action" → the URL has `category=action`, the M2 and M3 rows show, the M1 row does not; `page.reload()` → still filtered; back to "All categories"; ✅ on M1 (wait for its toast), then the switch "Only not rated" on → the M1 row is gone and the M2 row shows; switch off. Range stays "Last 7 days". "Load more" → 56 rows; the button is gone.
      2. "✅ and ✏️ save feedback": ✅ on M1 (the button with `aria-label` `t("act_btn_right", { category: "Notification" })`) → the toast `✅ Saved: Notification is right.`; open the panel → `You said: right`; ✅ again **inside the open panel** (`getByRole("dialog").getByRole("button", { name: … })`; this is the bottom-sheet check of "Not verified yet" in the `mobile` project) → `Already saved.`; close; ✏️ on M2 → the dialog `act_pick_title` → the button `ℹ️ Info` → the toast `✏️ Saved: Info (AI said Reply).`.
      3. "↩️ starts the Undo": ↩️ on M1 (`aria-label` `en.act_btn_undo`) → the toast `↩️ Undo started: the mail goes back within a minute.`; the M1 row has no ↩️ any more and shows `Undo started`.
      4. "another organization's mail is not found": `page.request.post("/api/feedback", { headers: { origin: E2E_BASE_URL }, data: { emailId: readSeed().otherOrg.emailId, trueCategory: "info" } })` → 404 and body `{ error: "not_found" }`; the same for `/api/actions/undo` with `{ emailId }`.
      5. "an assistant member rates mail": a second context (`browser.newContext({ baseURL: E2E_BASE_URL, extraHTTPHeaders: { "x-forwarded-for": nextAddress(base) } })`, the S5c `account.spec.ts:53` pattern), sign in as `readSeed().activityMembers[project]`, `/activity` shows the M2 row; ✅ on M2 → `✅ Saved: Reply is right.`; close the context.
    - The toast texts are read from `en` with `t()` where a key exists (`t("act_toast_right", { category: "Notification" })`), so a text change breaks one place only.
    - The tests are independent: each test gets fresh rows (`beforeEach` seeds, `afterEach` removes the mailbox and its rows).
  - Check: GreenMail runs; `bun run web:build`; `TELEGRAM_BOT_TOKEN= WEB_MAIL_ALLOW_LOCAL=true bun run test:e2e` → 40 passed (30 before + 10). Then once `DEBUG=pw:webserver TELEGRAM_BOT_TOKEN= WEB_MAIL_ALLOW_LOCAL=true bunx playwright test -c apps/web/e2e/playwright.config.ts tests/activity.spec.ts 2>&1 | grep -E "failed mail_not_found| ERROR |error" | head` (the "Not verified" items: the committer ends both reverse rows of M1 (move and `mark_read`) with `failed mail_not_found` (two `warn` lines per project), and no `error` line comes from the server; write the result in the log; the exact config path and grep may need a small adjustment, note it).
  - Done when: 40 passed in both projects; the log line names the server-output result.
  - Out of scope: the group review (stage 11).
