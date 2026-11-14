# F098 stage 03 — The language choice

Part of [`../plan.md`](../plan.md). Decisions: P1, P2, P3, D1, D3, D8. Needs stage 02 landed. Lands on the worker's proof. Three steps.

After this stage the Account card has a language select. The choice is stored in `users.locale`, the panel switches at once, and the panel takes the stored choice after every sign-in on any device. Telegram reads the same column (it switches to Polish texts in stage 08); the auth mails read it already.

## Step 1 — `user.locale` in `/api/me` and `PATCH /api/me/locale`

**Goal.** The server returns and stores the choice (D8).

**Files.** `packages/core/src/web/me.ts` (the schema and `localeBodySchema`), `apps/server/src/modules/tenancy/{repo,routes,index}.ts`, `apps/server/src/platform/http.ts` (`SUSPENDED_WRITE_ALLOW`), `docs/code-patterns.md` (the list of user-scoped tenancy functions that take no `TenantContext`: add `setUserLocale` next to `getUserAuthProfile`; `grep -n "getUserAuthProfile" docs/code-patterns.md` finds the list). New test: `apps/server/test/integration/web-locale.test.ts`. Tests that build a `Me` object fail `bun run typecheck` until they get `locale`: add `locale: null` there and nothing else (`apps/server/test/integration/telegram-helpers.ts`, `web-onboarding.test.ts`, and any other file the typecheck lists).

**Interfaces.**

```ts
// packages/core/src/web/me.ts
user: z.object({ id: z.uuid(), email: z.string(), displayName: z.string(), locale: z.enum(userLocales).nullable() }),
export const localeBodySchema = z.object({ locale: z.enum(userLocales) });
export type LocaleBody = z.infer<typeof localeBodySchema>;

// apps/server/src/modules/tenancy/repo.ts — user-scoped, like getUserAuthProfile.
// false: no such user.
export async function setUserLocale(db: DbOrTrx, userId: string, locale: UserLocale): Promise<boolean>;
```

- `GET /me`: `user.locale = profile?.locale ?? null` (the route reads `getUserAuthProfile` already).
- `PATCH /me/locale` in `tenancyRoutes`: `parseBody(c, localeBodySchema)` → `setUserLocale(deps.db, c.get("session").userId, body.locale)` → `false` gives 404 `not_found`, else 204. No `requireOwner`; no audit row.
- `SUSPENDED_WRITE_ALLOW` gets `{ method: "PATCH", path: /^\/api\/me\/locale$/ }`; extend the comment above the list: the language, like the terms, changes no mail and no organization data.
- `apps/server/test/integration/web-suspended.test.ts` lists every write route and fails on a new one: add `"PATCH /api/me/locale"` to `WRITE_ROUTES` (keep the sort order) and to `ALLOWED_WHEN_SUSPENDED`, and change the count in its comment ("The 18 write routes" → 19).

**Decisions.** D8, P3.

**Test.** `web-locale.test.ts` (the setup pattern of `web-me.test.ts`: `webOrg`, `webTestApp`, `as(cookie, …)`; clean up in `afterEach`):

1. No session: `PATCH /api/me/locale` → 401.
2. Body `{ locale: "de" }` → 400; body `{}` → 400; the stored value is unchanged (null).
3. Owner, body `{ locale: "en" }` → 204; `users.locale` of the owner is `'en'`; `GET /api/me` → `user.locale === "en"`; `getUserAuthProfile(db, ownerId)` → `locale: "en"` (the auth mails read this: Done when 5).
4. Then `{ locale: "pl" }` → 204 and `'pl'`. The same call again → 204, still `'pl'`.
5. An assistant of the same organization sets `{ locale: "en" }` → 204; the owner's value is unchanged.
6. A user of a suspended organization (set `organizations.plan = 'suspended'` as `web-terms.test.ts:323` does) → 204 and the value is stored; in the same setup a `PATCH /api/me/digest-times` still answers 403 `org_suspended` (the allow entry is exact).
7. A fresh user with a null locale: `GET /api/me` → `user.locale === null`.

