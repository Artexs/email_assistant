# s5a-web-foundation — Stage 9

Part of [`../s5a-web-foundation.md`](../s5a-web-foundation.md). Read that file's "Done when", "Owns", S1–S13, "Facts checked", W1–W20, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first. Decisions named D<n> are in the master plan, W<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 9 — Astro foundation: static config, the CSP integration, dependencies, media-query dark mode, shadcn components, the public layout and the 404 page, `i18n/en.ts`, the web lib, the web code rules

Order inside S5a: the server stages 1–8 are built, so `bun run dev` serves `/api/*` on 8080 for the dev loop (D18). Reviewed on Opus high (the CSP integration is security code).

- [ ] **9.1 Dependencies, `astro.config.mjs`, the CSP integration, styles, shadcn components, `Public.astro`, the 404 page, the `index.astro` redirect stub**
  - Goal: `bun run web:build` produces a static `apps/web/dist` whose every page carries the D5 meta CSP (hashed scripts, `style-src 'self' 'unsafe-inline'`), with no inline stylesheet, dark mode by the system setting and no theme script (W3, W4, D17); the shadcn components of D17 exist; the starter pages are gone; the 404 page (S10) is the first real page.
  - Files: change `apps/web/package.json` (remove `@astrojs/node` and `@astrojs/sitemap`; add `"better-auth": "1.7.18"` — the same exact pin as `apps/server`, for `better-auth/react` in 9.2 — plus `"@ea/core": "workspace:*"` and `"zod": "^4.1.12"` (the same range as the server; the web imports `@ea/core/web`, which imports `zod`); the shadcn CLI adds its own packages: `radix-ui`, `sonner`, `next-themes`, maybe `cmdk`; keep what the CLI adds, remove nothing by hand), the root `bun.lock` (this stage's change; stage 13 adds `@playwright/test`), `apps/web/astro.config.mjs`, create `apps/web/integrations/csp-style-src.ts`, change `apps/web/src/styles/global.css`, create `apps/web/src/layouts/Public.astro`, `apps/web/src/pages/404.astro`, `apps/web/src/i18n/en.ts` (the keys of this step only; 9.2 fills the rest), replace `apps/web/src/pages/index.astro` (the redirect stub), delete `apps/web/src/components/Welcome.astro` and `apps/web/src/layouts/Layout.astro`; the shadcn CLI writes `apps/web/src/components/ui/*.tsx` (it overwrites `button.tsx`).
  - Interfaces:

    ```js
    // apps/web/astro.config.mjs
    import { defineConfig } from "astro/config";
    import react from "@astrojs/react";
    import tailwindcss from "@tailwindcss/vite";
    import cspStyleSrc from "./integrations/csp-style-src";
    export default defineConfig({
      output: "static",
      integrations: [react(), cspStyleSrc()],
      build: { inlineStylesheets: "never" },
      experimental: {
        csp: {
          directives: [
            "default-src 'self'",
            "img-src 'self' data:",
            "connect-src 'self'",
            "font-src 'self'",
            "form-action 'self'",
            "base-uri 'self'",
            "object-src 'none'",
          ],
        },
      },
      vite: {
        plugins: [tailwindcss()],
        server: { proxy: { "/api": { target: "http://127.0.0.1:8080", timeout: 95_000 } } },
      },
    });
    ```

    ```ts
    // apps/web/integrations/csp-style-src.ts
    import type { AstroIntegration } from "astro";
    export const STYLE_SRC = /style-src [^;]*;/;
    export const RELAXED_STYLE_SRC = "style-src 'self' 'unsafe-inline';";
    export function relaxStyleSrc(html: string): string; // one replacement of STYLE_SRC by RELAXED_STYLE_SRC
    export default function cspStyleSrc(): AstroIntegration; // name "ea-csp-style-src"; hook "astro:build:done": walk `dir` for *.html, rewrite each, log `style-src relaxed in <n> page(s)` through the hook's `logger`
    ```

  - Decisions:
    - The integration is the probe file `notes/2026-11-08-s5a-probes/csp-style-src.mjs.txt` typed (fact 13 and W3: Radix overlays inject a scroll-lock `<style>` with a variable text; a hash in the list makes browsers ignore `'unsafe-inline'`; Astro always appends its hashes). It uses `node:fs` and `node:path` (`readdirSync`, `statSync`, `readFileSync`, `writeFileSync`, `join`) and `fileURLToPath` on `dir`. It changes only the `style-src` segment; `script-src` keeps its hashes.
    - `frame-ancestors` is **not** in the directives (a meta cannot carry it; the server header does, W3; Chromium logs an error otherwise, fact 13). `server: { port: 3000 }` goes: the dev server is Astro's default 4321 (D18).
    - **Order of the shadcn run and the CSS edit** (cold review of this plan, finding 26): first `cd apps/web && bunx --bun shadcn@latest add button input label card dialog select tabs badge skeleton sonner dropdown-menu sheet table switch alert tooltip --yes --overwrite` (the D17 list; `components.json` exists: `new-york`, `neutral`, lucide, alias `@/`), then the W4 edit of `global.css`, then `git diff apps/web/src/styles/global.css` to confirm that the CLI rewrote nothing else. Do not edit the generated component files (the rule "shadcn components come from the CLI"); the `sonner.tsx` import of `next-themes` is fine without a provider (`useTheme()` falls back to `"system"`).
    - `global.css` (W4, fact 14): delete the line `@custom-variant dark (&:is(.dark *));`; turn the block `.dark { … }` into `@media (prefers-color-scheme: dark) { :root { … } }` (the same variables; the diff is `notes/2026-11-08-s5a-probes/global-css-dark-media.diff.txt`); keep the rest. No theme script anywhere (U2: light and dark by the system).
    - `Public.astro` (login, setup, 404): `<!doctype html>`, `<html lang="en">`, `<head>` with charset, viewport, `<link rel="icon" type="image/png" href="/favicon.png">`, `<title>{title} · Email Assistant</title>` (S5; the layout takes `title: string`), `<slot name="head" />`, `import "../styles/global.css"`; `<body class="min-h-screen bg-background text-foreground">` with `<noscript>` holding `en.noscript` (S9; the Astro frontmatter imports `en` from `../i18n/en`), then `<main class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">` with the word mark `<p class="text-center text-lg font-semibold">{en.brand}</p>` and `<slot />`. No `<style>` block (Tailwind preflight resets the body margin).
    - `404.astro` (S10): `Public` layout, `title={en.title_not_found}`; `<h1>` with `en.not_found_title`, `<p>` with `en.not_found_text`, `<a href="/" class="underline">` with `en.not_found_link`. Astro writes it to `dist/404.html` (D6 serves it).
    - `index.astro` (the stub): `Public` layout with `<meta http-equiv="refresh" content="0; url=/onboarding" slot="head">` and a one-line body `<a href="/onboarding">{en.continue}</a>`. The built server never serves it (W5 redirects `/` before the static files); the Astro dev server (`web:dev`) needs it so that `/` works in the dev loop (stage 11.3). No script: a meta refresh passes the CSP.
    - `en.ts` in this step: `brand`, `noscript`, `continue`, `not_found_title`, `not_found_text`, `not_found_link`, `title_not_found`, plus the `t()` helper (9.2 adds the other keys).
    - `apps/web/tsconfig.json` stays (`@/*` alias, `include ["**/*"]`); `integrations/` is inside it, so `astro check` type-checks the integration.
    - Lint: the root `eslint.config.js` already lints `apps/web/**`; the generated shadcn files must pass `react-compiler` and `jsx-a11y` as they are (if a rule fires, the finding goes to the main session, never a disable comment).
  - Test: the build itself plus greps: (1) `bun run web:build` exits 0 and `dist/404.html`, `dist/index.html` exist; (2) `grep -c "style-src 'self' 'unsafe-inline';" apps/web/dist/404.html` → 1 and `grep -c "frame-ancestors" apps/web/dist/404.html` → 0; (3) `grep -c "<style" apps/web/dist/404.html` → 0 (a page without an island has no inline style; island pages carry Astro's one `astro-island` style, fact 16); (4) `grep -c "prefers-color-scheme: dark" apps/web/dist/_astro/*.css` ≥ 1 and `grep -c "\.dark " apps/web/dist/_astro/*.css` → 0; (5) `git diff --stat bun.lock` lists the web additions only.
  - Check: `cd apps/web && bun run build && cd ../.. && bun run lint && bun run typecheck` (the workspace `typecheck` runs `astro check`); the greps above; `git status --short` shows no change outside `apps/web/`, `bun.lock` and `packages/core` (none expected there).
  - Done when: the build and the checks pass and the greps hold.
  - Out of scope: the app shell and the app pages (stage 10), the login and setup pages (stage 11), Playwright (stages 12–13).

- [ ] **9.2 `i18n/en.ts` with `t()`, `lib/api.ts`, `lib/auth-client.ts`, `lib/use-resource.ts`, the `jsx-no-literals` lint rule, the web rule in the code patterns**
  - Goal: every user-visible string of S5a has a key (U1, S3–S12), the pages of stages 10 and 11 have their helpers (W19), and the lint guards the "no literal text in a component" rule from the first component on.
  - Files: change `apps/web/src/i18n/en.ts` (all keys), create `apps/web/src/lib/api.ts`, `apps/web/src/lib/auth-client.ts`, `apps/web/src/lib/use-resource.ts`, `apps/web/src/lib/api.test.ts`; keep `apps/web/src/lib/utils.ts` (`cn`); change `eslint.config.js`, the root `package.json` (`test:unit` gains `apps/web/src/lib`), `docs/code-patterns.md`.
  - Interfaces:

    ```ts
    // i18n/en.ts
    export const en = {
      brand: "Email Assistant",
      noscript: "This app needs JavaScript. Turn it on and reload the page.",
      continue: "Continue",
      // nav (S6)
      nav_main: "Main",
      nav_onboarding: "Onboarding",
      nav_activity: "Activity",
      nav_mailboxes: "Mailboxes",
      nav_settings: "Settings",
      nav_rules: "Rules",
      menu_open: "Open menu",
      menu_title: "Menu",
      user_menu: "Account menu",
      log_out: "Log out",
      // shell states (S8, S11, S12)
      auth_error_banner_one: "1 mailbox has a login error.",
      auth_error_banner_many: "{count} mailboxes have a login error.",
      auth_error_banner_link: "Open Mailboxes",
      placeholder_text: "Not built yet. It comes with the next update.",
      no_organization_title: "No organization",
      no_organization_text: "Your account is not in any organization. Ask the owner for an invitation.",
      load_error_text: "Could not load your account.",
      retry: "Retry",
      loading: "Loading",
      // login (S3)
      login_title: "Sign in",
      email_label: "E-mail",
      password_label: "Password",
      sign_in: "Sign in",
      signing_in: "Signing in…",
      login_error_credentials: "Wrong e-mail or password.",
      error_too_many: "Too many attempts. Wait a minute and try again.",
      error_generic: "Something went wrong. Try again.",
      login_setup_done: "Password set. Sign in.",
      login_help_summary: "No password yet?",
      login_help_text:
        "Setup links are created on the server with web:invite. A link works once, for 24 hours. If yours has expired, ask for a new one.",
      // setup (S4)
      setup_title: "Set your password",
      new_password_label: "New password",
      repeat_password_label: "Repeat password",
      password_help: "At least 12 characters. A passphrase of a few words works well.",
      set_password: "Set password",
      setting_password: "Setting password…",
      password_too_short: "At least 12 characters.",
      password_too_long: "At most 128 characters.",
      passwords_differ: "The passwords do not match.",
      email_invalid: "Enter a valid e-mail address.",
      password_required: "Enter your password.",
      setup_link_invalid: "This link was used or has expired. Ask for a new one.",
      setup_link_missing: "This page needs a setup link.",
      go_to_sign_in: "Go to sign in",
      // 404 (S10)
      not_found_title: "Page not found",
      not_found_text: "This page does not exist.",
      not_found_link: "Go to the start page",
      // page titles
      title_onboarding: "Onboarding",
      title_activity: "Activity",
      title_mailboxes: "Mailboxes",
      title_settings: "Settings",
      title_rules: "Rules",
      title_login: "Sign in",
      title_setup: "Set your password",
      title_not_found: "Page not found",
    } as const;
    export type TextKey = keyof typeof en;
    export function t(key: TextKey, vars?: Record<string, string | number>): string; // replaces `{name}` with vars[name]
    ```

    ```ts
    // lib/api.ts (W19) — every core import in the web uses the subpath "@ea/core/web" (stage 7; the core barrel pulls node:crypto)
    import { apiErrorSchema } from "@ea/core/web";
    import type { z } from "zod";
    export class ApiError extends Error { constructor(readonly status: number, readonly code: string, message?: string, readonly details?: { path: string; code: string; message: string }[]) }
    export interface ApiDeps { fetchImpl: typeof fetch; onUnauthorized: () => void }
    export function createApi(deps: ApiDeps): <T>(path: string, schema: z.ZodType<T>, init?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown }) => Promise<T>;
    export const api = createApi({ fetchImpl: (...a) => fetch(...a), onUnauthorized: () => location.assign("/login?next=" + encodeURIComponent(location.pathname)) }); // a template literal in code
    // lib/auth-client.ts
    import { createAuthClient } from "better-auth/react";
    export const authClient = createAuthClient({ baseURL: typeof location === "undefined" ? undefined : location.origin });
    // lib/use-resource.ts (U7)
    export function useResource<T>(load: () => Promise<T>, opts?: { pollMs?: number }): { data: T | null; error: unknown; loading: boolean; reload: () => void }; // first render: { data: null, error: null, loading: true }
    ```

  - Decisions:
    - `t()` is the only way a component gets a string; a key that does not exist is a TypeScript error (`TextKey`). Keys for S5b–S5d are added by those segments. The `{count}` form serves the banner (S8): `t("auth_error_banner_one")` for 1, `t("auth_error_banner_many", { count })` for more.
    - `createApi`: on a non-2xx it reads the body as JSON and parses it with `apiErrorSchema`; a body that does not parse becomes `ApiError(status, "internal")`; a 401 calls `deps.onUnauthorized()` and returns a promise that never settles (the page is leaving); a 204 resolves `undefined as T`; a 2xx body is `schema.parse(json)` (a shape error throws a `ZodError`, which the page shows as the generic error: the API and the UI drifted). `credentials: "same-origin"`, `headers: { accept: "application/json" }` plus `content-type: application/json` when a body exists; the body is `JSON.stringify(init.body)`.
    - `authClient` is created at module load in the browser only (`location` guard for the Astro build step, which imports islands on the server to render them); the client posts to `/api/auth/*` with the browser's `Origin` header (fact 10, fact 22).
    - `useResource` (cold review of this plan, finding 21): `load` is stored in a `useRef` that a `useEffect` updates on every render (`loadRef.current = load`), and the polling effect depends on `[pollMs]` only: it calls `loadRef.current()` on mount and every `pollMs` while `document.visibilityState === "visible"`; a `visibilitychange` listener pauses the timer and reloads at once when the tab becomes visible again (U7); `reload()` is the one entry for a later push signal. Errors are kept in `error`; a failed poll keeps the last `data` (no flicker). Written to pass `react-compiler` (no mutation during render; the timer lives in the effect with a cleanup). An inline `load` in a component never restarts the loop. The first render (also the build's prerender) is `{ data: null, error: null, loading: true }`, so the static HTML shows the skeleton (stage 10.2 greps `aria-busy="true"`; second cold review, finding 8).
    - `eslint.config.js` (cold review of this plan, finding 32): a block for `apps/web/src/islands/**/*.tsx`, `apps/web/src/components/shell/**/*.tsx`, `apps/web/src/components/auth/**/*.tsx` with `"react/jsx-no-literals": ["error", { noStrings: true, ignoreProps: true, allowedStrings: ["·", "—", "/"] }]` (the generated `components/ui/**` is excluded on purpose: the CLI's files hold `sr-only` texts). `ignoreProps: true` lets `aria-label={t("…")}` and `href="/mailboxes"` pass; a literal child text fails the lint.
    - Unit tests for the `ApiError` parsing live in `apps/web/src/lib/api.test.ts` with `/// <reference types="bun" />` at the top (the root `@types/bun` resolves it; `astro check` type-checks it too). The root `test:unit` script becomes `bun test packages/core apps/server/src tools/fake-telegram/src apps/web/src/lib`.
    - `docs/code-patterns.md` gets, in this commit, the section "Web app (`apps/web`)": "Every user-visible string is a key in `apps/web/src/i18n/en.ts` and reaches a component through `t()`; a component never holds a literal text (`react/jsx-no-literals` on the islands and the shell and auth components). No inline `<script>` and no hand-written `<style>` (the build hashes the scripts, D5; styles come from Tailwind classes). shadcn components come from the shadcn CLI, never by hand. One island per page; the shell is a React component inside the island. Data comes from `/api/*` through `lib/api.ts`; the request and response shapes are the `@ea/core/web` schemas, and the web imports core only through that subpath."
  - Test (`api.test.ts`): `createApi` with a fake `fetchImpl` returning `Response.json({ error: "owner_only" }, { status: 403 })` → rejects with `ApiError` `status 403`, `code "owner_only"`; a 400 with `details` keeps them; a 500 with a non-JSON body → `code "internal"`; a 401 → `onUnauthorized` called once and the promise stays pending (assert with `Promise.race` against a 50 ms timer); a 200 with `{ ok: true }` and `z.object({ ok: z.boolean() })` → `{ ok: true }`; a 204 → `undefined`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && cd apps/web && bun run build`; a probe of the lint rule: add `<p>Hello</p>` to a throwaway `apps/web/src/islands/Probe.tsx`, run `bun run lint` (it must fail with `react/jsx-no-literals`), delete the file.
  - Done when: the tests pass, the lint probe fails as expected and is removed, `t("nope")` is a type error (try it once and revert), the build passes.
  - Out of scope: the shell and the pages (stages 10 and 11).
