# F119 stage 11 — Read surfaces and security-log kinds

Part of [`../plan.md`](../plan.md). Needs stages 09 and 10. Server, core and the `sec_kind_*` texts; the web stages 12 and 13 use these schemas.

## Step 11.1 — `GET /api/sign-in-options`

**Goal.** The login page shows company sign-in only when it can work (D14, Q6).

**Files.** `platform/http.ts` (mount before the session guard, like `/api/auth/*`), tenancy repo, `@ea/core/web` schema file `sso.ts` (stage 03).

**Interfaces.**
- `signInOptionsSchema = z.strictObject({ sso: z.boolean() })`.
- `anySsoUsable(db): Promise<boolean>` — true when one provider is proved and its organization has `sso_sign_in` on (row or default, not killed). No tenant scope. No session needed; `GET` only; `Cache-Control: no-store`; no organization id, domain or count in the answer.
- A failing read answers `{ sso: false }` and `log.warn("sign_in_options_failed", { ...errorFields(error) })` (the password form still works).

## Step 11.2 — `/api/me` fields

**Interfaces.** `meSchema` gets `signInMethod: z.enum(["password", "sso"])` (from `WebSession`, stage 05) and `hasPassword: z.boolean()` (a `credential` row in `auth_accounts` for the user; a tenancy repo read, listed as a Better Auth table read for stage 14). Every fake and test of `/api/me` gets both.

## Step 11.3 — Operator detail

**Interfaces.** `operatorOrgDetailSchema` gets `sso: z.strictObject({ domain: z.string(), proof: z.enum(["dns", "attested"]).nullable(), required: z.boolean(), linkedMembers: z.number().int(), breakGlassReady: z.boolean() }).nullable()` from `getSsoState` (stage 07). No issuer URL, client id, secret or member id (PD-047: ids, codes, counts, dates; the domain is the organization's own). The console page renders it in stage 13; until then the page ignores the field.

## Step 11.4 — Security-log kinds and their texts

**Files.** `packages/core/src/security-log.ts`, `apps/web/src/i18n/en.ts`, `pl.ts` (texts word for word, informal "ty"; for `sec_help` keep the start and change only the end).

**Interfaces.** `securityEvents` and `securityEventKinds` get: `sso.login` → `sso_sign_in`; `sso.refused` → `sso_refused`; `sso.provider_set` → `sso_provider_set`; `sso.provider_removed` → `sso_provider_removed`; `sso.domain_verified` → `sso_domain_verified`; `sso.domain_attested` → `sso_domain_attested`; `sso.required_changed` → `sso_required_changed`; `sso.unlinked` → `sso_unlinked`; `org.member_added` → `member_added`; `web.member_sessions_ended` → `member_sessions_ended`. `sec_help` names company sign-in.

| Key | en | pl |
| --- | -- | -- |
| `sec_kind_sso_sign_in` | Signed in with the company account | Zalogowano kontem firmowym |
| `sec_kind_sso_refused` | Company sign-in refused | Odmowa logowania kontem firmowym |
| `sec_kind_sso_provider_set` | Company sign-in set up or changed | Ustawiono lub zmieniono logowanie kontem firmowym |
| `sec_kind_sso_provider_removed` | Company sign-in removed | Usunięto logowanie kontem firmowym |
| `sec_kind_sso_domain_verified` | Domain proved by DNS | Domenę potwierdzono przez DNS |
| `sec_kind_sso_domain_attested` | Domain attested by the operator | Domenę potwierdził operator |
| `sec_kind_sso_required_changed` | "SSO required" changed | Zmieniono wymóg SSO |
| `sec_kind_sso_unlinked` | Company account unlinked | Odłączono konto firmowe |
| `sec_kind_member_added` | Member added | Dodano członka |
| `sec_kind_member_sessions_ended` | A member's sessions ended | Zakończono sesje członka |
| `sec_help` (new end) | … data requests and company sign-in changes of this organization from the last 90 days. | … wnioski o dane i zmiany logowania kontem firmowym tej organizacji z ostatnich 90 dni. |

**Decisions.** D12, D13, D14.

**Test** (`web-sign-in-options.test.ts` new, `web-me.test.ts`, `web-operator.test.ts`, `packages/core/src/security-log.test.ts`, `i18n.test.ts`):

1. No provider: `GET /api/sign-in-options` without a cookie → 200 `{ "sso": false }`, `Cache-Control: no-store`.
2. A provider unproved: `false`. Proved, flag off: `false`. Proved, flag on: `true`. `FEATURES_OFF=sso_sign_in`: `false`.
3. `POST /api/sign-in-options`: 404.
4. The read throws (a fake): `{ "sso": false }` and one warn line.
5. `/api/me` for Ann with an SSO session and no password: `signInMethod: "sso"`, `hasPassword: false`; Olaf with a password session: `"password"`, `true`.
6. Operator detail of org A with a proved provider and Olaf ready: the `sso` object with `proof: "dns"`, `required: false`, `linkedMembers: 1`, `breakGlassReady: true`; org B without a provider: `sso: null`. The JSON has no `issuer`, `clientId` or `clientSecret` key.
7. Every new audit code maps to its kind; every kind is in `securityEventKinds` and has a `sec_kind_*` key in `en.ts` and `pl.ts`; no Polish text equals its English text.
8. The security log of org A after one SSO sign-in and one refusal lists `sso_sign_in` and `sso_refused`.

**Check.** The web Proof of `plan.md` (`/tmp/f119-s11`).

**Done when.** The eight tests pass; Proof prints `PROOF_OK`.

**Out of scope.** Every page and component change (stages 12, 13).
