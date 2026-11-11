# s5c-web-settings-rules — Stage 1

Part of [`../s5c-web-settings-rules.md`](../s5c-web-settings-rules.md). Read that file's "Done when", "Owns", S1–S11, "Facts checked", B1–B16, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 1 — Core: the web schemas, the pattern rule, the gate constants, `rule_limit`, `me.digestTimes`

Two steps. Pure code in `packages/core`; no database, no server change except what typecheck forces (step 1.2).

- [ ] **1.1 The sender pattern rule and the settings, rules and organization schemas (B1)**
  - Goal: the browser forms and the routes share one schema per body; the CLI and the web share one pattern rule.
  - Files: change `packages/core/src/triage/rules.ts`, `packages/core/src/triage/rules.test.ts`, `packages/core/src/digest/schedule.ts` (`DIGEST_TIME_PATTERN`), `packages/core/src/web/index.ts`, `packages/core/src/web/password.ts`, `packages/core/src/web/password.test.ts`; create `packages/core/src/web/settings.ts`, `settings.test.ts`, `rules.ts`, `rules.test.ts`, `organization.ts`, `organization.test.ts`.
  - Interfaces:

    ```ts
    // triage/rules.ts (moved from scripts/rules.ts:22-29; the script switches in stage 3)
    export const SENDER_RULE_LIMIT = 1000;
    export function normalizeSenderPattern(raw: string): string; // trim, lower case
    export function isValidSenderPattern(pattern: string): boolean; // an address local@domain or a domain with a dot

    // web/settings.ts
    export const GATE_BAR = 0.98;
    export const GATE_MIN_KEPT = 30;
    export const gateDecisions = ["go", "no-go", "no-go: too few"] as const;
    export const gateViewSchema: z.ZodType<GateView>; // { decision, precision: number | null, kept, atConfidence, threshold: number | null }
    export type GateView = {
      decision: (typeof gateDecisions)[number];
      precision: number | null;
      kept: number;
      atConfidence: number;
      threshold: number | null;
    };
    export const categorySettingSchema; // { category: z.enum(barCategories), auto: boolean, threshold: number 0–1, gate: gateViewSchema }
    export const switchableSyncFolderKeys = ["offers", "social", "bills", "junk"] as const;
    export type SwitchableSyncFolderKey = (typeof switchableSyncFolderKeys)[number];
    export const syncFolderViewSchema; // { key: z.enum(syncFolderKeys), role: z.enum(syncFolderRoles), path: string, enabled: boolean }
    export const settingsViewSchema; // { mailboxId: uuid, mode: z.enum(mailboxModes), toolSwitches: { move, mark_read, flag, create_draft, move_unsure: boolean }, movesSupported, categories: categorySetting[], syncFolders: syncFolderView[], bar: number, minKept: int }
    export type SettingsWebView = z.infer<typeof settingsViewSchema>; // "Web" in the name: config already exports a SettingsView
    export const settingsChangeSchema; // { changed: boolean, expired: int ≥ 0, settings: settingsViewSchema }
    export type SettingsWebChange = z.infer<typeof settingsChangeSchema>;
    export const modeBodySchema; // { mode: z.enum(mailboxModes), keepSwitches: boolean }
    export const switchBodySchema; // { value: boolean }
    export const autoBodySchema; // { auto: boolean, force: boolean optional }
    export const syncFolderBodySchema; // { enabled: boolean }
    export const noGoBodySchema; // { error: z.literal("no_go"), gate: gateViewSchema }

    // web/rules.ts
    export const ruleBodySchema; // { kind: z.enum(senderRuleKinds), pattern, mailboxId: z.uuid().optional() }
    export type RuleBody = z.infer<typeof ruleBodySchema>; // pattern is the normalized text
    export const ruleViewSchema; // { id: uuid, kind, pattern: string, mailboxId: uuid | null, createdAt: z.iso.datetime() }
    export type RuleView = z.infer<typeof ruleViewSchema>;
    export const ruleListSchema = z.array(ruleViewSchema);
    export const rulesQuerySchema; // { mailboxId: z.uuid().optional() }

    // web/organization.ts
    export const STYLE_TEXT_MAX = 500;
    export function normalizeStyleText(raw: string): string; // \r\n and \r → \n, then trim
    export const styleTextSchema; // input string ≤ 2000 ("style_too_long") → normalized; ≤ 500 ("style_too_long"); no control character except \n and \t ("style_bad_char"); "" → null
    export const organizationPatchSchema; // { timezone?: string trimmed 1–64, styleText?: styleTextSchema | null }, at least one key ("empty_patch", path [])
    export type OrganizationPatch = z.infer<typeof organizationPatchSchema>; // styleText: string | null | undefined after the transform
    export const organizationViewSchema; // { id: uuid, name, timezone, styleText: string | null, retentionDays: int > 0 }
    export const organizationSettingsSchema; // organizationViewSchema.extend({ timezones: z.array(z.string()) })
    export const digestTimesBodySchema; // { times: z.array(HH:MM, "time_invalid").max(MAX_DIGEST_TIMES, "times_too_many") } + unique ("times_duplicate", path ["times"])
    export const digestTimesSchema; // { times: z.array(z.string()) }
    export { MAX_DIGEST_TIMES } from "../digest/schedule"; // the browser imports only @ea/core/web

    // web/password.ts
    export const changePasswordFormSchema; // { current: z.string().min(1, "password_required"), password: passwordSchema, repeat: z.string() } + refine password === repeat (path ["repeat"], "passwords_differ")
    ```

  - Decisions:
    - Every file of `web/` imports `z` from `./zod` (the `jitless` rule, D17). `web/settings.ts` imports `barCategories`, `mailboxModes`, `toolSwitchNames` from `../triage/…` and `syncFolderKeys`, `syncFolderRoles` from `../mail/sync-folders`; `web/organization.ts` imports `MAX_DIGEST_TIMES` from `../digest/schedule`; `web/rules.ts` imports `senderRuleKinds`, `normalizeSenderPattern`, `isValidSenderPattern` from `../triage/rules`. All of them are pure (no Node module): check with the stage Check (`bun run web:build` bundles `@ea/core/web`).
    - The pattern regexes are the CLI's, unchanged: `^[a-z0-9-]+(\.[a-z0-9-]+)+$` for a domain and `^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$` for an address. The pattern field: `z.string().max(254, "pattern_invalid").transform(normalizeSenderPattern).refine(isValidSenderPattern, "pattern_invalid")`. Every limit has an i18n message (a Zod default text would reach a form as an unknown key and show an empty error; cold review finding 9).
    - `toolSwitches` in `settingsViewSchema` is a strict object of the five names of `toolSwitchNames` (booleans, no defaults: the server sends all five).
    - The HH:MM rule of `digestTimesBodySchema` is the one of `parseDigestTimesInput` (`/^([01]\d|2[0-3]):[0-5]\d$/`); export the regex from `digest/schedule.ts` as `DIGEST_TIME_PATTERN` and use it in both places (no copy).
    - The messages are i18n keys (the `passwordSchema` pattern); stage 7 adds the texts.
    - The browser imports only `@ea/core/web` (D17), so `web/settings.ts` re-exports what the pages need from the triage code: `export { barCategories, type BarCategory } from "../triage/metrics"; export { toolSwitchNames, ASSIST_DEFAULT_SWITCHES } from "../triage/settings";` and `web/rules.ts` re-exports `senderRuleKinds` and `type SenderRuleKind`. The root barrel exports `./triage` and `./web`, so the same binding comes through two paths; this is fine (the precedent: `web/index.ts` re-exports `../mail/providers`, which `./mail` exports too).
    - `web/index.ts` adds `export * from "./settings"; export * from "./rules"; export * from "./organization";`. Name clashes with the root barrel (`packages/core/src/index.ts` re-exports `./web`): `SettingsView` and `SettingsChange` exist only in the server's `config` module, not in core, so the core names `SettingsWebView` and `SettingsWebChange` avoid confusion; check `bun run typecheck` for a duplicate export.
  - Test (unit, fixed values):
    1. `isValidSenderPattern`: true for `anna@x.pl`, `x.pl`, `mail.firma.co.uk`, `a.b+c@x-y.pl`; false for `@x.pl`, `*.x.pl`, `x`, `anna@x`, `anna @x.pl`, `""`. `normalizeSenderPattern("  Boss@Firma.TEST ")` → `boss@firma.test`.
    2. `ruleBodySchema`: `{ kind: "vip", pattern: " Anna@X.pl " }` → pattern `anna@x.pl`; `{ kind: "vip", pattern: "@x.pl" }` → one issue with message `pattern_invalid` at path `pattern`; `kind: "other"` → issue at `kind`; `mailboxId: "x"` → issue at `mailboxId`; a 255-character pattern → issue with message `pattern_invalid`.
    3. `styleTextSchema`: `"Anna\r\nCEO  "` → `"Anna\nCEO"`; `"   "` → `null`; 501 × `a` → `style_too_long`; 2001 × `a` → `style_too_long`; `"a\u0007b"` → `style_bad_char`; `"a\tb"` passes.
    4. `organizationPatchSchema`: `{}` → `empty_patch`; `{ styleText: null }` passes; `{ timezone: "" }` → issue at `timezone`; `{ timezone: "Europe/Warsaw" }` passes (the schema checks only the shape; the list check is the server's, B9).
    5. `digestTimesBodySchema`: `["08:00", "13:30"]` passes; `[]` passes; `["8:00"]` → `time_invalid`; seven times → `times_too_many`; `["08:00", "08:00"]` → `times_duplicate`.
    6. `settingsViewSchema` parses a full fixture (five categories, two folders); a fixture without `toolSwitches.create_draft` fails. `noGoBodySchema` parses `{ error: "no_go", gate: { decision: "no-go: too few", precision: null, kept: 12, atConfidence: 0.5, threshold: null } }`.
    7. `changePasswordFormSchema`: `{ current: "", password: "x".repeat(12), repeat: "x".repeat(12) }` → `password_required` at `current`; a short password → `password_too_short`; a different repeat → `passwords_differ` at `repeat`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && cd apps/web && bun run build`.
  - Done when: the tests pass; `grep -n "domainPattern\|addressPattern" packages/core/src/triage/rules.ts` shows the two regexes; the web build passes.
  - Out of scope: the CLI switch to the core rule (stage 3); the server routes.

- [ ] **1.2 `rule_limit` and `me.digestTimes` (B1, B9)**
  - Goal: the error code list and the `/api/me` shape carry what S5c adds.
  - Files: change `packages/core/src/web/errors.ts`, `errors.test.ts`, `packages/core/src/web/me.ts`, `me.test.ts`, `apps/server/src/modules/tenancy/routes.ts` (fill `digestTimes`), `apps/server/test/integration/web-me.test.ts` (expect the field).
  - Interfaces:

    ```ts
    // errors.ts: add "rule_limit" after "rule_exists"
    // me.ts: meSchema gains digestTimes: z.array(z.string())
    // tenancy/routes.ts, GET /me: digestTimes: parseDigestTimes(member.digest_times)  // from @ea/core; the membership row is read already
    ```

  - Decisions: `parseDigestTimes` drops the seconds of the database value (`"08:00:00"` → `"08:00"`) and sorts. No other `/api/me` change.
  - Test: `errors.test.ts` lists `rule_limit`; `me.test.ts` fixture gets `digestTimes: ["08:00"]`, and an object without it fails; `web-me.test.ts`: the owner after `setDigestTimes(db, ctx, ownerId, ["13:00", "08:00"])` gets `digestTimes: ["08:00", "13:00"]`; a member without times gets `[]`.
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: `PATCH /api/me/digest-times` (stage 4).