**Check.** `bun test apps/server/test/integration/web-locale.test.ts apps/server/test/integration/web-me.test.ts apps/server/test/integration/web-suspended.test.ts`; `bun run typecheck`.

**Done when.** Tests 1–7 pass; `web-me.test.ts` and `web-suspended.test.ts` pass.

**Out of scope.** Telegram (stage 08). Any audit row.

## Step 2 — The panel takes the stored choice

**Goal.** After a sign-in, the panel follows `users.locale`, else the browser (P1, D1).

**Files.** `apps/web/src/components/shell/AppShell.tsx` (or `MeProvider.tsx`; the place where `me` is first known), web test fixtures that build a `Me` (`bun run typecheck` lists them; add `locale: null`).

**Interfaces.** In `Frame` of `AppShell`:

```ts
const userLocale = me?.user.locale;
useEffect(() => {
  if (userLocale === undefined) return;
  setLocale(resolveLocale(userLocale, navigator.language));
}, [userLocale]);
```

`setLocale` is a no-op when the locale is the same (stage 01), so the 30-second `/api/me` poll costs nothing. The island re-renders through `useLocale()` (stage 01, D3).

**Decisions.** P1, D1, D3.

**Test.** Covered by step 3 (Playwright).

**Check.** `bun run typecheck`; `bun run lint`.

**Done when.** Step 3 passes.

**Out of scope.** Public pages (they keep the stored value of stage 01).

## Step 3 — The select in the Account card

**Goal.** The user chooses the language (P3).

**Files.** `apps/web/src/components/settings/AccountCard.tsx`, `apps/web/src/i18n/{en,pl}.ts`, `apps/web/src/i18n/i18n.test.ts` (`SAME_IN_BOTH` gets the two option keys), `apps/web/src/lib/settings-api.ts` (or a new `lib/locale-api.ts`: one function `saveLocale(locale)` that calls `api("/api/me/locale", z.undefined(), { method: "PATCH", body: { locale } })`; follow how `lib/api.ts` sends a body), new `apps/web/e2e/tests/language.spec.ts`.

**Interfaces.**

- New keys (en / pl): `acct_language_label` "Language" / "Język"; `acct_language_help` "For this panel, Telegram and the account e-mails." / "Dla panelu, Telegrama i e-maili o koncie."; `acct_language_pl` "Polski" / "Polski"; `acct_language_en` "English" / "English"; `acct_language_saved` "Language saved." / "Zapisano język.".
- A block at the top of the card's content: `Label` + the `Select` of `components/ui/select.tsx` with the two options, `value = getLocale()` (read through `useLocale()`), `disabled` while saving. On a change: `await saveLocale(value)`; on success `setLocale(value)`, `reload()` of `useMe()`, `toast.success(t("acct_language_saved"))` (the toast shows in the new language); on an error `toast.error(t(errorText(error)))` and the select keeps the old value.
- A paused organization may change the language (step 1), so the select does not use `canWrite`.

**Decisions.** P3, D3.

**Test.** `language.spec.ts` (English browser, address block `onMobile ? 30 : 130`, `cspErrors` empty in `afterEach`), signed in as `readSeed().members[project]`:

1. Open `/settings`; the Account card title is `en.acct_title`. Type `marker-f098` into the field labelled `en.acct_current_label` (do not submit).
2. Choose `Polski`: the card title becomes `pl.acct_title`, the page heading becomes `pl.title_settings`, `document.documentElement.lang` is `"pl"`, and the password field still holds `marker-f098` (Not verified 3 of `plan.md`).
3. Reload: the heading is still `pl.title_settings`.
4. Choose `English`: the heading is `en.title_settings`.
5. `afterEach`: `page.request.patch("/api/me/locale", { data: { locale: "en" } })`, so a failed run leaves the user English (an English browser shows English for `en` and for null alike).

**Check.** The e2e run of the Proof.

**Done when.** `language.spec.ts` passes in both projects; every other spec passes.

**Out of scope.** A "browser language" option (P3).

## Stage done when

- Steps 1–3 are done.
- The Proof chain for page stages in `plan.md` § Proof (with `NN` = 03) prints `PROOF_OK`.
