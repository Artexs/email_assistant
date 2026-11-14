# F105 stage 08 — Login code step

Part of [`../plan.md`](../plan.md). Read its D15, D16, D20, "Facts checked" F3–F5 and "Rules for every stage" first. Lane C. Needs stage 02 (the server answers `twoFactorRedirect` and opens the verify paths). Web only. A review job checks it before the land (the sign-in page).

Two steps. About 260 changed lines.

- [ ] **08.1 Client plugin and the code-step helpers**
  - Goal: the web client knows the two-factor calls, and one tested helper turns each error of the code step into a text and a "start again" choice.
  - Files: change `apps/web/src/lib/auth-client.ts`; add `apps/web/src/lib/two-factor-errors.ts` and `apps/web/src/lib/two-factor-errors.test.ts`; change `apps/web/src/i18n/en.ts` (and `pl.ts` if it exists, D20).
  - Interfaces:

    ```ts
    // lib/auth-client.ts
    import { twoFactorClient } from "better-auth/client/plugins";
    export const authClient = createAuthClient({
      baseURL: typeof location === "undefined" ? undefined : location.origin,
      plugins: [twoFactorClient()], // no options: the login page reads data.twoFactorRedirect itself (plan D15)
    });

    // lib/two-factor-errors.ts — pure
    export interface CodeStepError { key: TextKey; restart: boolean } // restart = go back to the password step
    export function codeStepError(error: { status?: number; code?: string } | null | undefined): CodeStepError | null;
    export function cleanTotpCode(input: string): string | null;   // spaces removed; 6 digits → the digits; else null
    export function cleanBackupCode(input: string): string | null; // trimmed; "abcde12345" → "abcde-12345"; must match /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/ (case kept); else null
    ```

    `codeStepError` table (first match wins):

    | Error | key | restart |
    | --- | --- | --- |
    | null or undefined | (returns null) | — |
    | `code` `ACCOUNT_TEMPORARILY_LOCKED` | `tf_error_locked` | true |
    | `status` 429 | `error_too_many` | false |
    | `code` `INVALID_CODE` | `tf_error_code` | false |
    | `code` `INVALID_BACKUP_CODE` | `tf_error_backup_code` | false |
    | `code` `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` | `tf_error_attempts` | true |
    | `code` `INVALID_TWO_FACTOR_COOKIE` | `tf_error_expired` | true |
    | `code` `TOTP_NOT_ENABLED` | `tf_error_state` | false |
    | any other | `error_generic` | false |

    Keys (exact English | Polish for `pl.ts`, D20):

    | Key | English | Polish |
    | --- | --- | --- |
    | `tf_code_title` | Two-factor sign-in | Logowanie dwuetapowe |
    | `tf_code_label` | Code from your authenticator app | Kod z aplikacji uwierzytelniającej |
    | `tf_code_help` | Open the app and type the 6-digit code for Email Assistant. | Otwórz aplikację i wpisz 6-cyfrowy kod dla Email Assistant. |
    | `tf_backup_label` | Backup code | Kod zapasowy |
    | `tf_backup_help` | Type one of your saved backup codes, for example abcde-12345. Each code works once. | Wpisz jeden z zapisanych kodów zapasowych, na przykład abcde-12345. Każdy kod działa tylko raz. |
    | `tf_use_backup` | Use a backup code | Użyj kodu zapasowego |
    | `tf_use_app` | Use the authenticator app | Użyj aplikacji uwierzytelniającej |
    | `tf_trust_device` | Trust this device for 30 days | Ufaj temu urządzeniu przez 30 dni |
    | `tf_trust_help` | Only on your own device. After 30 days it asks for a code again. | Tylko na własnym urządzeniu. Po 30 dniach znowu poprosi o kod. |
    | `tf_verify` | Confirm | Potwierdź |
    | `tf_verifying` | Checking… | Sprawdzanie… |
    | `tf_back` | Back | Wstecz |
    | `tf_code_invalid_format` | Type the 6 digits. | Wpisz 6 cyfr. |
    | `tf_backup_invalid_format` | Type the code as you saved it, for example abcde-12345. | Wpisz kod tak, jak go zapisano, na przykład abcde-12345. |
    | `tf_error_code` | Wrong code. Check that the time on your phone is right and try again. | Błędny kod. Sprawdź, czy telefon ma dobrą godzinę, i spróbuj ponownie. |
    | `tf_error_backup_code` | This backup code is wrong or was already used. | Ten kod zapasowy jest błędny albo został już użyty. |
    | `tf_error_attempts` | Too many tries. Sign in again. | Za dużo prób. Zaloguj się ponownie. |
    | `tf_error_expired` | The sign-in step expired. Sign in again. | Krok logowania wygasł. Zaloguj się ponownie. |
    | `tf_error_locked` | Too many wrong codes. Try again in 15 minutes. | Za dużo błędnych kodów. Spróbuj ponownie za 15 minut. |
    | `tf_error_state` | Two-factor sign-in has a problem. Use a backup code or ask the operator to reset it. | Logowanie dwuetapowe ma problem. Użyj kodu zapasowego albo poproś operatora o reset. |

  - Decisions: D15, D16, D20.
  - Test (`two-factor-errors.test.ts`):
    1. Each row of the table gives its key and `restart`; `ACCOUNT_TEMPORARILY_LOCKED` with status 429 gives `tf_error_locked` (not `error_too_many`).
    2. `cleanTotpCode`: `"123 456"` → `"123456"`; `" 123456 "` → `"123456"`; `"12345"`, `"1234567"`, `"12a456"`, `""` → null.
    3. `cleanBackupCode`: `"AbCdE-12345"` → same; `" abcde-12345 "` → `"abcde-12345"`; `"abcde12345"` → `"abcde-12345"`; `"abcd-12345"`, `"abcde_12345"`, `""` → null.
  - Check: `bun test apps/web/src/lib/two-factor-errors.test.ts apps/web/src/i18n`; `bun run typecheck`.
  - Done when: tests 1–3 pass; every key of the table is in `en.ts` (and in `pl.ts` when it exists).
  - Out of scope: the page (08.2).

