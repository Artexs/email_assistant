# s5b-web-mailboxes-onboarding — Stage 7

Part of [`../s5b-web-mailboxes-onboarding.md`](../s5b-web-mailboxes-onboarding.md). Read that file's "Done when", "Owns", S1–S12, "Facts checked", B1–B17, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 7 — Composition and the config key; `GET /api/mailboxes`, pause, resume and remove routes [risky]

One step. After it, the running server serves the mailbox list, pause, resume, remove and the Telegram routes; connect and password come in stage 8.

- [ ] **7.1 `WEB_MAIL_ALLOW_LOCAL`, `web.ts`, `main.ts`, `mail/views.ts`, `mail/routes.ts` (part 1) (B3, B4, B8, B10, B11)**
  - Goal: the web composition gets the mail and Telegram parts; the list shows the B3 badges; pause, resume and remove work over HTTP for the owner only.
  - Files: change `apps/server/src/platform/config.ts` (key, helper), `config.test.ts`, `.env.example`, `apps/server/src/web.ts`, `apps/server/src/main.ts`, `mail/index.ts`; create `apps/server/src/modules/mail/views.ts`, `apps/server/src/modules/mail/routes.ts`, `apps/server/test/integration/web-mailboxes.test.ts`, `apps/server/src/modules/mail/views.test.ts`; change `test/integration/web-me.test.ts` (line ~166) and `web-http.test.ts` (lines ~399, ~455): they call `webDeps(config, db)`, which now needs `extras`: pass `{ secrets: createSecretBox(randomBytes(32).toString("base64"), 1), botUsername: null }` (cold review finding 15).
  - Interfaces:

    ```ts
    // platform/config.ts
    WEB_MAIL_ALLOW_LOCAL: z.preprocess(emptyAsUndefined, z.enum(["true", "false"]).default("false")),
    export function webMailAllowLocal(config: Config): boolean; // === "true"
    // mail/views.ts
    export async function listMailboxViews(db: Db, ctx: TenantContext, env: ScopeEnv): Promise<MailboxView[]>;
    export async function getMailboxView(db: Db, ctx: TenantContext, mailboxId: string, env: ScopeEnv): Promise<MailboxView | undefined>;
    // mail/routes.ts
    export const WEB_MAIL_TIMEOUTS = { socketMs: 20_000, deadlineMs: 25_000 } as const; // B5
    export interface MailRouteDeps {
      db: Db;
      now(): Date;
      scopeEnv: ScopeEnv;
      connect: ConnectDeps;      // with timeouts: WEB_MAIL_TIMEOUTS (stage 8 uses it)
      allowLocalHosts: boolean;  // stage 8
      onRemoved: RemoveDeps["onRemoved"];
    }
    export function mailRoutes(deps: MailRouteDeps): Hono<ApiEnv>;
    // web.ts
    export interface WebExtras { secrets: SecretBox; botUsername: (() => Promise<string>) | null }
    export function webDeps(config: Config, db: Db, extras: WebExtras): WebRuntime | null;
    export function scopeEnvOf(config: Config): ScopeEnv; // the three env values + TEST_MAILBOX_ADDRESS ?? null
    ```

  - Decisions:
    - `.env.example` after `WEB_DIST`: `# true = the web connect form may name localhost or a private-network IP (dev with GreenMail, e2e). Keep false on a server.` and `WEB_MAIL_ALLOW_LOCAL=`. `webDeps` logs `warn` `web: WEB_MAIL_ALLOW_LOCAL=true: the connect form accepts local hosts` once when on.
    - `views.ts`: `listMailboxes` (order `created_at, id`), then per row `getMailboxSettings` (`mode`, `null` when no row), `getMovesSupported`, `getCredentials` (only `secret_kind` goes into the view: `secretKind`; a missing row → `"password"`), and `mailboxScopeBadges(env, address)`; the view maps `status_changed_at` → `statusChangedAt` and so on (B2 names). A few mailboxes per organization: the per-row reads are fine (no N+1 concern at this size; note it in a comment).
    - `mail/routes.ts` imports `./repo`, `./status`, `./remove`, `./views`, `./connect` and the platform; never `./index` (a cycle). Owner routes mount `requireOwner` per route (`app.post("/mailboxes/:id/pause", requireOwner, …)`).
    - `:id`: `z.uuid().safeParse(c.req.param("id"))` fails → 404 `{ error: "not_found" }` with no database call (a bad id is an unknown id, the S2 rule).
    - `GET /mailboxes` (member) → 200 `listMailboxViews(…)`.
    - `POST /mailboxes/:id/pause` and `/resume` (owner) → `switchMailboxStatus(db, ctx, id, { to, actor: userId, via: "web", now })`: `changed` or `already` → 200 `getMailboxView`; `auth_error` → 409 `{ error: "wrong_status" }`; `not_found` → 404.
    - `DELETE /mailboxes/:id` (owner) → `parseBody(c, removeMailboxBodySchema)` → `removeMailbox({ db, onRemoved }, ctx, id, { userId, confirmAddress, now })`: `removed` → `c.body(null, 204)`; `not_found` → 404; `confirm_mismatch` → 400 `{ error: "confirm_mismatch" }`.
    - `web.ts` routers: `tenancyRoutes(…)` (unchanged until stage 9), `mailRoutes({ db, now, scopeEnv: scopeEnvOf(config), connect: { db, secrets, openProvider: openImapProvider, verifySmtp: verifySmtpLogin, timeouts: WEB_MAIL_TIMEOUTS }, allowLocalHosts: webMailAllowLocal(config), onRemoved: queueMailboxRemovedNotices })`, `channelRoutes({ db, now, botUsername: extras.botUsername })`. The composition root may import several modules (the S5a pattern of `auditWebEvent`).
    - `main.ts` order (fact 7): `secrets`, the jobs, the Telegram block (the runtime is built without a network call; `startPolling` stays where it is), then `const web = webDeps(config, db, { secrets, botUsername: telegram ? () => telegram.botUsername() : null })`, `createApp`, `Bun.serve` (unchanged options), `log.info("listening …")`. `shutdown` is unchanged (it reads `server` and `web`, which still exist before any signal can arrive: `process.on` stays at the end).
  - Test (`web-mailboxes.test.ts`, `webTestApp` + `webOrg` of stage 6; mailboxes through `insertMailbox` + `insertInboxFolder` + `insertDefaultSettings`; `scopeEnv = { triage: "all", actions: "synthetic", send: "off", testMailboxAddress: <M1's address in upper case> }`):
    1. Matrix for each route: no cookie → 401; the assistant on pause, resume, delete → 403 `owner_only`; `GET` as the assistant → 200; another organization's mailbox id → 404 (pause, resume, delete); `"not-a-uuid"` → 404; delete with `{}` → 400 `validation` with `details[0].path` `confirmAddress`; delete without `Origin` → 403 `bad_origin`.
    2. `GET` → two views in creation order; `mailboxListSchema` parses; M1 badges triage `{ on, test_mailbox_only }`, actions `{ synthetic, synthetic_only }`, send `{ off, env_off }`; M2 triage `{ off, other_mailbox }`; `mode` `"shadow"`; `lastSyncedAt` null.
    3. Pause M1 → 200 view with `status: "paused"`; the audit row has `data { mailbox_id, via: "web" }` and `actor` = the owner; pause again → 200, still one audit row; resume → `active`.
    4. M2 in `auth_error` (`setMailboxStatus`) → pause → 409 `wrong_status`.
    5. Delete M1 with `{ confirmAddress: " <M1 in upper case> " }` → 204, empty body; `GET` → only M2; a linked owner (`linkChat`) has one `mailbox_removed` outbox row; delete again → 404.
    6. Delete with the wrong address → 400 `confirm_mismatch`; the mailbox is still listed and still `active` (the mismatch check comes before the pause).
       6a. Drift guard (`views.test.ts`, unit; B3, finding 13): for each pair of `ACTIONS_SCOPE` / `SEND_SCOPE` value and address (the test mailbox, another mailbox, upper case), `mailboxScopeBadges(env, address).actions.state === "on"` exactly when `claimFilterFor(scope, address).kind === "all"`, `"synthetic"` exactly when it is `"synthetic"`; `send.state` `on` / `self` exactly when `sendFilterFor` gives `all` / `self`.
    7. `config.test.ts`: `WEB_MAIL_ALLOW_LOCAL` empty → `"false"` and `webMailAllowLocal` false; `"true"` → true; `"yes"` → the config refuses it.
    8. Server start (Check, by hand): `WEB_BASE_URL= bun run dev` still logs `web is off (WEB_BASE_URL is empty)`; with the worktree's web keys `bun run dev` logs `web is on`, and `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/mailboxes` → 401; stop it with Ctrl-C (SIGINT) within a few seconds.
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`, then the hand check of test 8.
  - Done when: the tests pass; `main.ts` builds `webDeps` after the Telegram block; `grep -n "sql\`\|selectFrom" apps/server/src/modules/mail/routes.ts` finds nothing (thin routes, D8).
  - Out of scope: `POST /mailboxes` and `/password` (stage 8), `/api/me` (stage 9).
