# s5b-web-mailboxes-onboarding — Stage 1

Part of [`../s5b-web-mailboxes-onboarding.md`](../s5b-web-mailboxes-onboarding.md). Read that file's "Done when", "Owns", S1–S12, "Facts checked", B1–B17, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first. Decisions named D<n> are in the master plan, B<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 1 — Core: provider presets, web schemas, scope badges, `onboardingOf`, error codes

Pure code in `packages/core`, no I/O, no server or web change. The server and web stages import these.

- [x] **1.1 Provider presets (B1)**
  - Goal: one table of the five providers that the server (host resolution) and the browser (the form) share.
  - Files: create `packages/core/src/mail/providers.ts`, `packages/core/src/mail/providers.test.ts`; change `packages/core/src/mail/index.ts` (`export * from "./providers"`).
  - Interfaces:

    ```ts
    export const presetKeys = ["interia", "gmail", "onet", "wp", "o2"] as const;
    export type PresetKey = (typeof presetKeys)[number];
    export interface MailPreset {
      imapHost: string;
      imapPort: number;
      smtpHost: string;
      smtpPort: number;
      secretKind: "password" | "app_password";
      domains: readonly string[];
    }
    export const MAIL_PRESETS: Readonly<Record<PresetKey, MailPreset>>;
    export function presetForAddress(address: string): PresetKey | null;
    export interface ServerFields {
      imapHost: string;
      imapPort: number;
      smtpHost: string;
      smtpPort: number;
    }
    export function serversFor(input: { preset?: PresetKey } & Partial<ServerFields>): ServerFields;
    ```

  - Decisions:
    - The values are exactly the B1 list (fact 1); every port is 993 (IMAP) and 465 (SMTP).
    - `presetForAddress`: take the text after the **last** `@`, trim, lower-case; return the first key whose `domains` contains it; no `@` or an empty domain → `null`. No sub-domain match (`mail.gmail.com` → `null`).
    - `serversFor`: with `preset` → the preset's four values (fields in the input are ignored; the schema of 1.2 refuses that shape anyway); without → the four fields, and a missing one throws `Error("server fields missing")` (a programming error: the schema guarantees them).
    - No UI text in this file (U1: labels and help sentences live in `apps/web/src/i18n/en.ts`, stage 10). The file imports nothing (no `zod`): it is plain data, safe for the browser bundle.
  - Test (`providers.test.ts`): (1) every key of `presetKeys` has a row with ports 993 and 465; (2) `presetForAddress("Anna@Gmail.COM")` → `"gmail"`, `"x@interia.pl"` → `"interia"`, `"x@onet.pl"` → `"onet"`, `"x@wp.pl"` → `"wp"`, `"x@o2.pl"` → `"o2"`; (3) `"x@mail.gmail.com"`, `"x@example.com"`, `"no-at-sign"`, `"x@"` → `null`; (4) `"a@b@gmail.com"` → `"gmail"` (the last `@`); (5) `serversFor({ preset: "onet" })` → `{ imapHost: "imap.poczta.onet.pl", imapPort: 993, smtpHost: "smtp.poczta.onet.pl", smtpPort: 465 }`; (6) `serversFor({ imapHost: "127.0.0.1", imapPort: 3143, smtpHost: "127.0.0.1", smtpPort: 3025 })` returns them; (7) `serversFor({ imapHost: "h", imapPort: 1 })` throws.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`.
  - Done when: the tests pass; `providers.ts` has no import.
  - Out of scope: the form (stage 12), the host rule (stage 8).

- [x] **1.2 Web schemas, scope badges, `onboardingOf`, error codes (B2, B3)**
  - Goal: the request and response shapes of every S5b route, shared by the routes (parse) and the browser (forms, parse of the answers).
  - Files: create `packages/core/src/web/mailboxes.ts`, `mailboxes.test.ts`, `telegram.ts`, `onboarding.ts`, `onboarding.test.ts`; change `packages/core/src/web/errors.ts` (two codes), `errors.test.ts`, `packages/core/src/web/index.ts` (exports, also `export * from "../mail/providers"`).
  - Interfaces:

    ```ts
    // web/mailboxes.ts (imports z from "./zod"; presetKeys from "../mail/providers"; mailboxModes from "../triage/categories")
    export const connectMailboxBodySchema: z.ZodType<ConnectMailboxBody>;
    export interface ConnectMailboxBody {
      address: string;
      password: string;
      secretKind: "password" | "app_password";
      preset?: PresetKey;
      imapHost?: string;
      imapPort?: number;
      smtpHost?: string;
      smtpPort?: number;
    }
    export const mailboxPasswordBodySchema; // { password: string 1..512, secretKind }
    export const removeMailboxBodySchema; // { confirmAddress: string 1..254 }
    export const mailboxStatuses = ["active", "paused", "auth_error"] as const;
    export const badgeStates = ["on", "off", "synthetic", "self"] as const;
    export const badgeReasons = [
      "env_off",
      "synthetic_only",
      "test_addresses_only",
      "test_mailbox_only",
      "other_mailbox",
    ] as const;
    export const scopeBadgeSchema; // { state, reason }
    export type ScopeBadge = z.infer<typeof scopeBadgeSchema>;
    export interface ScopeEnv {
      triage: "off" | "synthetic" | "all";
      actions: "off" | "synthetic" | "all";
      send: "off" | "self" | "all";
      testMailboxAddress: string | null;
    }
    export function mailboxScopeBadges(
      env: ScopeEnv,
      address: string
    ): { triage: ScopeBadge; actions: ScopeBadge; send: ScopeBadge };
    export const mailboxViewSchema; // B2
    export type MailboxView = z.infer<typeof mailboxViewSchema>;
    export const mailboxListSchema = z.array(mailboxViewSchema);
    export const connectResultSchema; // { id: uuid, address, status, capabilities: { move, uidplus, idle } }
    export function sameAddress(a: string, b: string): boolean; // trim + lower-case equality (the remove confirmation, B8 and B15)
    // web/telegram.ts
    export const telegramStateSchema; // { available: boolean, linked: boolean, linkedAt: iso | null, botUsername: string | null } (B2, B9)
    export const telegramLinkSchema; // { url: z.url(), expiresAt: iso }
    // web/onboarding.ts
    export const onboardingSchema; // { mailbox, telegram, telegramAvailable, mode: boolean, rules: int >= 0, done: boolean }
    export type Onboarding = z.infer<typeof onboardingSchema>;
    export function onboardingOf(input: {
      mailboxCount: number;
      telegramLinked: boolean;
      telegramAvailable: boolean;
      modeChosen: boolean;
      ruleCount: number;
    }): Onboarding; // done = mailboxCount > 0 && (telegramLinked || !telegramAvailable) && modeChosen
    ```

  - Decisions:
    - Field rules of B2: `address` = `z.email({ pattern: z.regexes.html5Email }).max(254)`; host = `z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9.:-]+$/)`; port = `z.number().int().min(1).max(65535)`; `secretKind` = `z.enum(["password", "app_password"])`; `password` `z.string().min(1).max(512)` (never trimmed: a password may hold spaces).
    - The connect `superRefine`: with `preset` → an issue for each present server field (`code: "custom"`, `message: "not_with_preset"`, `path: [field]`); without → an issue for each missing one (`message: "required"`). The messages are codes, the web maps them to `en.ts` texts.
    - Times in responses are `z.iso.datetime()` (the server sends `Date` through `c.json`, which writes ISO with `Z`); `lastSyncedAt` and `linkedAt` are `.nullable()`; `mode` = `z.enum(mailboxModes).nullable()`; `secretKind` = `z.enum(["password", "app_password"])` (B2, cold review finding 10).
    - `mailboxScopeBadges` follows B3 line by line; the comparison uses `sameAddress`; `testMailboxAddress: null` with `all` → `other_mailbox`.
    - `apiErrorCodes` add `host_not_allowed` and `telegram_unreachable` (D9 gets the dated line in stage 15).
    - Every new `core/web` file imports `z` from `./zod` (W18 of S5a: `jitless` before the first schema).
  - Test:
    1. `mailboxes.test.ts` connect body: a preset body `{ address: "a@gmail.com", password: "p w", secretKind: "app_password", preset: "gmail" }` passes and keeps the password with its space; the same with `imapHost` → one issue `imapHost`/`not_with_preset`; a body without preset and with only `imapHost`, `imapPort` → issues `smtpHost` and `smtpPort` with `required`; `imapPort: 70000` → an issue; host `"bad host"` → an issue; `address: "not-an-address"` → an issue; `preset: "yahoo"` → an issue.
    2. Badges, `env = { triage: "all", actions: "synthetic", send: "self", testMailboxAddress: "Test@X.pl" }`: for `"test@x.pl"` → triage `{ on, test_mailbox_only }`, actions `{ synthetic, synthetic_only }`, send `{ self, test_addresses_only }`; for `"other@x.pl"` → triage `{ off, other_mailbox }`, actions and send unchanged; all `off` → three `{ off, env_off }`; `send: "all"` with `testMailboxAddress: null` → `{ off, other_mailbox }`. (The segment's done-when: "the test mailbox and a second mailbox".)
    3. `mailboxViewSchema` parses a sample with `lastSyncedAt: null` and `mode: null`; refuses `status: "deleted"`.
    4. `sameAddress(" A@x.PL ", "a@x.pl")` → true; `("a@x.pl", "b@x.pl")` → false.
    5. `onboarding.test.ts` (`telegramAvailable: true` unless named): `{ mailboxCount: 1, telegramLinked: true, modeChosen: true, ruleCount: 0 }` → `done` true; no mailbox, or not linked, or no mode → false; `ruleCount: 3` with the others false → `rules: 3`, `done: false`; `telegramAvailable: false` with a mailbox, the mode and no link → `done` true and `telegram` false (a server without a bot never blocks onboarding).
    6. `errors.test.ts`: the list holds `host_not_allowed` and `telegram_unreachable`.
    7. `telegramLinkSchema` refuses `url: "not a url"`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && cd apps/web && bun run build` (the browser bundle still builds with the new `@ea/core/web` exports).
  - Done when: the tests pass; `grep -n "from \"zod\"" packages/core/src/web/*.ts` lists only `zod.ts`.
  - Out of scope: `meSchema` (`telegram`, `onboarding` stay `z.null()` until stage 9, where the route changes in the same commit).
