# s5c-web-settings-rules — Stage 2

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", S1–S11, "Facts checked", B1–B16, "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first.

## Stage 2 — Gate service, `SettingsNotFoundError`, `settingsDeps`, the `mailbox:settings` refactor [risky]

One step. After it, the CLI and (from stage 5) the web share the gate. The gate decides whether the assistant may move and mark a category's mail on its own: a wrong gate moves real mail.

- [x] **2.1 `triage/gate.ts`, `SettingsNotFoundError`, `composition.settingsDeps`, the CLI (B2, B3, B4)**
  - Goal: one service computes the go/no-go row of each category and sets `auto` behind it; the CLI keeps its output and exit codes.
  - Files: create `apps/server/src/modules/triage/gate.ts`, `apps/server/test/integration/triage-gate.test.ts`; change `apps/server/src/modules/triage/index.ts`, `apps/server/src/modules/config/service.ts`, `config/index.ts`, `apps/server/src/composition.ts`, `apps/server/src/scripts/mailbox-settings.ts`.
  - Interfaces:

    ```ts
    // config/service.ts
    export class SettingsNotFoundError extends HardError {
      constructor() {
        super("no mailbox_settings row");
        this.name = "SettingsNotFoundError";
      }
    }
    // getSettingsView and applyChange throw it instead of the plain HardError (same message).

    // composition.ts (the body of scripts/mailbox-settings.ts:57-66, moved)
    export function settingsDeps(db: Db, now: () => Date): SettingsDeps;

    // triage/gate.ts
    import { GATE_BAR, GATE_MIN_KEPT, type BarCategory, type GateView } from "@ea/core";
    export async function goNoGoFor(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      mailboxId: string,
      now: Date
    ): Promise<Record<BarCategory, GateView>>;
    export type AutoGateResult =
      | { kind: "changed"; change: SettingsChange; gate: GateView | null }
      | { kind: "refused"; gate: GateView };
    export async function setCategoryAutoWithGate(
      deps: SettingsDeps,
      ctx: TenantContext,
      mailboxId: string,
      input: { category: BarCategory; auto: boolean; force: boolean; threshold?: number; actor: string }
    ): Promise<AutoGateResult>;
    ```

  - Decisions:
    - `goNoGoFor`: `const rows = await listLabeledResults(db, ctx, mailboxId, { mail: "real" })`; `const report = buildRealReport(rows, { bar: GATE_BAR, minKept: GATE_MIN_KEPT, mail: "real", now })`; per category of `barCategories`: `row = report.goNoGo[category]`; `atConfidence` = `row.threshold` when `go`; for `no-go` the `threshold` of the first point of `report.sweep[category]` with `kept >= GATE_MIN_KEPT`; for `no-go: too few` the `threshold` of `report.sweep[category][0]` (0.5). Map to `GateView` `{ decision, precision, kept, atConfidence, threshold }`. One database query for all five categories.
    - `setCategoryAutoWithGate`: `auto` true → `gate = (await goNoGoFor(deps.db, ctx, mailboxId, deps.now()))[category]`; `gate.decision !== "go" && !force` → return `{ kind: "refused", gate }` and write nothing; else `setCategoryAuto(deps, ctx, mailboxId, { category, auto: true, ...(threshold === undefined ? {} : { threshold }), gate: { decision: gate.decision, precision: gate.precision, kept: gate.kept, forced: force && gate.decision !== "go" }, actor })` where `threshold = input.threshold ?? (gate.decision === "go" ? (gate.threshold ?? undefined) : undefined)`; return `{ kind: "changed", change, gate }`. `auto` false → no gate query; `setCategoryAuto` with `gate: { decision: "skipped", precision: null, kept: 0, forced: false }`; return `{ kind: "changed", change, gate: null }`. `SettingsNotFoundError` passes through.
    - The gate reads outside the settings lock (as the CLI does today): a label that arrives between the read and the write changes nothing that matters (the next read sees it). `force` with a `go` gate records `forced: false` (B2, a change from the CLI's old row).
    - `triage/index.ts` exports `goNoGoFor`, `setCategoryAutoWithGate`, `type AutoGateResult`.
    - `scripts/mailbox-settings.ts`: delete `BAR`, `MIN_KEPT`, the inline `SettingsDeps` (use `settingsDeps(db, () => now)`), and the gate block of `case "auto"`; call `setCategoryAutoWithGate(deps, ctx, mailboxId, { category, auto: command.value, force: command.force, ...(command.threshold === undefined ? {} : { threshold: command.threshold }), actor: ACTOR })`. When `result.gate` is not null, log the same line as today: `go/no-go <category>: <decision>, precision <p | n/a>, kept <k>, threshold <t | n/a>[ FORCED]` (` FORCED` when `command.force`). `refused` → `log.error("refused: <category> did not pass go/no-go (use --force to set auto on anyway)")` and exit 2 (keep `GateRefusal` or return 2 directly from `run`). `changed` → `printChange(result.change)`. The `show`, `mode`, `switch`, `sync-folder` and `expire-ready` branches keep their output; they use the `deps` of `settingsDeps`.
    - Imports: `triage/gate.ts` imports `../config` (index) and its own `repo`, `eval-real`; never a route or the web.
  - Test (`triage-gate.test.ts`; labelled mail with the `addLabeled` pattern of `triage-eval-real.test.ts:36-62`: an e-mail, a triage result with a model and confidence, a feedback row; settings through `insertDefaultSettings`; `settingsDeps(trx, () => NOW)` with `NOW = 2026-11-11T12:00:00Z`; each test in `withRollback`):
    1. No labelled mail: every category `{ decision: "no-go: too few", precision: null, kept: 0, atConfidence: 0.5, threshold: null }`.
    2. 40 `info` rows at confidence 0.9, all "right" with true category `info` → `info` = `go`, precision 1, kept 40, `threshold` = `atConfidence` = 0.5 (the first point that passes).
    3. 40 `info` rows at 0.9 of which 4 have true category `notification` → `info` = `no-go`, precision 0.9, kept 40, `atConfidence` 0.5, `threshold` null.
    4. 12 `spam` rows → `spam` = `no-go: too few`, kept 12, `atConfidence` 0.5.
    5. `setCategoryAutoWithGate` `auto` on for case 3 without `force` → `refused` with the gate; the settings row and the audit log are unchanged.
    6. The same with `force: true` → `changed`; the policy has `info.auto` true and the old threshold (0.7); the audit row `mailbox.policy_changed` has `forced: true`, `from: false`, `to: true`.
    7. Case 2 with `force: true` → `changed`; `forced: false` in the audit row; the threshold is 0.5 (from the gate).
    8. Case 2 with `threshold: 0.9` → the threshold is 0.9.
    9. `auto` off → `changed` with `gate: null`; no `triage_results` query is needed (assert only the result and the row).
    10. Tenant: labelled rows of organization B (40 `info`, all right) and a call for organization A's mailbox → A's `info` is `no-go: too few`.
    11. A mailbox without a settings row → `setCategoryAutoWithGate` `auto` off rejects with `SettingsNotFoundError`; `getSettingsView` rejects with it too (the message stays `no mailbox_settings row`).
    12. Two setters at once (committed rows, the pattern of `triage-settings-race.test.ts`: `db.transaction().execute` for the setup, then two calls on the plain `db`, cleanup at the end): `Promise.all([setCategoryAutoWithGate(…{ category: "spam", auto: false }…), setMode(…{ mode: "assist", keepSwitches: false }…)])` → both changes are in the final row (`mode` `assist`, the switches of `ASSIST_DEFAULT_SWITCHES`, `spam.auto` false) and two audit rows exist.
    13. CLI (spawn `bun apps/server/src/scripts/mailbox-settings.ts` like `mail-folders-cli.test.ts:22-36`, committed rows, cleanup): `auto --category info --value on` on an empty mailbox → exit 2, stderr or stdout holds `refused: info did not pass go/no-go`; with `--force` → exit 0, the row has `info.auto` true and the audit row `forced: true`, actor `cli`.
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; `config-settings.test.ts`, `mail-folders-cli.test.ts` and `mailbox-settings-args.test.ts` pass unchanged (except the `HardError` import if a test checks the class: it still passes, `SettingsNotFoundError` is a `HardError`); `grep -n "BAR\|MIN_KEPT\|buildRealReport" apps/server/src/scripts/mailbox-settings.ts` finds nothing.
  - Out of scope: the routes (stage 5); the web texts (stage 7).
