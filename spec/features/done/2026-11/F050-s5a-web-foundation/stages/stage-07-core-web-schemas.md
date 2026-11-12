# s5a-web-foundation — Stage 7

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", S1–S13, "Facts checked", W1–W20, "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first. Decisions named D<n> are in the master plan, W<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 7 — `packages/core/src/web/`: the shared schemas and pure helpers (D9, W6, W18), exported as `@ea/core/web`

- [x] **7.1 Schemas, helpers, the subpath export, unit tests**
  - Goal: the API and the browser share one source for the error shape, the `/api/me` shape, the scope codes, the form rules and the time format; the browser imports a subpath that pulls no Node module into the Vite bundle.
  - Files: create `packages/core/src/web/zod.ts`, `packages/core/src/web/errors.ts`, `packages/core/src/web/me.ts`, `packages/core/src/web/password.ts`, `packages/core/src/web/index.ts`, `packages/core/src/web/zod.test.ts`, `packages/core/src/web/errors.test.ts`, `packages/core/src/web/password.test.ts`, `packages/core/src/web/me.test.ts`; change `packages/core/src/index.ts` (`export * from "./web";`) and `packages/core/package.json` (`exports` gains `"./web": "./src/web/index.ts"`).
  - Interfaces:

    ```ts
    // zod.ts (fact 23): every file of this folder imports `z` from "./zod", never from "zod"
    // import { z } from "zod"; z.config({ jitless: true }); export { z };
    // errors.ts
    export const apiErrorCodes = [
      "validation",
      "too_large",
      "confirm_mismatch",
      "unauthorized",
      "owner_only",
      "no_organization",
      "bad_origin",
      "not_found",
      "mailbox_exists",
      "rule_exists",
      "wrong_status",
      "no_go",
      "telegram_off",
      "mail_login_failed",
      "mail_unreachable",
      "internal",
    ] as const; // D9 as refined (too_large)
    export type ApiErrorCode = (typeof apiErrorCodes)[number];
    export const apiErrorSchema = z.object({
      error: z.string(),
      message: z.string().optional(),
      details: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })).optional(),
    });
    export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
    // me.ts (imports: z from "./zod", membershipRoleSchema from "../tenancy"; never ".." or "@ea/core": they pull node:crypto)
    export const scopeKinds = ["off", "synthetic", "self", "all"] as const;
    export const scopeReasons = ["env_off", "synthetic_only", "test_addresses_only", "test_mailbox_only"] as const;
    export const scopeInfoSchema = z.object({ kind: z.enum(scopeKinds), reason: z.enum(scopeReasons) });
    export type ScopeInfo = z.infer<typeof scopeInfoSchema>;
    export function scopeInfoOf(kind: "off" | "synthetic" | "self" | "all"): ScopeInfo; // off→env_off, synthetic→synthetic_only, self→test_addresses_only, all→test_mailbox_only (W6 as refined)
    export const meSchema = z.object({
      user: z.object({ id: z.uuid(), email: z.string(), displayName: z.string() }),
      organization: z.object({ id: z.uuid(), name: z.string(), timezone: z.string() }),
      role: membershipRoleSchema,
      telegram: z.null(), // S5b: z.object({ linked, botUsername }).nullable()
      onboarding: z.null(), // S5b: the D15 object, nullable
      scopes: z.object({ triage: scopeInfoSchema, actions: scopeInfoSchema, send: scopeInfoSchema }),
      mailboxCount: z.number().int().min(0),
      mailboxesInAuthError: z.number().int().min(0),
    });
    export type Me = z.infer<typeof meSchema>;
    // password.ts
    export const PASSWORD_MIN = 12;
    export const PASSWORD_MAX = 128; // D1
    export const passwordSchema = z
      .string()
      .min(PASSWORD_MIN, "password_too_short")
      .max(PASSWORD_MAX, "password_too_long");
    export const loginFormSchema = z.object({
      email: z.email("email_invalid"),
      password: z.string().min(1, "password_required"),
    });
    export const setPasswordFormSchema = z
      .object({ email: z.email("email_invalid"), password: passwordSchema, repeat: z.string() })
      .refine((v) => v.password === v.repeat, { path: ["repeat"], message: "passwords_differ" });
    export function fieldErrors(result: z.ZodSafeParseResult<unknown>): Record<string, string>; // first message per top-level path (the message is the i18n key)
    // index.ts re-exports the existing time format (U8; second cold review, finding 9):
    export { formatClock } from "../digest/local-time"; // formatClock(at: Date, timeZone, now): "HH:MM" today, "D MMM HH:MM" this year, else with the year
    ```

  - Decisions:
    - The Zod messages are **i18n keys** (`en.ts` holds the texts, U1), so the browser maps them with `t()` and the server never shows them; `telegram` and `onboarding` are `z.null()` in S5a so that S5b's change is a visible schema edit; `scopeInfoOf` is the one place that turns the four env kinds into the UI codes (W6 as refined: `send`'s `self` means "sends go only to `SEND_TEST_ADDRESSES`", not synthetic mail: cold review of this plan, finding 8); `z.uuid()` is Zod 4's form.
    - Time format (U8): no new function. `packages/core/src/digest/local-time.ts` already has `formatClock(at, timeZone, now)` (pure, no imports, used by the Telegram digest), so `web/index.ts` re-exports it from that file (not from `../digest`, whose index holds more) and the web calls `formatClock(new Date(iso), organization.timezone, new Date())`: one formatter for both channels (U6; second cold review, finding 9). Its tests stay in `digest/`.
    - `jitless` (fact 23): Zod 4 runs a `new Function("")` probe when it creates an object schema, and the strict meta CSP reports it as a `securitypolicyviolation`. `zod.ts` sets `z.config({ jitless: true })`; because every file here imports `z` from `zod`, ES module order runs it before the first schema. The flag is global for the process: the server then parses without the JIT too (slower, same results).
    - The subpath export `@ea/core/web` (cold review of this plan, finding 27): the core barrel re-exports `triage/eval-case.ts`, which imports `node:crypto`; a Vite browser bundle must not see it. The web imports only `@ea/core/web`; the server may import either. `moduleResolution: "Bundler"` (the base tsconfig) resolves `exports` subpaths; `astro check` and Vite resolve them too. The web package gets `@ea/core` as a dependency in stage 9.
  - Test:
    1. `errors.test.ts`: `apiErrorSchema.parse({ error: "owner_only" })` ok; with `details` ok; `{}` fails; `apiErrorCodes` includes `too_large`.
    2. `password.test.ts`: `passwordSchema` refuses 11 characters with the message `password_too_short`, 129 with `password_too_long`, accepts 12 and 128; `setPasswordFormSchema` with differing passwords → `fieldErrors` = `{ repeat: "passwords_differ" }`; a bad e-mail → `{ email: "email_invalid" }`; `loginFormSchema` with `password: ""` → `{ password: "password_required" }`.
    3. `me.test.ts`: `scopeInfoOf("off")` → `{ kind: "off", reason: "env_off" }`, `("synthetic")` → `{ kind: "synthetic", reason: "synthetic_only" }`, `("self")` → `{ kind: "self", reason: "test_addresses_only" }`, `("all")` → `{ kind: "all", reason: "test_mailbox_only" }`; `meSchema` accepts a full object with `telegram: null`, `onboarding: null` and refuses `onboarding: {}`.
    4. `zod.test.ts`: after `import { z } from "./zod"`, `z.config().jitless` is `true`; `formatClock` is exported from `index` (`formatClock(new Date("2026-11-08T13:03:00Z"), "Europe/Warsaw", new Date("2026-11-08T18:00:00Z"))` → `"14:03"`).
    5. The subpath resolves: a unit test in `packages/core/src/web/index.test.ts` is pointless (same package); instead the Check greps the `exports` map; the first page code that imports `@ea/core/web` is stage 10 (`MeProvider`), and stages 10.2 and 11 grep the built bundle.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`; `grep -n '"./web"' packages/core/package.json` → 1 line; `grep -rn "node:" packages/core/src/web` → nothing; `grep -rnE 'from "(\.\.|\.\./index|@ea/core)"' packages/core/src/web` → nothing; `grep -rln 'from "zod"' packages/core/src/web` → only `zod.ts`.
  - Done when: the tests pass and the greps hold.
  - Out of scope: the browser helpers around these schemas (stage 9), the server route (stage 8).
