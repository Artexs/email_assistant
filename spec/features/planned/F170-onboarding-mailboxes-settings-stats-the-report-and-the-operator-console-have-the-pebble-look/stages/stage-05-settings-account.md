# F170 stage 05 — Settings: account and security

Needs F166 stage 10: `SectionCard` (with `tone="danger"`), `RowList`, `Row`, `FactBox`. May run next to 01, 02, 03, 04, 06, 07, 08, 09, 10 (`SettingsPage.tsx` keeps rendering `<AccountCard />`).

Part of [`../plan.md`](../plan.md). Decisions: D1, D4, D5; questions.md item 5.

Owns: `AccountCard.tsx`, `TwoFactorSection.tsx`, `SecurityLog.tsx`, `DeleteOrganization.tsx`, `TotpQr.tsx` (in `components/settings/`), `account.spec.ts`, `account-delete.spec.ts`, `two-factor.spec.ts`, `alert-layout.spec.ts`, `language.spec.ts`, `docs-links.spec.ts`.

## Step 1 — Three cards from one

- **Interface:** `AccountCard()` returns three `SectionCard`s in this order (a fragment, so the account group of stage 01 needs no change):
  1. `data-card="account"` (icon `UserRound`, title `acct_title`): language, change password, sessions and "sign out everywhere", the legal documents block.
  2. `data-card="security"` (icon `ShieldCheck`, new title key `acct_security_title`, "Security"): the two-factor section (keeps `id="two-factor"` and `data-section="two-factor"`) and, for an owner with `security_log`, the security log.
  3. `data-card="delete-organization"` (`tone="danger"`, icon `TriangleAlert`, title `del_title` or today's heading key): the delete block and its dialog, only on today's condition (owner, flag `org_delete`, has a password).
- **Edge cases:**
  - A member with no password (`hasPassword: false`): card 1 shows `acct_sso_only` and no password form; card 2 shows no two-factor section; with no security log either, card 2 is not rendered (no empty card); card 3 is not rendered.
  - An SSO session: `acct_sso_session` stays in card 1.
  - `?two_factor=required`: the scroll to `#two-factor` still works (its effect stays in `TwoFactorSection`).
  - The focus moves of the two-factor flow (password, scan, codes heading) stay.
- **Test:** (1) render test, a table over three users: owner with password and `org_delete` and `security_log` → `data-card` values `account`, `security`, `delete-organization`; member with password → `account`, `security`; member with `hasPassword: false` and no log → `account` only. (2) e2e `two-factor.spec.ts`: `/settings?two_factor=required` puts `#two-factor` in the viewport; the turn-on flow passes. (3) e2e `account-delete.spec.ts` passes; the delete card has the danger look (the destructive edge class of `SectionCard`).

## Step 2 — Inside the cards

- **Decisions:** the password form fields are labelled 48 px inputs with today's ids (`acct-current`, `acct-new`, `acct-repeat`) and error ids; "Revoke other sessions" is a `Row` with `htmlFor="acct-revoke"`. Each session and each security-log entry is a `Row` (the time in tabular figures as `leading`, the event as the title, the actor as the `hint`). The two-factor status is a `Badge` (on: `default`, off: `secondary`). The backup codes are a monospace grid in a `FactBox`. The QR code keeps its raw colours (the F166 allow-list names `TotpQr.tsx`).
- **Test:** (4) e2e `account.spec.ts` and `language.spec.ts` pass on both projects with their a11y scans. (5) e2e `alert-layout.spec.ts`: the "two-factor required" alerts still fill their box.

## Step 3 — Docs

Update the Account card part of `docs/capabilities/web-panel.md` rule 9 (three cards now) and `apps/docs` how-to `two-factor` (English and Polish): "Settings → Account and security → Security".

## Out of scope

Any auth rule, any two-factor or session API. The sign-in pages (the shell ticket).

## Done when

The pictures of `settings` (main owner, and an organization with `org_delete` and `security_log`) match the mockup's "Security" and "Delete organization" cards; the Proof of `../plan.md` with `account.spec.ts account-delete.spec.ts two-factor.spec.ts alert-layout.spec.ts language.spec.ts docs-links.spec.ts settings.spec.ts` prints `PROOF_OK`.
