# F119 stage 12 — Login page: company sign-in

Part of [`../plan.md`](../plan.md). Review before the land (sign-in page, Polish texts). Needs stage 11. Web only.

## Step 12.1 — The company sign-in path

**Goal.** A member of an organization with SSO signs in from `/login` without a password (D14).

**Files.** `apps/web/src/islands/LoginPage.tsx` (or a new component under `components/login/` if the file passes about 400 lines), `apps/web/src/lib/sso-errors.ts` (new, pure), `apps/web/src/lib/auth-client.ts` (`ssoClient()` from `@better-auth/sso/client` only if `@ea/web` already has the package; else a plain `fetch` POST to `/api/auth/sign-in/sso` — no new web dependency, no `bun.lock` change), `en.ts`, `pl.ts`.

**Interfaces.**
- On load the page calls `GET /api/sign-in-options` (`signInOptionsSchema`). `sso: false` or an error → the page is as today.
- `sso: true` → under the password form: the hint `login_sso_hint` and the button `login_sso_button`. The button opens a small form: e-mail (`autocomplete="email"`) and `login_sso_submit`. Submit → `POST /api/auth/sign-in/sso` with `{ email, callbackURL: <safe next path or "/">, errorCallbackURL: "/login?sso=failed" }`; on `{ url }` the browser goes to `url` (only `https:` or a same-origin URL; else the generic error). An error answer (no provider for the domain, 401 for an unproved one, 429) → `login_sso_error_no_provider` or `login_sso_error_rate` for 429.
- Back from the callback with `?error=<code>`: `ssoErrorText(code)` maps `not_a_member`, `domain_mismatch`, `identity_mismatch`, `sso_off` to their keys; any other value → `login_sso_error_generic`. The page never renders the raw query value. `error_description` is ignored.
- A wrong password on an SSO organization looks like any wrong password (D8): the page adds no SSO-specific text to `login_error_credentials`; the hint above is the only pointer.

**Decisions.** D8, D14. Texts: copy word for word (F098 rule); informal "ty"; `i18n.test.ts` must pass (no Polish text equals the English one).

| Key | en | pl |
| --- | -- | -- |
| `login_sso_hint` | Does your company use single sign-on? Sign in with your company account. | Twoja firma używa logowania jednokrotnego? Zaloguj się kontem firmowym. |
| `login_sso_button` | Sign in with your company account | Zaloguj się kontem firmowym |
| `login_sso_email` | Work e-mail | Służbowy adres e-mail |
| `login_sso_submit` | Continue | Dalej |
| `login_sso_back` | Back to password sign-in | Wróć do logowania hasłem |
| `login_sso_error_no_provider` | Company sign-in is not set up for this address. Sign in with your password. | Logowanie kontem firmowym nie jest ustawione dla tego adresu. Zaloguj się hasłem. |
| `login_sso_error_rate` | Too many tries. Wait a minute and try again. | Za dużo prób. Odczekaj minutę i spróbuj ponownie. |
| `login_sso_error_not_member` | This company account has no access. Ask the operator to add you. | To konto firmowe nie ma dostępu. Poproś operatora o dostęp. |
| `login_sso_error_domain` | This company account uses another domain. Use your work e-mail. | To konto firmowe ma inną domenę. Użyj służbowego adresu e-mail. |
| `login_sso_error_identity` | Your company account changed. Ask the operator to unlink the old one. | Twoje konto firmowe się zmieniło. Poproś operatora o odłączenie starego. |
| `login_sso_error_off` | Company sign-in is off for your organization. Sign in with your password or ask the operator. | Logowanie kontem firmowym jest wyłączone w twojej organizacji. Zaloguj się hasłem albo napisz do operatora. |
| `login_sso_error_generic` | Company sign-in failed. Try again or ask the operator. | Logowanie kontem firmowym nie udało się. Spróbuj ponownie albo napisz do operatora. |

**Test** (`apps/web/src/lib/sso-errors.test.ts`, the web unit tests that exist for the login page, `i18n.test.ts`):

1. `ssoErrorText("not_a_member")` → `login_sso_error_not_member`; `"domain_mismatch"`, `"identity_mismatch"`, `"sso_off"` → their keys; `"<script>"`, `""`, `undefined` → `login_sso_error_generic`.
2. The URL check: `https://login.microsoftonline.com/x` and `/api/auth/x` pass; `javascript:alert(1)` and `http://evil.test` fail.
3. The safe next path: `/activity` stays; `//evil.test` and `https://evil.test` become `/` (reuse the page's existing next-path rule).
4. Every new key exists in `en.ts` and `pl.ts`; `bun run typecheck` passes.
5. With `sso: false` the page renders no SSO element (component test if the repo has one for islands; else a pure `loginSections(options)` helper with this test).

**Check.** The web Proof of `plan.md` (`/tmp/f119-s12`).

**Done when.** The five tests pass; `bun run web:build` passes; Proof prints `PROOF_OK`.

**Out of scope.** The Account card and the console (stage 13); a Playwright spec (Q9).
