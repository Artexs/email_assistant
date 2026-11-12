# F082 stage 12 — Terms dialog after sign-in

Part of [`../plan.md`](../plan.md). Read its L15, L17, L18 and "Rules for every stage" (the Playwright rules) first. Needs stages 7 (`/api/me` terms, `POST /api/me/terms`) and 11 (`lib/legal.ts`).

Parallel: lane C, after stage 11. Stage 13 may run at the same time.

Two steps.

- [ ] **12.1 The dialog**
  - Goal: a user whose accepted terms are older than `TERMS_VERSION` (or missing) cannot use the panel until they accept; they can log out instead.
  - Files: add `apps/web/src/components/shell/TermsDialog.tsx`; change `apps/web/src/components/shell/AppShell.tsx`, `apps/web/src/i18n/en.ts`.
  - Interfaces:

    ```tsx
    export function TermsDialog(props: { current: string; onAccepted: () => void; onLogOut: () => void }): JSX.Element;
    // AppShell Frame, after the banners:
    // {me !== null && !me.terms.accepted && <TermsDialog current={me.terms.current} onAccepted={reload} onLogOut={onLogOut} />}
    ```

  - Decisions (L17):
    - `Dialog` from `components/ui/dialog.tsx` with `open` always `true` and `onOpenChange` that does nothing; `DialogContent` with `showCloseButton={false}`, and `onEscapeKeyDown`, `onPointerDownOutside`, `onInteractOutside` that call `event.preventDefault()`.
    - Content: `DialogTitle` `terms_dialog_title`; text `terms_dialog_text`; the three links of stage 11 (`legalPath(legalLang(navigator.language), doc)`, new tab); buttons `terms_dialog_accept` (pending: `terms_dialog_accepting`) and `log_out` (variant `outline`).
    - Accept: `await api("/api/me/terms", z.undefined(), { method: "POST", body: { version: current } })` (the 204 returns `undefined`); success → `onAccepted()`. An `ApiError` with code `terms_outdated` → `location.reload()` (the page has an old build). Else the alert `error_generic` inside the dialog.
    - `en.ts` keys (exact): `terms_dialog_title: "Accept the terms"`, `terms_dialog_text: "Before you go on, read the terms of service, the privacy policy and the data processing agreement, then accept them."`, `terms_dialog_accept: "I accept"`, `terms_dialog_accepting: "Saving…"`.
  - Test: none in unit (the logic is in the server, stage 7); 12.2 tests it in the browser.
  - Check: `bun run web:build`.
  - Done when: the build passes.
  - Out of scope: a diff of what changed in the terms.

- [ ] **12.2 Seed users and Playwright**
  - Goal: the browser test sees the dialog for a user with old terms, and no dialog for every other seeded user.
  - Files: change `apps/server/src/scripts/e2e-seed-args.ts` (`E2E_TERMS_EMAILS`, `SeedFile.termsOwners`), `apps/server/src/scripts/e2e-seed.ts`, `apps/server/test/integration/e2e-seed.test.ts`; add `apps/web/e2e/tests/terms.spec.ts`.
  - Decisions:
    - `E2E_TERMS_EMAILS: Record<E2eProject, string>` = `e2e-terms-mobile@x.test`, `e2e-terms-desktop@x.test`. For each project the seed makes an own organization `E2E Terms <project>` with that owner (`createOrganizationWithOwner`), sets the password through the reset with `termsVersion` (as for the other users), then `setUserTerms(db, userId, "2000-01-01", new Date())`. `SeedFile.termsOwners: Record<E2eProject, { userId: string; email: string; password: string }>`. The wipe list of the seed gets the two addresses.
    - Every other seeded user has `terms_version = TERMS_VERSION` (from the reset, stage 7), so no other spec sees the dialog.
  - Test:
    1. `e2e-seed.test.ts`: after a seed run, the two terms owners have `terms_version = '2000-01-01'`; the main owner has `TERMS_VERSION`.
    2. `terms.spec`: sign in as `termsOwners[project]` → the dialog with `terms_dialog_title` shows; `Escape` does not close it; a click outside does not close it.
    3. Click `terms_dialog_accept` → the dialog closes; reload → no dialog; `GET /api/me` (through `page.request`) has `terms.accepted === true`.
    4. Sign in as the main owner → no dialog.
    5. In the dialog, `log_out` → `/login`.
       Order: test 5 runs before test 3 (it needs the dialog), so use `test.describe.configure({ mode: "serial" })`.
  - Check: Proof (web form, `/tmp/f082-s12`, specs `terms.spec.ts auth.spec.ts account.spec.ts`).
  - Done when: the Proof printed `PROOF_OK`.
  - Out of scope: a dialog for the Telegram consent (S6c).
