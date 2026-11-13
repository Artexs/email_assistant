# F087 stage 01 — Registry, resolver and the kill-list key

Part of [`../plan.md`](../plan.md). Read its D1, D3, D7, D8, D9, D19, D20 and "Rules for every stage" first. Needs: F086 landed (ticket § Sequenced). No migration, no DB.

Two steps. About 180 changed lines.

- [ ] **1.1 The flag registry and the pure resolver in `packages/core`**
  - Goal: one place lists every flag with its default, description, owner epic and remove-by date; one pure function decides the effective value; a unit test turns red when a flag is past its remove-by date.
  - Files:
    - add `packages/core/src/features.ts`;
    - add `packages/core/src/features.test.ts`;
    - change `packages/core/src/index.ts` (`export * from "./features";`).
  - Interfaces:

    ```ts
    // packages/core/src/features.ts — pure: no process.env, no Date.now() inside the functions
    export interface FeatureFlag {
      default: boolean;
      description: string; // one English line, what a user sees when it is on
      epic: string; // owner epic, e.g. "E3a", "E4-A"
      removeBy: string; // YYYY-MM-DD; after this day the flag is a cleanup ticket
    }

    export const featureFlags = {
      stats_page: { default: false, description: "The stats page in the panel.", epic: "E3a", removeBy: "2027-03-01" },
      approvals_page: {
        default: false,
        description: "The approvals page in the panel.",
        epic: "E4-A",
        removeBy: "2027-03-01",
      },
      sent_sync: {
        default: false,
        description: "Read the Sent folder of a mailbox (read only).",
        epic: "E5a",
        removeBy: "2027-03-01",
      },
    } as const satisfies Record<string, FeatureFlag>;

    export type FeatureKey = keyof typeof featureFlags;
    export const featureKeys: readonly FeatureKey[]; // Object.keys(featureFlags) in registry order
    export function isFeatureKey(value: string): value is FeatureKey; // Object.hasOwn(featureFlags, value)

    export const featureKeyPattern: RegExp; // /^[a-z][a-z0-9_]{0,39}$/
    export const featureEpicPattern: RegExp; // /^E\d{1,2}[a-z]?(-[A-Z][A-Z0-9]{0,2})?$/

    // Keys whose removeBy is before `today` (YYYY-MM-DD); the day itself is not past. Registry order.
    export function expiredFlags(registry: Readonly<Record<string, FeatureFlag>>, today: string): string[];

    export type FeatureSource = "env" | "row" | "default";
    // D7: killed (FEATURES_OFF) → off; a row → its value; else the default.
    export function resolveFeature(input: { defaultOn: boolean; killed: boolean; row: boolean | undefined }): {
      enabled: boolean;
      source: FeatureSource;
    };
    ```

  - Decisions: D1, D7, D19, D20. `featureFlags` is the only list of keys; no other file repeats the three names (tests may).
  - Test (`packages/core/src/features.test.ts`, no mocks):
    1. Every key of `featureFlags` matches `featureKeyPattern`; every `description` is a non-empty trimmed string; every `epic` matches `featureEpicPattern`; the pattern also accepts `E7-T2`, `E8-LR`, `E11b`, `E7i` and refuses `E`, `e3a`, `E3-a`, `E123`; every `removeBy` matches `^\d{4}-\d{2}-\d{2}$` and ``new Date(`${removeBy}T00:00:00Z`).toISOString().slice(0, 10) === removeBy`` (so `2027-02-30` fails).
    2. `stats_page`, `approvals_page` and `sent_sync` exist and each has `default: false` (assert these three, not the full key list: later epics add keys).
    3. `expiredFlags` with the fixture `{ a: { …, removeBy: "2027-03-01" }, b: { …, removeBy: "2027-04-01" } }`: today `"2027-02-28"` → `[]`; `"2027-03-01"` → `[]`; `"2027-03-02"` → `["a"]`; `"2027-04-02"` → `["a", "b"]`.
    4. The real registry: `expiredFlags(featureFlags, new Date().toISOString().slice(0, 10))` is `[]`. On failure the message is `flag <key> is past its remove-by date <date>: open a cleanup ticket` (build it in the test; `expect(lines).toEqual([])` where `lines` holds those texts).
    5. `resolveFeature`, a table (`test.each`):
       | defaultOn | killed | row | → enabled | source |
       | --- | --- | --- | --- | --- |
       | true | true | true | false | `env` |
       | false | true | undefined | false | `env` |
       | true | false | false | false | `row` |
       | false | false | true | true | `row` |
       | false | false | undefined | false | `default` |
       | true | false | undefined | true | `default` |
    6. `isFeatureKey`: `"stats_page"` → true; `"STATS_PAGE"`, `""`, `"stats_page "`, `"toString"`, `"__proto__"`, `"constructor"` → false.
    7. `featureKeys` equals `Object.keys(featureFlags)` and starts with `["stats_page", "approvals_page", "sent_sync"]`.
  - Check: `bun test packages/core/src/features.test.ts`; `bun run typecheck`.
  - Done when: tests 1–7 pass; `@ea/core` exports the names above.
  - Out of scope: any server code; exporting the registry through `@ea/core/web` (stage 5 adds only the operator type there).

