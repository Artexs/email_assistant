# F119 stage 12 — Account card and console block

Part of [`../plan.md`](../plan.md). Needs stage 10. May run next to stage 11 (both add keys to `en.ts` and `pl.ts`: on a land conflict, merge `master` and prove again).

## Step 12.1 — Account card for a member without a password

**Goal.** A member who signs in only by SSO sees no control that needs a password (D14).

**Files.** `apps/web/src/components/settings/AccountCard.tsx` (and the sections it holds), `en.ts`, `pl.ts`.

**Interfaces.** `/api/me` `hasPassword` and `signInMethod` (stage 10).
- `hasPassword: false` → hide "Change password", the two-factor section and the delete block; show `acct_sso_only`. Language, sessions and "sign out everywhere" stay.
- `signInMethod: "sso"` and `hasPassword: true` → everything stays; add `acct_sso_session` under the sessions list.

## Step 12.2 — Operator console SSO block

**Files.** `apps/web/src/islands/OperatorPage.tsx` (or its organization detail component), `en.ts`, `pl.ts`.

**Interfaces.** `operatorOrgDetailSchema.sso` (stage 10). `null` → `op_sso_none`. Else one block: domain, proof (`op_sso_proof_dns`, `op_sso_proof_attested`, `op_sso_proof_none`), required yes or no, linked members (a plural with `tp()`), break-glass ready or missing. Read-only; the block says `op_sso_cli` (writes go through `org:sso`).

**Decisions.** D14. Texts word for word; informal "ty"; at most one colon per line.

| Key | en | pl |
| --- | -- | -- |
| `acct_sso_only` | You sign in with your company account. Password, two-factor sign-in and the delete controls are for members with a password. | Logujesz się kontem firmowym. Hasło, logowanie dwuetapowe i usuwanie organizacji są dla członków z hasłem. |
| `acct_sso_session` | This session came from your company account. It ends after 12 hours. | Ta sesja pochodzi z konta firmowego. Kończy się po 12 godzinach. |
| `op_sso_title` | Company sign-in (SSO) | Logowanie kontem firmowym (SSO) |
| `op_sso_none` | No provider. | Brak dostawcy. |
| `op_sso_domain` | Domain | Domena |
| `op_sso_proof_dns` | proved by DNS | potwierdzona przez DNS |
| `op_sso_proof_attested` | attested by the operator | potwierdzona przez operatora |
| `op_sso_proof_none` | not proved | niepotwierdzona |
| `op_sso_required` | SSO required | Wymagane SSO |
| `op_sso_break_glass_ready` | Break-glass owner ready | Właściciel awaryjny gotowy |
| `op_sso_break_glass_missing` | No break-glass owner with TOTP | Brak właściciela awaryjnego z TOTP |
| `op_sso_cli` | Change it with bun run org:sso. | Zmienisz to poleceniem bun run org:sso. |
| `op_sso_linked` (plural) | one: {count} linked member · other: {count} linked members | one: {count} połączony członek · few: {count} połączonych członków · many: {count} połączonych członków |

**Test** (`apps/web/src/i18n/*.test.ts`, the web unit tests of the Account card and the operator page that exist; a pure helper with its own test where a component has none):

1. Account sections: `hasPassword: false` → no password, two-factor or delete section, `acct_sso_only` shown; `true` with `signInMethod: "sso"` → all sections plus `acct_sso_session`.
2. Console block: `sso: null` → `op_sso_none`; `{ domain: "x.test", proof: "attested", required: true, linkedMembers: 2, breakGlassReady: false }` → the domain, `op_sso_proof_attested`, required yes, "2 linked members", `op_sso_break_glass_missing`.
3. `i18n.test.ts`: no Polish text equals its English text; placeholders match; the plural has one, few, many.

**Check.** The web Proof of `plan.md` (`/tmp/f119-s12`).

**Done when.** The three tests pass; `bun run web:build` passes; Proof prints `PROOF_OK`.

**Out of scope.** Writes from the console; a members page; the security-log kinds (stage 10).
