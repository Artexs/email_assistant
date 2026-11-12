# s6a-customer-core — Stage 16

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A18 (the error text), A26–A30, S1, S2 and "Rules for every step" first, and `docs/code-patterns.md` § "Web app" (every string in `en.ts`, one island per page, shadcn from the CLI only).

## Stage 16 — Panel web: trial line, paused banner, read-only mirror, consent line, error texts, Playwright

Two steps.

- [ ] **16.1 Shell: trial line and paused banner; consent line; error texts**
  - Goal: owners in `trial` see the end date; every member of a `suspended` organization sees the paused banner with the contact; the connect form shows the consent line; the two new error codes have texts.
  - Files: change `apps/web/src/i18n/en.ts`; create `apps/web/src/components/shell/PausedBanner.tsx`, `apps/web/src/components/shell/TrialLine.tsx`, `apps/web/src/lib/trial-date.ts`, `apps/web/src/lib/trial-date.test.ts`; change `apps/web/src/components/shell/AppShell.tsx` (render both under `AuthErrorBanner`), `apps/web/src/components/mailboxes/ConnectDialog.tsx` (the consent line above the submit button), `apps/web/src/lib/errors.ts`, `apps/web/src/lib/errors.test.ts`.
  - Interfaces:

    ```ts
    // lib/trial-date.ts
    export function trialDateText(iso: string, timeZone: string): string; // Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "long", year: "numeric" })
    // PausedBanner({ contact }: { contact: string | null }); TrialLine({ endsAt, timeZone }: { endsAt: string; timeZone: string })
    ```

  - Decisions:
    - Texts (exact keys and values):
      - `trial_ends_on: "Trial ends on {date}."`
      - `paused_banner: "This account is paused. Contact {contact} to resume it."`
      - `paused_banner_no_contact: "This account is paused. Contact the operator to resume it."`
      - `connect_consent: "Your mail goes to our AI provider to sort it. Nothing in the mailbox changes until you set the mode to assist."` (S1)
      - `err_org_suspended: "This account is paused. Nothing can change now."`
      - `err_mailbox_limit: "Your plan allows no more mailboxes. Remove one, or contact us to raise the limit."`
    - `AppShell` (inside `Frame`): `me?.organization.plan === "suspended"` → `<PausedBanner contact={me.operatorContact} />`; `me?.organization.plan === "trial" && me.role === "owner" && me.organization.trialEndsAt !== null` → `<TrialLine …/>`. The banner uses `role="status"` and the red style family of the existing banners (`border-red-500/50 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100`); the trial line is a muted line (`text-muted-foreground`, `px-4 py-2 text-sm`).
    - `errors.ts`: `org_suspended: "err_org_suspended"`, `mailbox_limit: "err_mailbox_limit"`.
    - The consent line is a `<p className="text-sm text-muted-foreground">` directly above the submit button; it is always visible (not a checkbox: the mode is the consent, D2).
  - Test:
    1. `trial-date.test.ts`: `trialDateText("2026-11-30T23:30:00Z", "Europe/Warsaw")` → `"1 December 2026"` (the zone moves the day); `"2026-11-30T12:00:00Z"`, `"UTC"` → `"30 November 2026"`.
    2. `errors.test.ts`: the two codes map to their keys.
  - Check: in 16.2.
  - Done when: in 16.2.
  - Out of scope: Polish texts (S6c).

- [ ] **16.2 Read-only mirror and Playwright**
  - Goal: in `suspended`, the panel hides or disables every control that would send a write (the server refuses them anyway, stage 8), and Playwright proves both new states.
  - Files: create `apps/web/src/lib/can-write.ts`, `apps/web/src/lib/can-write.test.ts`; change `apps/web/src/islands/{MailboxesPage,OnboardingPage,RulesPage,SettingsPage,ActivityPage}.tsx` and the components that hold a member write: `apps/web/src/components/activity/ActionButtons.tsx` (feedback, Undo), `apps/web/src/components/settings/DigestTimesCard.tsx`, `apps/web/src/components/telegram/TelegramLink.tsx`; create `apps/web/e2e/tests/plan.spec.ts`.
  - Interfaces: `export function canWrite(me: Pick<Me, "organization"> | null): boolean` — `me !== null && me.organization.plan !== "suspended"`.
  - Decisions:
    - Owner controls: each island that computes `isOwner = me?.role === "owner"` (`MailboxesPage.tsx:22`, `OnboardingPage.tsx:21`, `RulesPage.tsx:105`, `SettingsPage.tsx:133`) uses `const isOwner = me?.role === "owner" && canWrite(me)` for the edit rights it passes down, so the existing assistant read-only view applies (the same UI as an assistant). Keep a separate `role` read where a text depends on the role, not on the write right (grep `isOwner` uses in each island and decide per use; log the list).
    - Member writes: `ActionButtons` (✅, ✏️, Undo), `DigestTimesCard` (save) and `TelegramLink` (link, unlink) get a `disabled` (or hidden, where the component hides for assistants today) state from `canWrite(me)`, read through `useMe()`.
    - The connect button on `MailboxesPage` follows `isOwner` (so it is gone in `suspended`).
    - No new API call; `useMe` polls every 30 s, so a resume shows within 30 s.
  - Test:
    1. `can-write.test.ts`: `active` → true; `trial` → true; `suspended` → false; `null` → false.
    2. `plan.spec.ts` (both projects; sign in with `signInAs` from `e2e/helpers.ts`):
       - the trial owner on `/activity` sees `Trial ends on <the seed date formatted for Europe/Warsaw>`; no paused banner; no CSP console error (`cspErrors`).
       - the paused owner on `/activity` sees the paused banner (with the contact when the e2e env sets `OPERATOR_CONTACT`; the spec reads `e2eEnv()` and expects the matching text); on `/mailboxes` the seeded mailbox `e2e-paused-box@x.test` (stage 15.2) is listed, and there is no connect button and no Pause, Change password or Remove control; on `/settings` the mode control and the switches of that mailbox are disabled (or absent, as for an assistant).
       - the paused owner sends a write through the page context (`page.request.patch("/api/me/digest-times", …)` with the origin header) → `403` with `org_suspended`.
       - the paused owner can still sign out (the user menu) and lands on `/login`.
       - the `E2E` owner (active) sees neither line (one check in the spec, so the existing specs need no change).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int && bun run web:build && bun run test:e2e` (all specs).
  - Done when: the checks pass in both Playwright projects.
  - Out of scope: a page for the plan or billing; Polish texts (S6c); the "delete organization" control (S6c).
