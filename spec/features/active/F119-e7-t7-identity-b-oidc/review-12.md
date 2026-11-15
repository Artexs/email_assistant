# F119 stage 12 review notes (Opus PASS, candidate dffb76d4)

Review result: PASS, no blocking finding, 3 test gaps, 7 notes, 1 unverified item. The follow-up commit (this job) closes TG1–TG3, N1, N2 and N5; it fixes N6 and records the rest.

## Test gaps (closed)

- TG1: `lib/login-sso-wiring.test.tsx` renders `LoginPage` with `initialOptions={{ sso: true }}` and a stub address bar. Hostile `?next=` values (`//evil.test`, `https://evil.test`, `/\evil.test`, `javascript:`) reach `SsoSignIn` as `/`. Mutation own-a2 (raw `?next=`) fails it.
- TG2: the same file renders `?sso=failed&error=<hostile>` and `error_description`: only the fixed generic text shows. Mutation own-b (render `get("error")`) fails it.
- TG3: `lib/sso-view.test.tsx` renders the open form (label, `autoComplete="email"`, `role="alert"` and `aria-describedby` on an error, disabled buttons while pending, the Back button). `lib/sso-form.test.ts` tests the form state, including the focus requests. The tests sit in `apps/web/src/lib` because `test:unit` skips `components/`. No DOM library exists in the repo (no new dependency), so the effect that calls `focus()` is not run by a test; the state that asks for it is.

## Fixed

- N1: the `login_sso_error_off` row of `stages/stage-12-login-page.md` now says "w Twojej organizacji" (repo style: Twój is capital mid-sentence).
- N2 (a), (b): `login_sso_error_rate` pl is "Zbyt wiele prób. Poczekaj minutę i spróbuj ponownie." and en is "Too many attempts. Wait a minute and try again." (same as `error_too_many`). `login_sso_error_generic` pl is "Logowanie kontem firmowym nie powiodło się. Spróbuj ponownie albo napisz do operatora." The stage table has the same texts.
- N5: "Back to password sign-in" returns the focus to the "Sign in with your company account" button (form state `focus: "button"`, applied by an effect).
- N6: `SsoSignIn` listens to `pageshow`; with `event.persisted` it ends the running request, so the buttons are not stuck after Back from the IdP. The password flow of `LoginPage` has the same pattern and stays as it is (out of scope).

## Notes kept

- N3 redirect safety, proven by probe (`/tmp/f119-s12-review/probe.log`): `safeNextPath` and `isSafeSsoUrl` refuse the hostile forms. The https check accepts any `https:` URL by design (the URL comes from our own same-origin POST answer; the operator sets the provider). The server refuses a foreign `callbackURL` itself (`web-sso-plugin.test.ts` test 14).
- N4: a bare `?error=x` without `sso=failed` also shows the generic SSO text. It is fixed text, harmless. The fixed `errorCallbackURL` (`/login?sso=failed`) drops the person's `next` after a failed return; the stage asks for it.
- N7, N8: worker mutations m1–m7 and reviewer mutations A1 (equivalent), A2, B, C, C2 are in `/tmp/f119-s12/` and `/tmp/f119-s12-review/`.
- A small design change for the tests: `LoginPage` takes an optional `initialOptions` prop (Astro passes none) and reads the callback error at the first render. `SsoSignIn` is split into the pure `SsoView` and the state in `lib/sso-form.ts`.

## Unverified

- U1: no axe test covers `/login`. Carry-over added to `stages/stage-14-docs.md` (no F119 stage owns e2e or axe).
- U2: no browser frames were seen.
