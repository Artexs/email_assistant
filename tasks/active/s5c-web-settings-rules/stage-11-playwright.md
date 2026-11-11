# s5c-web-settings-rules — Stage 11

Part of [`../s5c-web-settings-rules.md`](../s5c-web-settings-rules.md). Read that file's "Done when", "Owns", S1–S11, "Facts checked", B1–B16, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 11 — Playwright: the seed members, the cleanup, `settings.spec.ts`, `rules.spec.ts`, `account.spec.ts`

Needs user step 1 (GreenMail runs: `newgrp docker` + `bun run dev:up`). Runs in the worktree by the main session (the review copies run only lint, typecheck and unit tests).

- [x] **11.1 The seed members and the cleanup (B15, D19)**
  - Goal: each project has a member with a known password for the account test; every spec leaves the organization as it found it.
  - Files: change `apps/server/src/scripts/e2e-seed-args.ts`, `apps/server/src/scripts/e2e-seed.ts`, `apps/web/e2e/helpers.ts`.
  - Interfaces:

    ```ts
    // e2e-seed-args.ts
    export const E2E_MEMBER_EMAILS: Record<E2eProject, string> = {
      mobile: "e2e-member-mobile@x.test",
      desktop: "e2e-member-desktop@x.test",
    };
    // A test value, not a secret.
    export const E2E_MEMBER_PASSWORD = "e2e-member-passphrase-one";
    export interface SeedFile {
      orgId: string;
      owner: { userId: string; email: string; password: string };
      assistants: Record<E2eProject, { userId: string; email: string; setupUrl: string }>;
      members: Record<E2eProject, { userId: string; email: string; password: string }>;
    }
    // helpers.ts
    export async function cleanUpOrg(page: Page): Promise<void>; // + rules and organization reset
    export async function signInAs(page: Page, user: { email: string; password: string }): Promise<void>; // signIn with the object
    ```

  - Decisions:
    - The seed: after the assistants, per project `insertUser` (display name `E2E Member <project>`) + `insertMembership` (role `assistant`) + a reset link (`requestLink`) + `resetPassword({ newPassword: E2E_MEMBER_PASSWORD, token })` in process (the owner's way). `wipe` deletes the member e-mails too. The log line adds `members <ids>`.
    - `cleanUpOrg` (after the S5b part): `GET /api/rules` → `DELETE /api/rules/<id>` each; `PATCH /api/organization { timezone: "Europe/Warsaw", styleText: null }`; all with the `Origin` header; errors ignored (the S5b rule). The owner's digest times are reset with `PATCH /api/me/digest-times { times: [] }`.
    - `e2e-seed.test.ts` keeps passing (it tests the guards, not the users).
  - Test: `bun run test:e2e` still passes the 20 S5a and S5b tests; `.seed.json` has `members` (check the keys, never print the file into a log: it holds test passwords only, but keep the habit).
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int && bun run web:build && bun run test:e2e`.
  - Done when: the checks pass.
  - Out of scope: the specs (11.2).

- [x] **11.2 `settings.spec.ts`, `rules.spec.ts`, `account.spec.ts` (B15; the done-when)**
  - Goal: the S5c smoke tests run in both projects.
  - Files: create `apps/web/e2e/tests/settings.spec.ts`, `rules.spec.ts`, `account.spec.ts`.
  - Decisions (common): `test.describe.configure({ mode: "serial" })`; `beforeEach` sets `x-forwarded-for` from `nextAddress(base)` with the blocks of B15 (settings 60/160, rules 70/170, account 80/180), collects `cspErrors(page)`, signs in; `afterEach` runs `cleanUpOrg(page)` as the owner in the settings and rules specs (the account spec changes no organization data and skips it) and expects no CSP error. Texts come from `en` (no literal UI text in a spec, the S5b rule). `test.setTimeout(60_000)` where a GreenMail connect runs. Passwords come from `readSeed()` (`members[project].password`), never from an import of `e2e-seed-args.ts` (it imports `pg`; `seed.ts` imports it as a type only). Strict mode (cold review finding 17): a text that shows more than once needs a scope. The gate text shows in five category rows and in the dialog → assert it inside `page.getByRole("dialog")`; `set_owner_only` shows in two sections → `toHaveCount(2)`; `rules_all_mailboxes` shows in the filter, the scope select and a row → assert inside `page.locator("[data-kind=vip]")`; `en.save` shows in three cards → click it inside `page.locator("[data-card=digest]")` (and `signature`, `timezone`).
  - `settings.spec.ts` (owner; `/settings` after `connectGreenMail` on `/mailboxes`):
    1. "mode, switch and auto": the selector shows the project's mailbox; `en.mode_shadow` visible; click `en.mode_to_assist` → the dialog shows `en.assist_title` and the badge texts; click `en.assist_usual` → toast `en.mode_assist_toast`; the switch with the label `en.switch_move` is checked; click the `en.switch_flag` switch → toast with `t("switch_off_toast", { name: en.switch_flag })`. The `auto` switch of Info (`aria-label` `t("cat_auto_label", { category: en.cat_info })`) → the dialog `en.anyway_title` with the `gate_too_few` text (`t("gate_too_few", { kept: 0, minKept: 30, at: "0.5" })`) → `en.cancel` → the switch is not checked → again → `en.anyway_submit` → toast `t("auto_on_toast", { category: en.cat_info })` and the switch is checked. The folders card shows `en.folders_only_inbox`. Back to shadow: `en.mode_to_shadow` → toast `en.mode_shadow_toast`.
    2. "general: digest time, signature, timezone": `en.digest_add` → fill the time input with `08:00` → `en.save` in that card → toast `en.digest_saved_toast`; reload → the input has `08:00`. Fill the signature `E2E Owner\nCEO` → save → toast `en.sig_saved_toast`. Search `london` → select `Europe/London` (`selectOption`) → save → toast `t("tz_saved_toast", { timezone: "Europe/London" })` and `t("tz_current", { timezone: "Europe/London" })` visible. (`cleanUpOrg` resets all three.)
  - `rules.spec.ts` (owner; no mailbox needed): fill `boss@e2e.test`, kind VIP, scope all → `en.rules_add` → toast `en.rule_added_toast`, the VIP card lists `boss@e2e.test` with `en.rules_all_mailboxes`; the same again → the inline `en.err_rule_exists`; `@e2e.test` → the inline `en.pattern_invalid` and no request (count `POST /api/rules` requests with `page.on("request")`: still 2); delete with the button `t("rules_delete", { pattern: "boss@e2e.test" })` → toast `en.rule_deleted_toast`, `en.rules_empty` in the VIP card.
  - `account.spec.ts` (the project's seeded member, `readSeed().members[project]`):
    1. "an assistant sees the settings read-only": `/settings` → `en.set_owner_only` visible; no `en.mode_to_assist` button (the organization has no mailbox in this spec: `en.set_no_mailbox` shows; the general section shows the signature `Textarea` read-only and no timezone save button); `/rules` → `en.set_owner_only` and no `en.rules_add` button.
    2. "change the password and sign out everywhere": a wrong current password → the inline `en.acct_wrong_current`; the right one (`E2E_MEMBER_PASSWORD` → `e2e-member-passphrase-two`, the switch left on) → toast `en.acct_changed_others_toast`; `context.clearCookies()`, sign in with the new password (the second sign-in from this address in the test; the limit is 3 per 10 s) → lands on `/onboarding`; `/settings` → `en.acct_sign_out_all` → URL `/login`; `page.request.get("/api/me")` → 401. The seed resets the password on the next run (each run wipes and re-seeds), so no restore step is needed; each project has its own member.
  - Check: GreenMail up, the database guard, then `bun run web:build && bun run test:e2e`; run it twice (the cleanup works on a dirty organization).
  - Done when: every test passes in both projects, twice; the count is 20 + 2 × 5 = 30 (S5b 20, S5c five tests per project).
  - Out of scope: the `go` path of the gate (route and integration tests cover it, stage 2 and 5; an e2e `go` needs 30 labelled mails).
