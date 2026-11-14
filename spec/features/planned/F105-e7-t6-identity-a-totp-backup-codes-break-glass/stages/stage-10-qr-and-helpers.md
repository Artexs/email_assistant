# F105 stage 10 — QR and setup helpers

Part of [`../plan.md`](../plan.md). Read its D17, D19, D20, "Facts checked" F2, F7, F11 and "Rules for every stage" first. Lane C. Needs stage 09 (`lib/two-factor-errors.ts` and the keys `tf_error_code`, `tf_error_state`). Web only: it may run next to the server stages 03–08.

**This stage changes `bun.lock`: no other `bun.lock` change of any ticket may be in build next to it** (the Astro 7 ticket F101 changes it too).

Two steps. About 220 changed lines (plus `bun.lock`).

- [ ] **10.1 The `uqr` dependency and the setup helpers**
  - Goal: the web can turn the `otpauth` URI into a QR drawing and a readable key, with tested pure functions.
  - Files: change `apps/web/package.json` and `bun.lock` (run `bun add uqr@0.1.3 --exact` inside `apps/web`; check that `package.json` holds `"uqr": "0.1.3"` without `^`); add `apps/web/src/lib/totp-setup.ts` and `apps/web/src/lib/totp-setup.test.ts`.
  - Interfaces:

    ```ts
    // lib/totp-setup.ts — pure; uqr is the only import besides types
    import { encode } from "uqr";

    // otpauth://totp/<label>?secret=<base32>&… → the secret, or null when the URI is not a TOTP URI with a base32 secret.
    export function totpSecretOf(uri: string): string | null; // protocol "otpauth:", host/path starts with "totp", secret matches /^[A-Z2-7]+=*$/
    // "ABCDEFGH…" → "ABCD EFGH …" (groups of 4, one space between)
    export function groupSecret(secret: string): string;
    // One SVG path of the dark modules; each run of dark modules in a row is one rectangle "M<x> <y>h<n>v1h-<n>z".
    export function qrPath(text: string): { size: number; d: string }; // encode(text, { ecc: "M", border: 2 })
    ```

  - Decisions: D17, D19.
  - Test (`totp-setup.test.ts`):
    1. `totpSecretOf("otpauth://totp/Email%20Assistant:a%40x.test?secret=JBSWY3DPEHPK3PXP&issuer=Email%20Assistant&digits=6&period=30")` = `"JBSWY3DPEHPK3PXP"`; `"https://x.test/?secret=JBSW"`, `"otpauth://hotp/A?secret=JBSW"`, `"otpauth://totp/A"`, `"otpauth://totp/A?secret=jbsw!!"`, `"not a url"` → null.
    2. `groupSecret("ABCDEFGHIJ")` = `"ABCD EFGH IJ"`; `groupSecret("")` = `""`.
    3. `qrPath` of the 152-character text `otpauth://totp/Email%20Assistant:owner%40x.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP12345&issuer=Email%20Assistant&digits=6&period=30`: `size` = 53 (Fact F11: version 8, 49 modules, at ecc M plus a border of 2 on each side), `d` starts with `M`, and every rectangle lies inside `0…size`; the same text gives the same `d` twice.
    4. The number of dark cells drawn by `d` (sum of the `h<n>` runs) equals the count of `true` cells of `encode(text, { ecc: "M", border: 2 }).data`.
  - Check: `bun test apps/web/src/lib/totp-setup.test.ts`; `bun run typecheck`.
  - Done when: tests 1–4 pass and `bun install --frozen-lockfile` passes with the new lockfile.
  - Out of scope: the component (10.2), the section (stage 11).

- [ ] **10.2 The QR component and the error map of the Account section**
  - Goal: one component draws the QR code, and one tested helper maps every error of enable, verify, disable and new codes to a field and a text.
  - Files: add `apps/web/src/components/settings/TotpQr.tsx`; change `apps/web/src/lib/two-factor-errors.ts` and its test; change `apps/web/src/i18n/en.ts` (and `pl.ts` if it exists, D20).
  - Interfaces:

    ```tsx
    // components/settings/TotpQr.tsx — no dangerouslySetInnerHTML, no inline style
    export function TotpQr({ uri }: { uri: string }) {
      const { size, d } = useMemo(() => qrPath(uri), [uri]);
      return (
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t("tf_qr_label")} shapeRendering="crispEdges"
             className="h-48 w-48 rounded-md bg-white p-0" data-qr="totp">
          <path d={d} fill="#000" />
        </svg>
      );
    }
    ```

    ```ts
    // lib/two-factor-errors.ts (add)
    export interface AccountTwoFactorError { field: "password" | "code" | null; key: TextKey }
    export function accountTwoFactorError(error: { status?: number; code?: string } | null | undefined): AccountTwoFactorError | null;
    ```

    `accountTwoFactorError` table (first match wins):

    | Error | field | key |
    | --- | --- | --- |
    | null or undefined | (returns null) | — |
    | `status` 429 | null | `error_too_many` |
    | `code` `INVALID_PASSWORD` | password | `tf_error_password` |
    | `code` `INVALID_CODE` | code | `tf_error_code` |
    | `code` `BREAK_GLASS_NEEDS_TWO_FACTOR` | null | `tf_error_break_glass` |
    | `code` `TOTP_ALREADY_ENABLED`, `TWO_FACTOR_NOT_ENABLED`, `TOTP_NOT_ENABLED` | null | `tf_error_state` |
    | any other | null | `error_generic` |

    Keys (English | Polish):

    | Key | English | Polish |
    | --- | --- | --- |
    | `tf_qr_label` | QR code for your authenticator app | Kod QR dla aplikacji uwierzytelniającej |
    | `tf_error_password` | Wrong password. | Błędne hasło. |
    | `tf_error_break_glass` | You are the break-glass owner of your organization, so two-factor sign-in stays on. Ask the operator to choose another break-glass owner first. | Jesteś właścicielem awaryjnym organizacji, więc logowanie dwuetapowe zostaje włączone. Najpierw poproś operatora o wybranie innego właściciela awaryjnego. |

    `tf_error_code` and `tf_error_state` come from stage 09. No `SESSION_NOT_FRESH` row and no text for it: `/two-factor/disable` does not ask for a fresh session (plan F7, D28).
  - Decisions: D17, D20.
  - Test (`two-factor-errors.test.ts`):
    5. Each row of the table gives its field and key; `INVALID_PASSWORD` with status 400 gives the password field.
  - Check: `bun test apps/web/src/lib`; `bun run typecheck`; `bun run lint`; `bun run web:build`.
  - Done when: test 5 passes and the build passes (the `uqr` import works in the client bundle).
  - Out of scope: the section that uses them (stage 11).

## Done when

- Steps 10.1 and 10.2 are done and committed by explicit paths (`apps/web/package.json`, `bun.lock` and the new files).
- The web Proof command of `plan.md` for stage 10 (`/tmp/f105-s10`, with `bun run web:build`) prints `PROOF_OK`.
