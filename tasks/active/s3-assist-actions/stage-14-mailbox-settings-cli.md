# s3-assist-actions — Stage 14

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 14 — CLI `mailbox:settings`: mode, auto (go/no-go check), switches [risky]

Why risky: these settings are the policy gate. A wrong `auto` or mode moves real mail. Every change is a locked, audited update with a printed before/after table.

- [ ] **14.1 Settings service in `config` (D13, P3)**
  - Goal: typed, audited functions change `mailbox_settings` one field at a time; the mode switch to `assist` sets the P3 switches.
  - Files: create `apps/server/src/modules/config/service.ts`, `apps/server/test/integration/config-settings.test.ts`; change `apps/server/src/modules/config/repo.ts`, `apps/server/src/modules/config/index.ts`, `apps/server/src/modules/audit/repo.ts` (`auditEvents`: `mailboxModeChanged: "mailbox.mode_changed"`, `mailboxPolicyChanged: "mailbox.policy_changed"`, `mailboxSwitchChanged: "mailbox.switch_changed"`); `packages/core/src/triage/settings.ts` (`ASSIST_DEFAULT_SWITCHES: Partial<ToolSwitches> = { move: true, mark_read: true, flag: true, move_unsure: false }`, `toolSwitchNames`, `describeSettings(settings): string[]` pure lines for the table).
  - Interfaces:

    ```ts
    // config/repo.ts
    export async function lockMailboxSettings(trx, ctx, mailboxId): Promise<MailboxSettingsRow | undefined>; // FOR UPDATE
    export async function updateMailboxSettings(
      trx,
      ctx,
      mailboxId,
      patch: { mode?: MailboxMode; toolSwitches?: ToolSwitches; categoryPolicy?: CategoryPolicy }
    ): Promise<boolean>; // sets updated_at = now()
    // config/service.ts
    export interface SettingsDeps {
      db: Db | Transaction<DB>;
      now(): Date;
    }
    export interface SettingsView {
      mode: MailboxMode;
      toolSwitches: ToolSwitches;
      categoryPolicy: CategoryPolicy;
      movesSupported: boolean;
    }
    export async function getSettingsView(deps, ctx, mailboxId): Promise<SettingsView>;
    export async function setMode(
      deps,
      ctx,
      mailboxId,
      input: { mode: MailboxMode; keepSwitches: boolean; actor: string }
    ): Promise<{ changed: boolean; before: SettingsView; after: SettingsView }>;
    export async function setCategoryAuto(
      deps,
      ctx,
      mailboxId,
      input: {
        category: BarCategory;
        auto: boolean;
        threshold?: number;
        gate: { decision: GoDecision | "skipped"; precision: number | null; kept: number; forced: boolean };
        actor: string;
      }
    ): Promise<{ changed: boolean; before: SettingsView; after: SettingsView }>;
    export async function setToolSwitch(
      deps,
      ctx,
      mailboxId,
      input: { name: keyof ToolSwitches; value: boolean; actor: string }
    ): Promise<{ changed: boolean; before: SettingsView; after: SettingsView }>;
    ```

  - Decisions:
    - Every setter: one transaction, `lockMailboxSettings` (undefined → `HardError("no mailbox_settings row")`), parse the current json with the core parsers, compute the new value, `updateMailboxSettings`, audit with `actor` (the CLI passes `"cli"`; S5 passes the user id) and data `{ mailbox_id, field, from, to, forced? }` (strings and booleans; the threshold as a number). `changed` false when the value is the same (no audit row).
    - `setMode` to `assist` without `keepSwitches`: `toolSwitches = { ...current, ...ASSIST_DEFAULT_SWITCHES }` (`create_draft` untouched: S4 owns it); the audit data has `switches_set: true`. To `shadow`: switches untouched (the policy ignores them in shadow). `movesSupported` false (no MOVE and no UIDPLUS in `mailboxes.capabilities`) → the result carries `warnings: ["moves not supported: moves stay log only"]` (add `warnings: string[]` to the result type).
    - `setCategoryAuto`: `category` is a `BarCategory` (`urgent`, `needs_reply`, `info`, `notification`, `spam`); the Zod parse of the CLI refuses `unsure` and `delegation`. The service does not run the eval (no `config → triage` edge, modules §2): the caller passes `gate`. `auto: true` with `gate.decision !== "go"` and `!gate.forced` → `HardError("category did not pass go/no-go")`. The threshold: `input.threshold ?? (current threshold)`; the CLI passes the go/no-go row's threshold when the user gives none.
    - `setToolSwitch`: `name` in `toolSwitchNames`; `create_draft` is accepted but printed with "(S4: no effect yet)".
  - Test (`config-settings.test.ts`, `withRollback`, `insertDefaultSettings`): (1) `setMode assist` → mode `assist`, switches move/mark_read/flag true, move_unsure false, audit `mailbox.mode_changed` with `switches_set` true; (2) `setMode assist` again → `changed` false, no audit row; (3) `setMode assist` with `keepSwitches` on a row with `move: false` → `move` stays false; (4) `setMode shadow` → mode shadow, switches untouched; (5) `setCategoryAuto info on` with `gate.decision = "go"` → `category_policy.info = { auto: true, threshold: <given> }`, audit `mailbox.policy_changed` with `forced` false; with `"no-go"` → throws; with `"no-go"` and `forced` → saved, audit `forced` true; `auto off` needs no gate; (6) `setToolSwitch flag off` → false, audit `mailbox.switch_changed`; (7) tenant: org B's ctx cannot change org A's row (`HardError`); (8) `getSettingsView` on a mailbox without MOVE and UIDPLUS → `movesSupported` false, and `setMode assist` returns the warning.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: the CLI (14.2), the S5 settings page.

