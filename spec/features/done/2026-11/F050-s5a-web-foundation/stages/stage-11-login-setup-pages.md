# s5a-web-foundation — Stage 11

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", S1–S13, "Facts checked", W1–W20, "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first. Decisions named D<n> are in the master plan, W<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 11 — Login and setup pages (islands, forms, errors, redirects), the dev loop hand check

Reviewed on Opus high (the login flow and the redirect guard are auth code).

- [x] **11.1 `/login`**
  - Goal: the owner signs in with e-mail and password (S3): one error text for a bad login, a text for 429 and for other failures, the `next` redirect rule, the "No password yet?" help, the `setup=done` note; a signed-in visitor is sent on.
  - Files: create `apps/web/src/pages/login.astro`, `apps/web/src/islands/LoginPage.tsx`, `apps/web/src/components/auth/AuthCard.tsx` (the shared card: `CardHeader` with the title, `CardContent` with `children`), `apps/web/src/lib/next-path.ts`, `apps/web/src/lib/next-path.test.ts`.
  - Interfaces:

    ```ts
    // lib/next-path.ts (pure; the browser twin of the server's safeNext, stage 5)
    export function safeNextPath(raw: string | null): string; // the seven steps of stage 5's safeNext (its Decisions), the same test list; else "/"
    // islands/LoginPage.tsx
    export default function LoginPage(): JSX.Element;
    // state: { email, password, pending, error: TextKey | null, setupDone: boolean }
    ```

  - Decisions:
    - `login.astro`: `Public` layout, `title={en.title_login}`, `<LoginPage client:load />`.
    - On mount: `authClient.getSession()`; when it returns a session → `location.replace(safeNextPath(params.get("next")))` (a signed-in user never sees the form; `/login?next=/login` cannot loop because `safeNextPath` maps `/login*` to `/`: cold review of this plan, finding 11). `setupDone = params.get("setup") === "done"` → the note `t("login_setup_done")` in an `Alert` above the form (S3).
    - The form (`<form onSubmit>` with `noValidate`): `Label` + `Input` for the e-mail (`type="email"`, `name="email"`, `autoComplete="username"`, `inputMode="email"`, `required`; no `autoFocus`: `jsx-a11y/no-autofocus` is an error in the repo config) and the password (`type="password"`, `name="password"`, `autoComplete="current-password"`, `required`); client validation with `loginFormSchema` from `@ea/core/web` (stage 7): an invalid e-mail → `t("email_invalid")` under the field, an empty password → `t("password_required")`; the submit `Button` reads `t("sign_in")`, and while `pending` it is `disabled` and reads `t("signing_in")`. No "show password", no "remember me" (S3).
    - Submit: `const { error } = await authClient.signIn.email({ email, password })`; `error === null` → `location.assign(safeNextPath(params.get("next")))`; `error.status === 429` → `t("error_too_many")`; `error.status === 401` or `error.code === "INVALID_EMAIL_OR_PASSWORD"` → `t("login_error_credentials")`; anything else (network, 403 `bad_origin`, 500) → `t("error_generic")`. The error renders in `<p role="alert" className="text-destructive text-sm">` under the form (one text, never which field was wrong: S3). The password field is cleared on an error; the e-mail stays. The client's error shape (`error.status`, `error.code`) is a not-verified item that stage 13's smoke settles; if it differs, map by `error.status` only.
    - Help (S3): `<details>` with `<summary>{t("login_help_summary")}</summary><p>{t("login_help_text")}</p></details>` under the form; plain HTML, keyboard-reachable (U9).
  - Test:
    1. `next-path.test.ts`: `safeNextPath("/mailboxes")` → `/mailboxes`; `"/mailboxes?x=1#y"` → the same; `null` → `/`; `""` → `/`; `"//evil.test"` → `/`; `"https://evil.test/"` → `/`; `"/\\evil.test"` → `/`; `"mailboxes"` → `/`; `"/login"`, `"/login?next=%2F"`, `"/setup?token=abc"` → `/`; `"/\t/evil.test"`, `"/\n/evil.test"`, `"/\r\n/evil.test"` → `/` (the URL parser drops tab, LF and CR; second cold review, finding 1); `"/%09/evil.test"` → the same; `"/.//evil.test"`, `"/..//evil.test"`, `"/a/..//evil.test"`, `"/%2e//evil.test"` → `/` (dot segments; stage 5 review, 2026-11-09).
    2. Playwright (stage 13, W20 cases 1–3, 7) covers the wrong password text, the success redirect to `/onboarding` through `/`, the sign-out and the 429 text.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && cd apps/web && bun run build`; then `grep -rlE "__vite-browser-external|node:crypto" dist/_astro` → nothing (second cold review, finding 16).
  - Done when: the build is green, the unit test passes, and the hand check of 11.3 passes for the login.
  - Out of scope: the setup page (11.2), Playwright (stage 13), a password reset from the browser (S6).

- [x] **11.2 `/setup`**
  - Goal: the setup link sets the first or a new password and signs the user in (S4, D2); a used, expired or missing link shows one clear text.
  - Files: create `apps/web/src/pages/setup.astro`, `apps/web/src/islands/SetupPage.tsx`.
  - Interfaces: `export default function SetupPage(): JSX.Element;` state `{ mode: "form" | "invalid" | "missing", email, password, repeat, pending, fieldErrors: Partial<Record<"email" | "password" | "repeat", TextKey>>, error: TextKey | null }`.
  - Decisions:
    - `setup.astro`: `Public` layout, `title={en.title_setup}`, `<SetupPage client:load />`.
    - On mount: `token = params.get("token")`, `error = params.get("error")`; `error !== null` (Better Auth redirects with `?error=INVALID_TOKEN`, fact 4) → `mode "invalid"`; `token === null` → `mode "missing"`; else `mode "form"`. The URL is never logged or sent anywhere except to Better Auth.
    - The form (S4): `Label` + `Input` for the e-mail (`autoComplete="username"`), the new password (`type="password"`, `autoComplete="new-password"`, with `t("password_help")` as the description linked by `aria-describedby`), the repeat (`autoComplete="new-password"`); client validation with `setPasswordFormSchema` and `fieldErrors` (stage 7) → `password_too_short`, `password_too_long`, `passwords_differ`, `email_invalid` under the fields, each in `<p id="<field>-error">` (`email-error`, `password-error`, `repeat-error`) that its input names in `aria-describedby`, with `aria-invalid` on the input (stage 13 reads an error by its id); the submit `Button` reads `t("set_password")` / `t("setting_password")`.
    - Submit: `const { error } = await authClient.resetPassword({ newPassword: password, token })`; `error !== null`: `error.code === "INVALID_TOKEN"` (400) → `mode "invalid"`; `429` → `t("error_too_many")`; else `t("error_generic")`. Success → `const signIn = await authClient.signIn.email({ email, password })`; `signIn.error === null` → `location.assign("/")` (W5 sends it to `/onboarding`); else → `location.assign("/login?setup=done")` (the e-mail did not match the link's user; S4).
    - `mode "invalid"` view: `<p role="alert">{t("setup_link_invalid")}</p>` and `<a href="/login">{t("go_to_sign_in")}</a>`; `mode "missing"`: `t("setup_link_missing")` with the same link. No form in these modes.
    - A `<form>` `POST` fallback without JavaScript is not built (U4: `<noscript>` text).
  - Test: Playwright (stage 13, W20 case 4) covers the happy path, the reused link and the client validation texts. No unit test (the page is glue around the core schema, which has its own tests in stage 7).
  - Check: `bun run lint && bun run typecheck && cd apps/web && bun run build`; then `grep -rlE "__vite-browser-external|node:crypto" dist/_astro` → nothing.
  - Done when: the build is green and the hand check of 11.3 passes for the setup link.
  - Out of scope: an e-mail with the link (S6), a "request a new link" button (S6, `web-public-hardening.md`).

- [x] **11.3 Dev loop hand check (both shapes of D18; a not-verified item)**
  - Goal: the real flow works in the Astro dev shape (`bun run web:dev` at `http://localhost:4321`, the API proxied to 8080) and the built shape (`bun run web:build && bun run dev`, the browser at `http://127.0.0.1:8080`).
  - Files: none (a check). The implementer writes the result as a log line in the segment file ("Log": the date, both shapes, pass or the exact failure).
  - Decisions: the keys in the worktree's `.env` are user step 1 (D18, D7: `WEB_BASE_URL=http://localhost:4321`, so every setup link carries `callbackURL=http://localhost:4321/setup`, which only the Astro dev server answers — the built shape on 8080 is for the login, not for the link: cold review of this plan, finding 7). The dev organization: `bun run org:create` exists from S0 (the worktree database has one after the user ran it there, or the implementer creates one: `bun run org:create --org-name Dev --email dev-owner@x.test --display-name Dev`).
    - Astro dev shape (the setup link): `bun run dev` (the server) and `bun run web:dev` in a second terminal; `bun run web:invite --org-id <dev org>` → open the printed link → Better Auth redirects to `http://localhost:4321/setup?token=…` → set a password → `/` → the `index.astro` meta refresh → `/onboarding` with the shell → menu → Log out → `/login` → sign in → `/onboarding`. The request goes through the Vite proxy with `Origin: http://localhost:4321`, which both checks trust (fact 10); the cookie is set for `localhost`.
    - Built shape (the login): `bun run web:build`, then with `bun run dev` still running open `http://127.0.0.1:8080/login` → sign in with the password set above (the origin `http://127.0.0.1:8080` is in `WEB_TRUSTED_ORIGINS`) → `/onboarding` with the shell → both widths (browser devtools) → menu → Log out. A CSP error in the console in the built shape is a FAIL (the Astro dev server does not apply `experimental.csp`, so console cleanliness is judged only in the built shape).
  - Test: the two walkthroughs above.
  - Check: the database guard (segment file, user step 0) before `bun run dev`; both shapes pass; `bun run lint && bun run typecheck` unchanged.
  - Done when: the log line is written; the not-verified item "web:dev loop" of the segment file is marked verified or the failure is reported to the main session (a failure of the proxy shape changes D18, not the code of this stage).
  - Out of scope: the VPS, Tailscale (S5e).
