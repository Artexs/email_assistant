# F082 stage 04 — `org:invite`, `web:invite` mails or prints, 24 h [risky]

Part of [`../plan.md`](../plan.md). Read its L10, L19, L20, B1 and "Rules for every stage" first, and S6a's `org:create` (`apps/server/src/scripts/org-create.ts`). Needs stages 1–3.

Parallel: lane A, after stage 3. Stage 5 or 6 and stage 8 may run at the same time (this stage changes no file of theirs).

One step.

- [ ] **4.1 One invite delivery for both CLIs; the new `org:invite`**
  - Goal: the operator makes a customer organization with its owner in one command; the setup link goes by mail when the sender is on, else to stdout. `web:invite` sends a new link the same way.
  - Files:
    - add `apps/server/src/scripts/invite-delivery.ts`, `org-invite.ts`, `org-invite-args.ts`, `org-invite-args.test.ts`;
    - change `apps/server/src/scripts/web-invite.ts`;
    - change root `package.json` (`"org:invite": "bun apps/server/src/scripts/org-invite.ts"` in `scripts`; no dependency change);
    - add `apps/server/test/integration/org-invite-cli.test.ts`; add cases to `web-invite-cli.test.ts`.
  - Interfaces:

    ```ts
    // scripts/invite-delivery.ts
    export interface InviteDeliveryInput {
      config: Config; // WEB_BASE_URL and WEB_AUTH_SECRET are checked by the caller
      db: Db;
      orgId: string;
      userId: string;
      email: string;
      locale: UserLocale;
      print: boolean; // --print: print even when the sender is on
      log: ReturnType<typeof createLog>;
    }
    export function deliverInvite(input: InviteDeliveryInput): Promise<number>; // the exit code

    // scripts/org-invite-args.ts
    export const orgInviteUsage =
      "usage: bun run org:invite --org-name <name> --email <email> --display-name <name> [--lang pl|en, default pl] [--timezone <tz, default Europe/Warsaw>] [--trial-days N, default 30] [--print]";
    export interface OrgInviteOptions {
      orgName: string;
      email: string;
      displayName: string;
      locale: UserLocale;
      timezone: string;
      trialDays: number;
      print: boolean;
    }
    export function parseOrgInviteArgs(argv: string[]): OrgInviteOptions | undefined; // undefined = print usage, exit 1
    ```

  - Decisions:
    - `deliverInvite` (L19): `createAuth({ databaseUrl, baseUrl, secret, trustedOrigins: [baseUrl, ...webTrustedOrigins(config)], onEvent: auditWebEvent(db), resetLinkTtlSeconds: 86_400, sendResetPassword: async ({ url }) => { link = url; } })` (stage 7 adds `onTermsAccepted` to this call); `auth.api.requestPasswordReset({ body: { email, redirectTo: \`${baseUrl}/setup\` } })`; no link → `log.error("no link was produced")`, 1. Then `const settings = authMailSettings(config)`:
      - `settings !== null && !print` → `createAuthMailer(settings).send({ kind: "invite", userId, to: email, locale, url: link })`. `ok` → `log.info(\`invite mail sent to user ${userId}\`)`, 0. Not ok → `log.error(\`invite mail failed (${code}): run bun run web:invite --org-id ${orgId} --user-id ${userId} to send the link again\`)`, 1.
      - else → write to stdout the three lines of today's `web-invite.ts` ("Open this link within 24 hours:", the link, "The link works once. …"), 0.
      - `handle.close()` in `finally`. The link never goes to the log.
    - `parseOrgInviteArgs`: `parseArgs` with `strict: true`; `--lang` only `pl` or `en` (default `pl`, B1); `--trial-days` only `^\d+$`, 1–365 (default 30); `--print` boolean; the three required values present.
    - `org-invite.ts` order: parse → `loadConfig` → `WEB_BASE_URL` or `WEB_AUTH_SECRET` empty → the `web-invite.ts` error text, exit 1, nothing created → `assertAppRole` → `createOrganizationWithOwner(db, { orgName, email, displayName, timezone, locale, plan: { kind: "trial", endsAt: new Date(now + trialDays × 86_400_000) } })`; a unique violation (`23505`, the check of `org-create.ts`) → `log.error("user with this email already exists")`, 1 (the transaction rolled back: no organization) → `log.info(\`created org ${orgId} user ${userId} plan trial trial_ends_at ${iso}\`)`→`deliverInvite`. Errors go through `describeError`.
    - `web-invite.ts`: add the boolean `--print` to its usage and options; read `locale` with `getUserAuthProfile` (`?? "pl"`); replace its own link code with `deliverInvite`.
  - Test:
    1. `org-invite-args`: the required three only → `locale "pl"`, `timezone "Europe/Warsaw"`, `trialDays 30`, `print false`; `--lang de`, `--trial-days 0`, `366`, `abc`, a missing `--email`, an unknown flag → `undefined`.
    2. `org-invite-cli` (spawned like `web-invite-cli.test.ts`; env sets `WEB_BASE_URL`, `WEB_AUTH_SECRET` and all six `AUTH_*` keys to `""` unless the test sets them): exit 0; stdout holds one link with `/api/auth/reset-password/` and `callbackURL=` with `%2Fsetup`; the organization has `plan = 'trial'` and `trial_ends_at` within ±1 h of now + 30 days; the user is its `owner` with `locale = 'pl'`; the user's `auth_verifications` row has `expires_at − created_at` between 86 395 and 86 405 s.
    3. With `AUTH_SMTP_HOST` = `TEST_IMAP_HOST ?? "127.0.0.1"`, `AUTH_SMTP_PORT` = `TEST_SMTP_PORT ?? "3025"`, `AUTH_SMTP_USER=auth`, `AUTH_SMTP_PASSWORD=greenmail-test`, `AUTH_MAIL_FROM=noreply@x.test` and `--lang en`: exit 0; stdout holds no `reset-password/`; the GreenMail INBOX of the address has one mail with subject `Your Email Assistant account` (read it as `smtp-send.test.ts` does).
    4. The same keys and `--print` → the link on stdout; the INBOX of the address is empty.
    5. An address that exists → exit 1, stderr holds `user with this email already exists`; no organization with that `--org-name` exists.
    6. `AUTH_SMTP_PORT=1` with the other keys → exit 1; the output holds `invite mail failed (` and `web:invite --org-id <the new org id>`; the organization exists.
    7. `WEB_BASE_URL=""` → exit 1; no organization with that name.
    8. `web-invite-cli`: with the GreenMail keys → exit 0, no link on stdout, one mail in the INBOX; with `--print` → the link on stdout.
    9. In tests 2–8 no stdout or stderr line except the printed link block holds `reset-password/`, and no log line holds the address.
       Each test deletes its organization and user in `afterEach` (the pattern of `web-invite-cli.test.ts`).
  - Check: Proof (server form, `/tmp/f082-s04`).
  - Done when: the tests pass and the Proof printed `PROOF_OK`.
  - Out of scope: the terms field of the reset request (stage 7); a resend button in the panel.
