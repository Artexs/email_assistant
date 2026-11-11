# s5c-web-settings-rules — Stage 9

Part of [`../s5c-web-settings-rules.md`](../s5c-web-settings-rules.md). Read that file's "Done when", "Owns", S1–S11, "Facts checked", B1–B16, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 9 — Settings page part 2: Digest times, Signature, Timezone, Account [risky]

Two steps. `[risky]`: the Account card changes the password and ends sessions (auth); the signature goes into mail to third parties.

- [ ] **9.1 Digest times, Signature, Timezone (S2, S6, S7, U8, B9–B12)**
  - Goal: a member sets their own digest times; the owner sets the signature and the timezone; an assistant sees the last two read-only.
  - Files: create `apps/web/src/components/settings/DigestTimesCard.tsx`, `SignatureCard.tsx`, `TimezoneCard.tsx`; change `apps/web/src/islands/SettingsPage.tsx`.
  - Interfaces:

    ```ts
    export function DigestTimesCard(props: { times: string[]; timeZone: string; onSaved(): void }): JSX.Element; // times from useMe().me.digestTimes
    export function SignatureCard(props: {
      organization: OrganizationSettings;
      isOwner: boolean;
      onSaved(view: OrganizationView): void;
    }): JSX.Element;
    export function TimezoneCard(props: {
      organization: OrganizationSettings;
      isOwner: boolean;
      onSaved(view: OrganizationView): void;
    }): JSX.Element;
    ```

  - Decisions:
    - The general section follows the mailbox section under the heading `set_section_general` (S3); it loads `GET /api/organization` with `organizationSettingsSchema` (`useResource`, default polling); `set_owner_only` shows at its top for an assistant (the Digest times and Account cards stay editable, S2). The section shows also when the organization has no mailbox.
    - Every text form keeps its value with `startDraft` / `nextDraft` (stage 7): a poll never overwrites what the user types; after a save `startDraft(saved)`.
    - `onSaved(view)` of the Signature and Timezone cards: the page calls `organization.mutate({ ...organization.data, ...view })` (the stage 8 `mutate` with its sequence guard), so `tz_current`, the save-button rule and the drafts read the new value at once and a poll that started before the save cannot bring the old one back (cold review finding 8); then `useMe().reload()` (the shell's timezone). `tz_current` and the "selection equals current" rule read the organization resource, not a copy.
    - The cards carry `data-card` = `digest`, `signature`, `timezone`, `account` (stage 11 scopes its clicks with them).
    - `DigestTimesCard`: title `digest_title`; `digest_help` with `{ timezone }`; one row per time: `<Input type="time" step={60}>` with the label `digest_time_label` (`{ n }`, visually hidden or as `aria-label`) and an icon button `digest_remove` (`aria-label`); `digest_add` adds an empty row (disabled at 6, `MAX_DIGEST_TIMES` from `@ea/core/web`); no rows → `digest_none`; `digest_new_time_note` muted; `save` → validate with `digestTimesBodySchema` (skip empty rows first) → issues map to `time_invalid` / `times_too_many` / `times_duplicate` under the list → `PATCH /api/me/digest-times` → toast `digest_saved_toast`, `onSaved()` (the page calls `useMe().reload()`), the rows show the sorted answer.
    - `SignatureCard` (S6): title `sig_title`; `sig_help`; `Textarea` (`id`, `Label` `sig_label`, `rows={4}`, `maxLength` not set: the counter shows the overflow) with the draft of `organization.styleText ?? ""`; `sig_counter` with the length of `normalizeStyleText(value)`; `save` (owner only; disabled while pending or not dirty) → `styleTextSchema` in the browser (issues `style_too_long` / `style_bad_char` under the field) → `PATCH /api/organization { styleText: value }` (the schema turns `""` into `null`) → toast `sig_saved_toast`. For an assistant the `Textarea` is `readOnly` and the button hidden. The text renders only as a field value (React escapes it).
    - `TimezoneCard` (S7, B10): title `tz_title`; `tz_current` with the zone; the search `Input` (`tz_search_label`) and a native `<select id="timezone" size={8}>` (`Label` `tz_list_label`, Tailwind classes like the shadcn `Input`: border, rounded, `w-full`, `text-sm`) with the options of `filterTimeZones(organization.timezones, query, current)`; none → `tz_no_match`; the selected value starts at the current zone; `save` (owner; disabled while the selection equals the current zone) → `PATCH /api/organization { timezone }` → toast `tz_saved_toast` with `{ timezone }`, `onSaved` (the page calls `useMe().reload()`, so every time on the page follows); a 400 with `details[0].message === "timezone_invalid"` → the inline text `timezone_invalid`. `tz_note` under it (U8, fact 3) and `retention_line` with `{ days: retentionDays }` (read-only). For an assistant: the search and the select are disabled, no button. No dialog (U5).
    - `jsx-a11y`: the native select has a label; no `onChange` without a value.
  - Test: no unit test (components; the helpers are tested in stage 7). Hand check as in stage 8 (the worktree dev server, a `web:invite` login): add 08:00 and 13:30, save, reload the page (the times stay); type a signature of two lines, wait 35 s (one poll), the text stays, save; search `new york`, pick `America/New_York`, save, the shell times change; set `Europe/Warsaw` back; 400 px and 1280 px; zero console or CSP errors.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && cd apps/web && bun run build`, then the hand check.
  - Done when: the build and the hand check pass.
  - Out of scope: the Account card (9.2).

- [ ] **9.2 Account: change password, sign out everywhere (S9, B13)**
  - Goal: a member changes their password (other sessions end by default) and can end every session.
  - Files: create `apps/web/src/components/settings/AccountCard.tsx`, `apps/web/src/lib/password-errors.ts`, `password-errors.test.ts`; change `apps/web/src/islands/SettingsPage.tsx`.
  - Interfaces:

    ```ts
    // lib/password-errors.ts
    export type ChangePasswordError = { field: "current" | "password" | null; key: TextKey };
    export function changePasswordError(
      error: { status?: number; code?: string } | null | undefined
    ): ChangePasswordError | null;
    // components/settings/AccountCard.tsx
    export function AccountCard(): JSX.Element;
    ```

  - Decisions:
    - Fields (`autoComplete`: `current-password`, `new-password`, `new-password`): `acct_current_label`, `new_password_label` (with `password_help`), `repeat_password_label`; the `Switch` `acct_revoke_others` (on by default, with a `Label`); the button `acct_change` (`acct_changing` while pending). Validate with `changePasswordFormSchema` (B1) and show the issue keys inline (`fieldErrors`).
    - Submit: `const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions })`. `changePasswordError`: `code === "INVALID_PASSWORD"` → `{ field: "current", key: "acct_wrong_current" }`; `PASSWORD_TOO_SHORT` → `{ field: "password", key: "password_too_short" }`; `PASSWORD_TOO_LONG` → `{ field: "password", key: "password_too_long" }`; `status === 429` → `{ field: null, key: "error_too_many" }`; any other error → `{ field: null, key: "error_generic" }`; no error → `null`. Success → toast `acct_changed_others_toast` (switch on) or `acct_changed_toast`; clear the three fields. A thrown error (network) → `error_generic`. Never log or toast a password.
    - `acct_sign_out_all` (`variant="outline"`, destructive text color) with `acct_sign_out_all_help`: `await authClient.revokeSessions()` then `location.assign("/login")` (also when the call fails: the session may be gone; the login page shows the state). No dialog (U5 lists none).
    - The audit row of a change comes from the S5a hook (`web.password_changed`); "Sign out everywhere" writes none (B13).
    - The card shows for every member (S2), last on the page (S3).
  - Test (unit, `password-errors.test.ts`): each mapping above, also `{ status: 400, code: "INVALID_PASSWORD" }` and `{ status: 429 }`; `null` → `null`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && cd apps/web && bun run build`; a hand check: a second user from `web:invite` (an assistant), two browser contexts signed in as that user; in one, a wrong current password → the inline text; the right one with the switch on → the toast, and the other context's next `/api/me` answers 401; sign in again with the new password; "Sign out everywhere" → `/login`, and `/api/me` with the old cookie answers 401. Use a fresh `x-forwarded-for` per context if the rate limit (5 per 60 s on `/change-password`) hits.
  - Done when: the tests and the hand check pass; one `web.password_changed` audit row per successful change (check with a `SELECT event, actor FROM audit_log WHERE event LIKE 'web.%' ORDER BY id DESC LIMIT 5` on the worktree database).
  - Out of scope: a session list (`web-public-hardening.md`).
