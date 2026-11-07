# s3-assist-actions — Stage 14

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 14 — CLI `mailbox:settings`: mode, auto (go/no-go check), switches [risky]

Why risky: these settings are the policy gate. A wrong `auto` or mode moves real mail. Every change is a locked, audited update with a printed before/after table.

- [x] **14.1 Settings service in `config` (D13, P3)**
  - Goal: typed, audited functions change `mailbox_settings` one field at a time; the mode switch to `assist` sets the P3 switches; a change that closes a gate expires the `ready` rows it closes, in the same transaction (B3).
  - Files: create `apps/server/src/modules/config/service.ts`, `apps/server/test/integration/config-settings.test.ts`; change `apps/server/src/modules/config/repo.ts`, `apps/server/src/modules/config/index.ts`, `apps/server/src/modules/audit/repo.ts` (`auditEvents`: `mailboxModeChanged: "mailbox.mode_changed"`, `mailboxPolicyChanged: "mailbox.policy_changed"`, `mailboxSwitchChanged: "mailbox.switch_changed"`); `packages/core/src/triage/settings.ts` (`ASSIST_DEFAULT_SWITCHES: Partial<ToolSwitches> = { move: true, mark_read: true, flag: true, move_unsure: false }`, `toolSwitchNames`, `describeSettings(settings): string[]` pure lines for the table). Module edges (D16, M13, re-review RM1): one new edge, `config/service.ts` imports the `audit` index (`recordAudit`, `auditEvents`). `config` never imports the `actions` index at run time: the cycle `config → actions → mail → config` would follow, because `mail/connect.ts` imports `insertDefaultSettings` from `config`. The expiry comes in as the required dependency `SettingsDeps.expireReady`; `config/service.ts` imports only types from `actions` (`import type { ExpireFilter }`, erased at build time) and `MAILBOX_ACTION_TYPES` / `MailboxActionType` from `@ea/core` (stage 7.1a).
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
      // Required, so typecheck stops a caller that forgets it (the CLI now, the S5 page later). The caller passes `expireReady` from the actions index (stage 10).
      expireReady(
        trx: Transaction<DB>,
        ctx: TenantContext,
        filter: ExpireFilter,
        opts: { now: Date; reason: "policy_changed" | "undo" | "manual"; actor: string }
      ): Promise<{ id: string; emailId: string; type: ActionType }[]>;
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
    // every setter result also has `warnings: string[]` and `expired: number` (rows expired by this change)
    // config/service.ts, pure and exported for the test
    export function closedBy(
      change:
        | { field: "mode"; to: MailboxMode }
        | { field: "auto"; category: BarCategory; to: boolean; thresholdRaised: boolean }
        | { field: "switch"; name: keyof ToolSwitches; to: boolean }
    ): { types: MailboxActionType[]; category?: { is: string } | { not: string } } | null; // null = the change closes no gate
    ```

  - Decisions:
    - Every setter: one transaction, `lockMailboxSettings` (undefined → `HardError("no mailbox_settings row")`), parse the current json with the core parsers, compute the new value, `updateMailboxSettings`, audit with `actor` (the CLI passes `"cli"`; S5 passes the user id) and data `{ mailbox_id, field, from, to, forced? }` (strings and booleans; the threshold as a number). `changed` false when the value is the same (no audit row).
    - `setMode` to `assist` without `keepSwitches`: `toolSwitches = { ...current, ...ASSIST_DEFAULT_SWITCHES }` (`create_draft` untouched: S4 owns it); the audit data has `switches_set: true`. To `shadow`: switches untouched (the policy ignores them in shadow). `movesSupported` false (no MOVE and no UIDPLUS in `mailboxes.capabilities`) → the result carries `warnings: ["moves not supported: moves stay log only"]` (add `warnings: string[]` to the result type).
    - `setCategoryAuto`: `category` is a `BarCategory` (`urgent`, `needs_reply`, `info`, `notification`, `spam`); the Zod parse of the CLI refuses `unsure` and `delegation`. The service does not run the eval (no `config → triage` edge, modules §2): the caller passes `gate`. `auto: true` with `gate.decision !== "go"` and `!gate.forced` → `HardError("category did not pass go/no-go")`. The threshold: `input.threshold ?? (current threshold)`; the CLI passes the go/no-go row's threshold when the user gives none.
    - `setToolSwitch`: `name` in `toolSwitchNames`; `create_draft` is accepted but printed with "(S4: no effect yet)".
    - Gate close (B3, D13): the committer reads no settings (D16), so `ready` rows planned under the old setting would still run. When a setter's change is `changed` and `closedBy(change)` is not null, the same transaction runs `deps.expireReady(trx, ctx, { mailboxId, ...closedBy(change) }, { now, reason: "policy_changed", actor })` (stage 10; one `action.expired` audit row per row) and returns `expired` = the count. `closedBy` follows `decidePolicy` (`packages/core/src/triage/policy.ts`): mode to `shadow` → `{ types: ["move", "mark_read", "flag"] }`; `auto` of category c to off → `{ types: ["move", "mark_read"], category: { is: c } }` (`flag` does not depend on `auto`); `auto` of c stays on with a higher threshold than stored (`thresholdRaised`: mail with a confidence between the two thresholds is now `unsure`, but its rows were planned under c) → the same filter (fail-safe: all `ready` move and mark_read rows of c expire, re-review Rm6); switch `move` off → `{ types: ["move"], category: { not: "unsure" } }`; `move_unsure` off → `{ types: ["move"], category: { is: "unsure" } }`; `mark_read` off → `{ types: ["mark_read"] }`; `flag` off → `{ types: ["flag"] }`; `create_draft`, mode to `assist`, `auto` on (without a threshold raise) and switch on → null. Rows that a committer run holds now finish as `applied` (stage 7.1b) and keep their Undo.
  - Test (`config-settings.test.ts`, `withRollback`, `insertDefaultSettings`): (1) `setMode assist` → mode `assist`, switches move/mark_read/flag true, move_unsure false, audit `mailbox.mode_changed` with `switches_set` true; (2) `setMode assist` again → `changed` false, no audit row; (3) `setMode assist` with `keepSwitches` on a row with `move: false` → `move` stays false; (4) `setMode shadow` → mode shadow, switches untouched; (5) `setCategoryAuto info on` with `gate.decision = "go"` → `category_policy.info = { auto: true, threshold: <given> }`, audit `mailbox.policy_changed` with `forced` false; with `"no-go"` → throws; with `"no-go"` and `forced` → saved, audit `forced` true; `auto off` needs no gate; (6) `setToolSwitch flag off` → false, audit `mailbox.switch_changed`; (7) tenant: org B's ctx cannot change org A's row (`HardError`); (8) `getSettingsView` on a mailbox without MOVE and UIDPLUS → `movesSupported` false, and `setMode assist` returns the warning; (9) B3 `setMode shadow` on a mailbox with `ready` originals `move`, `mark_read`, `flag` and a `ready` `save_summary` and a `ready` reverse → the three originals `expired` / `policy_changed` with three `action.expired` rows (`actor` `cli`), the summary and the reverse stay `ready`, `expired` 3; (10) `setCategoryAuto info off` → the `info` mail's `move` and `mark_read` expire, its `flag` and a `spam` mail's `move` stay `ready`; (11) `setToolSwitch move off` → the `info` mail's `move` expires, the `unsure` mail's `move` stays; `move_unsure off` → the `unsure` mail's `move` expires; `flag off` → only `flag` rows; (12) a setter with `changed` false expires nothing; `setMode assist` expires nothing; (13) a `ready` `move` with a fresh `locked_at` (a committer run holds it) stays `ready` after `setMode shadow`; (13b) `setCategoryAuto info on` (gate `forced`) with `threshold` 0.95 on a row with `auto` on and threshold 0.7 (`thresholdRaised` = `auto` stays on and the new threshold is higher than the stored one) → the `info` mail's `ready` `move` and `mark_read` expire; the same call with threshold 0.5 (a lower one) expires nothing; (14) `closedBy` (unit, in the same file or `config-settings.test.ts`): every branch above, also `thresholdRaised`. The tests pass `expireReady` from the `actions` index in `SettingsDeps` (a test file is a composition root).
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: the CLI (14.2), the S5 settings page.

- [x] **14.2 The script `bun run mailbox:settings`**
  - Goal: the user can see and change the mode, the `auto` flags and the switches of a mailbox from the terminal, with the go/no-go gate enforced.
  - Files: create `apps/server/src/scripts/mailbox-settings.ts`, `apps/server/src/scripts/mailbox-settings-args.ts` (pure argument parsing, unit-tested), `apps/server/src/scripts/mailbox-settings-args.test.ts`; change `package.json` (`"mailbox:settings": "bun apps/server/src/scripts/mailbox-settings.ts"`), `deploy/README.md` (a short "Assist mode" section: the three commands, the gate, `ACTIONS_SCOPE`).
  - Interfaces (usage text):

    ```
    bun run mailbox:settings show   --org-id <uuid> --mailbox-id <uuid>
    bun run mailbox:settings mode   --org-id <uuid> --mailbox-id <uuid> --mode shadow|assist [--keep-switches]
    bun run mailbox:settings auto   --org-id <uuid> --mailbox-id <uuid> --category urgent|needs_reply|info|notification|spam --value on|off [--threshold 0.nn] [--force]
    bun run mailbox:settings switch --org-id <uuid> --mailbox-id <uuid> --name move|mark_read|flag|move_unsure|create_draft --value on|off
    bun run mailbox:settings expire-ready --org-id <uuid> --mailbox-id <uuid>
    ```

  - Decisions:
    - `auto … --value on` without `--force`: the script reads `listLabeledResults(db, ctx, mailboxId, { mail: "real" })`, builds `buildRealReport(rows, { bar: 0.98, minKept: 30, mail: "real", now })` and takes `report.goNoGo[category]`; prints `go/no-go <category>: <decision>, precision <p>, kept <n>, threshold <t>`; `decision !== "go"` → exit 2 with `refused: <category> did not pass go/no-go (use --force to set auto on anyway)`. With `--force`: the same line plus `FORCED`, and `gate.forced = true`. `--threshold` overrides the row's threshold; without the flag and without a `go` row the threshold stays as stored.
    - `show` prints the table from `describeSettings` (mode, each switch, each category with `auto` and threshold, `movesSupported`) and nothing else. Every subcommand prints the table after the change (`before → after` for the changed field).
    - Every subcommand that closes a gate prints `expired <n> ready actions` after the table.
    - `expire-ready` (B3): one transaction, `expireReady(trx, ctx, { mailboxId, types: MAILBOX_ACTION_TYPES }, { now, reason: "manual", actor: "cli" })`; prints `expired <n> ready actions` and then `ready mailbox actions left: <m>` (a count query of `ready` originals of `MAILBOX_ACTION_TYPES` of the mailbox; `m > 0` only while a committer run holds a row: run it again after 15 s). It is the step before `ACTIONS_SCOPE=all` (stage 20.1): real mail of the shadow-scope days must not move when the scope opens. The script imports `expireReady` from the `actions` index (the script is a composition root) and also passes it to every setter in `SettingsDeps.expireReady` (RM1).
    - Exit codes: 0 ok, 1 error or bad arguments, 2 refused by the gate.
    - Output holds ids, booleans and numbers only (no address: the user gave the mailbox id).
  - Test: `mailbox-settings-args.test.ts`: each subcommand parses (also `expire-ready`); `--category unsure` is refused; `--value maybe` is refused; `--threshold 1.5` is refused. Manual run on the dev DB (GreenMail mailbox): `show`, `mode --mode assist`, `auto --category info --value on` → exit 2 (no real labels in the dev DB), `auto … --force` → exit 0, `switch --name move --value off`, `mode --mode shadow` (prints `expired <n> ready actions`), `expire-ready` (prints `expired 0 ready actions` and `ready mailbox actions left: 0`); `select event, data from audit_log where event like 'mailbox.%' order by created_at desc limit 5;` shows the rows. Write the commands and the output lines (no ids beyond the mailbox id) in the stage log line.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`; the manual run above.
  - Done when: the unit tests pass and the manual run matches.
  - Out of scope: changing `ACTIONS_SCOPE` (env, the user), the S5 page.