- [ ] **1.2 `FEATURES_OFF` in the config**
  - Goal: the operator can turn a flag off for every organization with one env line; a typo stops the start (D8); code that did not get the config object can still read the same list from env (D9).
  - Files:
    - change `apps/server/src/platform/config.ts`;
    - change `apps/server/src/platform/config.test.ts`;
    - change `.env.example` (after the `OPERATOR_TELEGRAM_CHAT_ID` line).
  - Interfaces:

    ```ts
    // platform/config.ts
    import { type FeatureKey, isFeatureKey } from "@ea/core";
    // baseSchema:
    // Comma list of flag keys (packages/core/src/features.ts) that read off for every organization. Empty = none.
    FEATURES_OFF: z.preprocess(emptyAsUndefined, z.string().optional()),
    // configSchema.superRefine: every parseList(FEATURES_OFF) entry passes isFeatureKey, else
    //   ctx.addIssue({ code: "custom", path: ["FEATURES_OFF"], message: "each entry must be a flag key of packages/core/src/features.ts" })
    export function featuresOff(config: Config): FeatureKey[]; // parseList, unique, in the env order
    // D9: the same parse on raw env, for tenancy/features.ts when configureFeatures was not called.
    // An empty string counts as unset. An unknown key throws new ConfigError(["FEATURES_OFF"]).
    export function featuresOffFromEnv(env: Record<string, string | undefined>): FeatureKey[];
    ```

    `.env.example`:

    ```
    # Kill switch: comma list of feature flag keys (packages/core/src/features.ts) that read off for every organization, without a DB write. An unknown key stops the start. Empty = none.
    FEATURES_OFF=
    ```

  - Decisions: D3, D8, D9.
  - Test (`config.test.ts`, new `describe("FEATURES_OFF")`, base `fullEnv`):
    1. Unset → `featuresOff(config)` is `[]`; `""` → `[]`.
    2. `" sent_sync , stats_page,sent_sync"` → `["sent_sync", "stats_page"]`.
    3. `"stats_page,stats_pag"` → `configError(...).keys` equals `["FEATURES_OFF"]`.
    4. `"toString"` → `configError(...).keys` equals `["FEATURES_OFF"]`.
    5. `featuresOffFromEnv({})` and `featuresOffFromEnv({ FEATURES_OFF: "" })` → `[]`; `{ FEATURES_OFF: "sent_sync, sent_sync" }` → `["sent_sync"]`; `{ FEATURES_OFF: "nope" }` throws a `ConfigError` whose `keys` equal `["FEATURES_OFF"]`.
  - Check: `bun test apps/server/src/platform/config.test.ts`; `bun run lint` (the F086 layer lint must accept `platform/config.ts → @ea/core`; a lint error here is a question, see plan "Not verified").
  - Done when: tests 1–5 pass; `.env.example` lists the key.
  - Out of scope: `configureFeatures` and any reader (stage 2); `OPERATOR_USER_IDS` (stage 4); `main.ts`.

## Done when

- Steps 1.1 and 1.2 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 01 (`/tmp/f087-s01`) prints `PROOF_OK`.
