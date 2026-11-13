# s6a-customer-core — Stage 15

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A26, A30, A21 (`OPERATOR_CONTACT`) and "Rules for every step" first.

## Stage 15 — Panel server side: `/api/me` plan fields, e2e seed

Two steps. The web uses these fields in stage 16.

- [ ] **15.1 `/api/me` gets the plan, the trial end, the limit and the operator contact**
  - Goal: the panel can show the trial line, the paused banner and the read-only mirror from one request (D3, D4, D29).
  - Files: change `packages/core/src/web/me.ts` (`meSchema`), `packages/core/src/web/me.test.ts`, `apps/server/src/modules/tenancy/routes.ts` (`TenancyRouteDeps.operatorContact`, the `/me` body), `apps/server/src/web.ts` (`apiRouters` passes `operatorContact: config.OPERATOR_CONTACT ?? null`), `apps/server/test/integration/web-me.test.ts`; every test that builds `tenancyRoutes` deps (the compiler finds them) adds `operatorContact: null`.
  - Interfaces:

    ```ts
    // meSchema
    organization: z.object({
      id: z.uuid(), name: z.string(), timezone: z.string(),
      plan: orgPlanSchema, trialEndsAt: z.iso.datetime().nullable(), maxMailboxes: z.number().int().min(0),
    }),
    operatorContact: z.string().nullable(),
    ```

  - Decisions:
    - The route reads `getOrganization` (it returns the new columns) and maps `trial_ends_at?.toISOString() ?? null`.
    - `trialEndsAt` and `maxMailboxes` go to every member (an assistant sees the same organization row; the web shows the trial line to owners only, A27). `operatorContact` is the public env value (D29), not a secret.
    - `GET /api/me` stays a read: a suspended organization gets `200` (stage 8).
  - Test:
    1. `me.test.ts`: a valid `Me` with `plan: "trial"`, a date and `operatorContact: null` parses; `plan: "gold"` fails.
    2. `web-me.test.ts`: an `active` org → `plan: "active"`, `trialEndsAt: null`, `maxMailboxes: 2`; after a SQL update to `trial` with `trial_ends_at = 2026-12-01T00:00:00Z` → those values; `suspended` → `200` with `plan: "suspended"`; with `operatorContact: "ops@example.test"` in the deps → that value.
  - Check: in 15.2.
  - Done when: in 15.2.
  - Out of scope: the web components (stage 16).

- [ ] **15.2 e2e seed: a trial and a paused organization (A30)**
  - Goal: Playwright can sign in as an owner of a `trial` and of a `suspended` organization.
  - Files: change `apps/server/src/scripts/e2e-seed-args.ts` (constants), `apps/server/src/scripts/e2e-seed.ts` (`wipe`, the two orgs, the seed file), `apps/web/e2e/seed.ts` (the `SeedFile` type, if it lives there; grep `SeedFile`), `apps/server/test/integration/e2e-seed.test.ts`.
  - Interfaces:

    ```ts
    export const E2E_TRIAL_ORG_NAME = "E2E Trial";
    export const E2E_TRIAL_OWNER_EMAIL = "e2e-trial-owner@x.test";
    export const E2E_PAUSED_ORG_NAME = "E2E Paused";
    export const E2E_PAUSED_OWNER_EMAIL = "e2e-paused-owner@x.test";
    // SeedFile gets: trialOwner: { userId; email; password; orgId; trialEndsAt: string }, pausedOwner: { userId; email; password; orgId; mailboxId }
    ```

  - Decisions:
    - The trial org: `createOrganizationWithOwner(db, { …, plan: { kind: "trial", endsAt: now + 10 d } })` with `timezone: "Europe/Warsaw"`; the paused org: created `active`, then `setOrgPlan(db, ctx, { plan: "suspended", actor: "e2e-seed", now })` (no hook: the org has no outbox rows). Before the suspend, the paused org gets one mailbox row, so the read-only mirror has controls to check (cold review finding 5): `insertMailbox` (address `e2e-paused-box@x.test`, IMAP and SMTP host `127.0.0.1`, ports 3143 and 3025, `testCapabilities`-like capabilities `{ move: true, uidplus: true, idle: false, condstore: false, specialUse: false, keywords: false }`, `folderMap: { drafts: "Drafts" }`), `insertInboxFolder`, `insertCredentials` (the password `e2e-paused-box-password` encrypted with `createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION)`, `secretKind: "password"`), `insertDefaultSettings` (`config`). No sync reaches it: its organization is suspended. The seed file gets `pausedOwner.mailboxId`. Both owners get the password `E2E_OWNER_PASSWORD` through the same reset-link path as the other users of the seed.
    - `wipe` deletes the two new org names and the two new e-mails too.
    - The existing `E2E` org stays `active` (the default).
    - The log line adds `trial org <id> paused org <id>` (ids only).
  - Test:
    1. `e2e-seed.test.ts`: after the seed, the trial org has `plan = 'trial'` and `trial_ends_at` 10 days ± 1 min ahead; the paused org `plan = 'suspended'` with one mailbox and one `mailbox_settings` row; the E2E org `active`; the seed file holds both new owners; a second seed run does not fail (wipe works).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int && bun run web:build && bun run test:e2e` (all specs still green; the new fields do not break the web).
  - Done when: the checks pass.
  - Out of scope: the Playwright specs of the new states (stage 16).