- [ ] **08.2 The code step in `LoginPage`**
  - Goal: after a correct password, a member with TOTP types a code or a backup code, may trust the device, and then lands on the next page.
  - Files: change `apps/web/src/islands/LoginPage.tsx`.
  - Interfaces and behaviour:
    - State: `step: "password" | "code"`, `method: "totp" | "backup"`, `code`, `trust` (false), `codeError: TextKey | null`, `pending`.
    - `onSubmit` of the password form: when `signIn.email` returns `data` with `twoFactorRedirect === true` (check with `"twoFactorRedirect" in data`), clear the password, set `step = "code"`, `method = "totp"`, and do not navigate. All other answers stay as today.
    - The code step replaces the password form inside the same `AuthCard` (title `tf_code_title`). One `<form>` (`noValidate`, `method="post"`): for `totp` an `Input` `id="tf-code"` with `Label` `tf_code_label`, `inputMode="numeric"`, `autoComplete="one-time-code"`, `maxLength={7}` (one space allowed), help `tf_code_help`; for `backup` an `Input` `id="tf-backup"` with `Label` `tf_backup_label`, `autoComplete="off"`, help `tf_backup_help`. Below it a `Switch` `id="tf-trust"` with `Label` `tf_trust_device` and help `tf_trust_help`. The submit `Button` shows `tf_verify` (`tf_verifying` while pending). A link-style `Button variant="link"` toggles `method` (`tf_use_backup` / `tf_use_app`) and clears the input and the error. A `Button variant="outline"` `tf_back` returns to the password step (no server call).
    - Submit: clean the input (`cleanTotpCode` or `cleanBackupCode`); null → field error `tf_code_invalid_format` / `tf_backup_invalid_format`, no call. Else `authClient.twoFactor.verifyTotp({ code, trustDevice: trust })` or `.verifyBackupCode({ code, trustDevice: trust })`. No error → `location.assign(nextTarget())`. An error → `codeStepError`: show the text (`role="alert"`); `restart` true → back to the password step with that text shown above the password form; always clear the code input.
    - A thrown error → `error_generic`.
    - The first line of the default export stays `useLocale();` (the islands test checks it).
  - Decisions: D16.
  - Test: the helpers of 08.1 carry the logic; stage 11 drives the page in the browser.
  - Check: `bun run typecheck`; `bun run lint`; `bun run web:build`; `bun test apps/web/src/i18n`.
  - Done when: the build passes and the page has no literal text (every visible string through `t()`).
  - Out of scope: the Account card (stage 10); e2e (stage 11).

## Done when

- Steps 08.1 and 08.2 are done and committed by explicit paths.
- The web Proof command of `plan.md` for stage 08 (`/tmp/f105-s08`, with `bun run web:build`) prints `PROOF_OK`.
