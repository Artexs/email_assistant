# F105 stage 11 — Account card section

Part of [`../plan.md`](../plan.md). Read its D14, D17, D20, D25, "Facts checked" F2, F7 and "Rules for every stage" first. Lane C. Needs stage 08 (`GET /api/me/two-factor`, `twoFactorStatusSchema`, `FEW_BACKUP_CODES`), stage 09 (the client plugin, `tf_*` keys) and stage 10 (`TotpQr`, `totpSecretOf`, `groupSecret`, `accountTwoFactorError`). Web only.

One step (one component and its wiring). About 300 changed lines.

- [ ] **11.1 `TwoFactorSection` in the Account card**
  - Goal: a member turns TOTP on (password → QR → code → backup codes once), sees how many backup codes are left, makes new ones, and turns TOTP off; the section says when the role needs TOTP.
  - Files: add `apps/web/src/components/settings/TwoFactorSection.tsx`; change `apps/web/src/components/settings/AccountCard.tsx` (one wrapper and one element); change `apps/web/src/i18n/en.ts` and `apps/web/src/i18n/pl.ts` (every key in both files: `pl.ts` is on `master` and its type requires each key, D20).
  - Interfaces and behaviour:
    - `AccountCard`: between the password `<form>` and the sessions block, add `<div className="border-t pt-4"><TwoFactorSection /></div>`. Nothing else in the card changes. At ff61cbc the card holds, in order: `LanguageSelect` (F098 stage 04), the password `<form>`, the sessions block (`<div className="flex flex-col items-start gap-2 border-t pt-4">` with `SessionsList`), and the owner's `SecurityLog` (F099 stage 13). `SecurityLog.tsx` in the same folder is the pattern for a section component in its own file.
    - `TwoFactorSection` root: `<section id="two-factor" data-section="two-factor" className="flex flex-col gap-3">`, title `<h3 className="text-sm font-medium">{t("tf_title")}</h3>`.
    - Status: `useResource(() => api("/api/me/two-factor", twoFactorStatusSchema))`, loading `Skeleton`, error `load_error_text` + Retry (as `SessionsList`).
    - On mount: when `new URLSearchParams(location.search).get("two_factor") === "required"`, call `document.getElementById("two-factor")?.scrollIntoView()` once.
    - Local state: `view: "status" | "password" | "scan" | "codes"`, `purpose: "enable" | "disable" | "codes"`, `password`, `code`, `setup: { uri: string; codes: string[] } | null`, `codes: string[] | null`, `fieldError: { field: "password" | "code"; key: TextKey } | null`, `error: TextKey | null`, `pending`. The URI and the codes live only in this state; `setup` and `codes` become null on "I saved the codes", on Cancel and on unmount. Never log them; never put them in a URL, storage or a toast.
    - `view = "status"`, TOTP off: text `tf_off_text`; for each entry of `requiredBy` an `Alert` with `tf_required_operator` or `tf_required_break_glass`; `Button` `tf_turn_on` → `purpose = "enable"`, `view = "password"`.
    - `view = "status"`, TOTP on: text `tf_on_text`; `tf_codes_left` with `{count}` (or `tf_codes_unknown` when `backupCodesLeft` is null); an `Alert` `tf_codes_few` when `backupCodesLeft !== null && backupCodesLeft <= FEW_BACKUP_CODES`; text `tf_break_glass_note` when `requiredBy` holds `break_glass`; `Button variant="outline"` `tf_new_codes` (`purpose = "codes"`); `Button variant="outline" className="text-destructive"` `tf_turn_off` (`purpose = "disable"`).
    - `view = "password"`: help text `tf_password_help_enable`, `tf_password_help_codes` or `tf_password_help_disable` (by purpose); `Input` `id="tf-password"` `type="password"` `autoComplete="current-password"` with `Label` `password_label`; `Button` `continue` and `Button variant="outline"` `cancel`. Submit by purpose:
      - `enable`: `authClient.twoFactor.enable({ password })` → `data.totpURI` with `totpSecretOf` not null and `data.backupCodes` → `setup = { uri, codes }`, `view = "scan"`; a URI without a secret → `error_generic`.
      - `codes`: `authClient.twoFactor.generateBackupCodes({ password })` → `codes = data.backupCodes`, `view = "codes"`.
      - `disable`: `authClient.twoFactor.disable({ password })` → `toast.success(t("tf_off_toast"))`, reload the status, `view = "status"`.
      - Errors through `accountTwoFactorError` (field `password` → under the input; else the alert line). Always clear the password field after a call.
    - `view = "scan"`: title `tf_scan_title`; text `tf_scan_step_app`; `<TotpQr uri={setup.uri} />`; text `tf_scan_key` and `<code data-totp-secret className="font-mono text-sm break-all">{groupSecret(secret)}</code>`; link `<a href={setup.uri} className="text-sm underline">{t("tf_open_app")}</a>`; text `tf_scan_step_code`; `Input` `id="tf-setup-code"` with `Label` `tf_code_label`, `inputMode="numeric"`, `autoComplete="one-time-code"`; `Button` `tf_verify`; `Button variant="outline"` `cancel` (back to status; the unconfirmed row stays and a later `enable` overwrites it, Fact F2). Submit: `cleanTotpCode` (null → field error `tf_code_invalid_format`), `authClient.twoFactor.verifyTotp({ code })` → `toast.success(t("tf_on_toast"))`, `codes = setup.codes`, `view = "codes"`; errors through `accountTwoFactorError` (field `code`). An error with status 500 (plan D9, fail closed: the enrolment may be stored) → clear `setup`, reload the status, `view = "status"`; when the reloaded status says `enabled: true`, show the alert `tf_on_without_codes` above the buttons until the next "New backup codes".
    - `view = "codes"`: title `tf_codes_title`; text `tf_codes_help`; `<ul data-backup-codes className="grid grid-cols-2 gap-1 font-mono text-sm">` with one `<li>` per code; `Button variant="outline"` `tf_copy` → `navigator.clipboard.writeText(codes.join("\n"))` → `toast.success(t("tf_copied"))`, a rejection → `toast.error(t("tf_copy_failed"))`; `Button` `tf_codes_done` → `codes = null`, `setup = null`, reload the status, `view = "status"`.
    - Every visible string through `t()`; no new shadcn component; no inline style.
  - Keys (English | Polish, D20):

    | Key | English | Polish |
    | --- | --- | --- |
    | `tf_title` | Two-factor sign-in | Logowanie dwuetapowe |
    | `tf_off_text` | Off. Turn it on to ask for a code from an authenticator app at each sign-in. | Wyłączone. Włącz je, aby przy każdym logowaniu podawać kod z aplikacji uwierzytelniającej. |
    | `tf_on_text` | On. Each sign-in asks for a code from your authenticator app. | Włączone. Przy każdym logowaniu podajesz kod z aplikacji uwierzytelniającej. |
    | `tf_required_operator` | Your role needs two-factor sign-in: the operator console opens only with it. | Twoja rola wymaga logowania dwuetapowego: bez niego konsola operatora się nie otworzy. |
    | `tf_required_break_glass` | You are the break-glass owner of your organization: two-factor sign-in must stay on. | Jesteś właścicielem awaryjnym organizacji: logowanie dwuetapowe musi pozostać włączone. |
    | `tf_break_glass_note` | You are the break-glass owner, so you cannot turn it off. | Jesteś właścicielem awaryjnym, więc nie możesz go wyłączyć. |
    | `tf_turn_on` | Turn on | Włącz |
    | `tf_turn_off` | Turn off | Wyłącz |
    | `tf_new_codes` | New backup codes | Nowe kody zapasowe |
    | `tf_codes_left` | Backup codes left: {count} | Pozostałe kody zapasowe: {count} |
    | `tf_codes_unknown` | The number of backup codes left is not known. | Liczba pozostałych kodów zapasowych jest nieznana. |
    | `tf_codes_few` | Few backup codes are left. Make new ones. | Zostało mało kodów zapasowych. Utwórz nowe. |
    | `tf_password_help_enable` | Type your password to start. | Wpisz hasło, aby zacząć. |
    | `tf_password_help_codes` | Type your password. The old backup codes stop working. | Wpisz hasło. Stare kody zapasowe przestaną działać. |
    | `tf_password_help_disable` | Type your password. Sign-in then asks only for the password. | Wpisz hasło. Logowanie będzie wtedy wymagać tylko hasła. |
    | `tf_scan_title` | Connect your authenticator app | Połącz aplikację uwierzytelniającą |
    | `tf_scan_step_app` | Open an authenticator app on your phone, for example Google Authenticator, Microsoft Authenticator or Aegis, and scan this code. | Otwórz aplikację uwierzytelniającą w telefonie, na przykład Google Authenticator, Microsoft Authenticator lub Aegis, i zeskanuj ten kod QR. |
    | `tf_scan_key` | Or type this key in the app: | Albo wpisz w aplikacji ten klucz: |
    | `tf_open_app` | Open in the authenticator app on this device | Otwórz w aplikacji uwierzytelniającej na tym urządzeniu |
    | `tf_scan_step_code` | Then type the 6-digit code that the app shows. | Potem wpisz 6-cyfrowy kod, który pokazuje aplikacja. |
    | `tf_on_toast` | Two-factor sign-in is on. | Logowanie dwuetapowe jest włączone. |
    | `tf_off_toast` | Two-factor sign-in is off. | Logowanie dwuetapowe jest wyłączone. |
    | `tf_codes_title` | Your backup codes | Twoje kody zapasowe |
    | `tf_codes_help` | Each code works once, when you do not have your phone. Keep them in a safe place, for example a password manager. You see them only now. | Każdy kod działa tylko raz i przydaje się, gdy nie masz przy sobie telefonu. Przechowuj je w bezpiecznym miejscu, na przykład w menedżerze haseł. Widzisz je tylko teraz. |
    | `tf_copy` | Copy | Kopiuj |
    | `tf_copied` | Codes copied. | Kody skopiowane. |
    | `tf_copy_failed` | The codes could not be copied. Write them down. | Nie udało się skopiować kodów. Zapisz je. |
    | `tf_codes_done` | I saved the codes | Mam zapisane kody |
    | `tf_on_without_codes` | Two-factor sign-in is on, but your backup codes were not shown. Make new backup codes now. | Logowanie dwuetapowe jest włączone, ale kody zapasowe nie zostały pokazane. Utwórz teraz nowe kody zapasowe. |

    `tf_codes_done` in Polish is the neutral "Mam zapisane kody": `pl.ts` has no first-person past form, which in Polish shows the speaker's gender (default, owner to confirm: questions.md Q9).
  - Decisions: D14, D17, D20, D25.
  - Test: the helpers of stages 09–10 carry the logic; stage 12 drives this section in the browser.
  - Check: `bun run typecheck`; `bun run lint`; `bun run web:build`; `bun test apps/web/src/i18n apps/web/src/lib`.
  - Done when: the build passes; the section has no literal text; the URI and the codes are only in component state (a reviewer can grep the component for `console`, `localStorage`, `sessionStorage` and find none).
  - Out of scope: e2e (stage 12); the security log texts (stage 13).

## Done when

- Step 11.1 is done and committed by explicit paths.
- The web Proof command of `plan.md` for stage 11 (`/tmp/f105-s11`, with `bun run web:build`) prints `PROOF_OK`.