- [ ] **14.2 The script `bun run mailbox:settings`**
  - Goal: the user can see and change the mode, the `auto` flags and the switches of a mailbox from the terminal, with the go/no-go gate enforced.
  - Files: create `apps/server/src/scripts/mailbox-settings.ts`, `apps/server/src/scripts/mailbox-settings-args.ts` (pure argument parsing, unit-tested), `apps/server/src/scripts/mailbox-settings-args.test.ts`; change `package.json` (`"mailbox:settings": "bun apps/server/src/scripts/mailbox-settings.ts"`), `deploy/README.md` (a short "Assist mode" section: the three commands, the gate, `ACTIONS_SCOPE`).
  - Interfaces (usage text):

    ```
    bun run mailbox:settings show   --org-id <uuid> --mailbox-id <uuid>
    bun run mailbox:settings mode   --org-id <uuid> --mailbox-id <uuid> --mode shadow|assist [--keep-switches]
    bun run mailbox:settings auto   --org-id <uuid> --mailbox-id <uuid> --category urgent|needs_reply|info|notification|spam --value on|off [--threshold 0.nn] [--force]
    bun run mailbox:settings switch --org-id <uuid> --mailbox-id <uuid> --name move|mark_read|flag|move_unsure|create_draft --value on|off
    ```

  - Decisions:
    - `auto … --value on` without `--force`: the script reads `listLabeledResults(db, ctx, mailboxId, { mail: "real" })`, builds `buildRealReport(rows, { bar: 0.98, minKept: 30, mail: "real", now })` and takes `report.goNoGo[category]`; prints `go/no-go <category>: <decision>, precision <p>, kept <n>, threshold <t>`; `decision !== "go"` → exit 2 with `refused: <category> did not pass go/no-go (use --force to set auto on anyway)`. With `--force`: the same line plus `FORCED`, and `gate.forced = true`. `--threshold` overrides the row's threshold; without the flag and without a `go` row the threshold stays as stored.
    - `show` prints the table from `describeSettings` (mode, each switch, each category with `auto` and threshold, `movesSupported`) and nothing else. Every subcommand prints the table after the change (`before → after` for the changed field).
    - Exit codes: 0 ok, 1 error or bad arguments, 2 refused by the gate.
    - Output holds ids, booleans and numbers only (no address: the user gave the mailbox id).
  - Test: `mailbox-settings-args.test.ts`: each subcommand parses; `--category unsure` is refused; `--value maybe` is refused; `--threshold 1.5` is refused. Manual run on the dev DB (GreenMail mailbox): `show`, `mode --mode assist`, `auto --category info --value on` → exit 2 (no real labels in the dev DB), `auto … --force` → exit 0, `switch --name move --value off`, `mode --mode shadow`; `select event, data from audit_log where event like 'mailbox.%' order by created_at desc limit 5;` shows the rows. Write the commands and the output lines (no ids beyond the mailbox id) in the stage log line.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`; the manual run above.
  - Done when: the unit tests pass and the manual run matches.
  - Out of scope: changing `ACTIONS_SCOPE` (env, the user), the S5 page.
