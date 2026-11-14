# Code patterns — rules for agents and humans

> **Accepted 2026-11-02** (user). Replaces `.ai/AGENT.md` (history: it describes the old `IntegrationFactory` and generic adapters; do not use them).
> Source: `docs/architecture.md` §3–4 and `docs/modules.md` §3. When code and this file disagree, fix one of them in the same commit.

## Layout and borders

- Packages: `@ea/server` (`apps/server`), `@ea/web` (`apps/web`), `@ea/core` (`packages/core`).
- Server code lives in `apps/server/src/modules/<module>/` and `apps/server/src/platform/`. Shared pure code lives in `packages/core/`.
- Real platform paths: `platform/config.ts`, `platform/log.ts`, `platform/http.ts`, `platform/db/`, `platform/llm/`, `platform/crypto.ts`, `platform/errors.ts`, `platform/auth.ts`, `platform/scheduler.ts`, `platform/heartbeat.ts`.
- A module exposes one `index.ts`. Other modules import only from it, never from its inner files. ESLint enforces it (§ Layers and borders).
- Module files: `index.ts` (public API), `service.ts`, `repo.ts` (DB; past about 400 lines a `repo/` folder, one file per aggregate, behind `repo/index.ts`: `actions/repo/`, `mail/repo/`), `routes.ts` (HTTP), `jobs.ts` (workers), `*.test.ts` next to the code.
- `packages/core` has no I/O: no DB, no network, no `process.env`, no imports from `apps/*`.
- Test tools live in `tools/<name>/` (workspace `tools/*`, first: `tools/fake-telegram/`). App code (`apps/*`, `packages/*`) never imports them, and the server image holds only their `package.json`.

## Layers and borders

The server modules sit in layers. `bun run lint` fails on an import that crosses a border the wrong way (`import/no-restricted-paths`, zones generated in `eslint.config.js` from `apps/server/src/modules/layers.json`). The list lives once, in that file; this table repeats it for readers.

| Layer | Modules                                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| roots | the composition roots `apps/server/src/*.ts` (`main.ts`, `web.ts`, `composition.ts`, `retention.ts`) and `apps/server/src/scripts/` |
| 5     | `operator`                                                                                                                          |
| 4     | `reports`, `channels`, `testmail`                                                                                                   |
| 3     | `triage`, `actions`, `delegation`                                                                                                   |
| 2     | `config`, `mail`                                                                                                                    |
| 1     | `audit`, `tenancy`                                                                                                                  |
| base  | `apps/server/src/platform/`, then `packages/core`                                                                                   |

- A module imports only the `index.ts` of a module in a lower layer, or of a module in its own layer when `sameLayerEdges` in `layers.json` names the pair with its reason. Never an inner file (`../mail/repo`), also not for a type, a re-export or an `import()`.
- A module never imports a composition root or a script. `platform` imports no module. `packages/*` import nothing from `apps/*`.
- A reverse need (a lower module must call a higher one) is a hook interface or a parameter in the lower module, filled in a composition root: `DelegationHooks` in `actions/hooks.ts` (write side), the keep rule `PayloadKeepRule` of `clearActionPayloads` that `retention.ts` fills with `isOpenDelegationDraft` of `delegation` (read side). A shared plain shape goes to `packages/core` (`ExpireFilter`).
- A new module: add its folder name to a layer in `layers.json` (the lint stops with "Modules without a layer" until you do).
- A new or removed import between two modules (also a permitted one): run `bun run graph:modules` and commit `docs/diagrams/module-graph.{md,json}`; `layers.test.ts` fails on a stale graph. On a merge or rebase conflict in these two files, run the command again; do not merge them by hand.
- A new same-layer edge: add `{ from, to, why }` to `sameLayerEdges`. It must not close a cycle: the lint stops on a cycle in `sameLayerEdges`, and `apps/server/src/modules/layers.test.ts` fails on a cycle, on an edge that the layers do not permit, and on a stale generated graph.
- Test files (`*.test.ts`, `apps/server/test/`) are outside the borders: they assemble modules like a composition root. The e2e seed scripts in `rootDeepImportExceptions` may import a repository directly; add no other entry without a reason in its `why`.
- The generated graph: `docs/diagrams/module-graph.md`. The reasons for single edges: `docs/modules.md` §2.

## Size and shape

- A source file stays under about 400 lines and holds one aggregate (one table or one closely tied group of tables). A repository that grows past it becomes `repo/<aggregate>.ts` behind the same module `index.ts`.
- Registries over if-chains: action handlers, notice detectors, notice renderers, LLM roles, prompts and jobs are entries in a typed record keyed by the enum. A test checks the record against the enum and, where one exists, the CHECK list of the migration. A new kind is a new entry, not a new `if` or `case` in a shared function.
- A CLI script that reads or writes the DB parses its arguments, loads config and calls a service function of a module index, the same function a route calls (ADR 0023). It does not query a repository directly. A dev tool that touches no DB (`scripts/module-graph.ts`) is outside this rule. Existing scripts change when they are touched.
- Split a file by moves, not rewrites. A repository becomes `repo/<aggregate>.ts` plus `repo/index.ts`, which re-exports by name every export of the old file and nothing else; importers keep `./repo` (it resolves to `repo/index.ts`), so no import path changes. A helper that two files need stays in the file of its topic with an internal export; `repo/shared.ts` holds only what has no topic (`DbOrTrx`, `actionTypeSchema`). Keep `git log --follow` for every new file with the history merge of `spec/features/*/F091-repo-split/tools.md` (`history-copies.sh`: one rename commit per new file, one merge, then the trim commit), and prove the move with its `same-bodies.ts` and `exports-of.ts`. Never rebase or squash such a branch; merge `master` into it. After its land, fix a failed push with `git pull --no-rebase`, not `git pull --rebase` (a rebase replays the copy commits and conflicts).
- A typed record keyed by the enum is the default for a per-kind choice. Where each case is a few lines inside a larger function (`decidePolicy`, `payloadOf`, `phrase`), an exhaustive `switch` with no `default` is allowed: typecheck fails on a missing case, as with a record. A `default` branch or an `if` chain that falls through to one kind is not.

## Add an action type or a draft kind

The types are `actionTypes` in `packages/core/src/triage/planners.ts`; the kinds are `draftKinds` in `packages/core/src/triage/payloads.ts`. Start there; typecheck and two tests then point to most other places. Two tests hold the lists together: `apps/server/src/modules/actions/completeness.test.ts` and `packages/core/src/triage/draft-kinds.test.ts`.

A new action type, in this order:

| #   | Place                                                                                                                                                     | What fails when it is missed                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | `actionTypes` and a `PlannedAction` member (`core/triage/planners.ts`); the planner that emits it                                                         | typecheck in the places below; `completeness.test.ts` case 1                               |
| 2   | `decidePolicy` (`core/triage/policy.ts`); a tool switch in `config` if the user can turn it off                                                           | typecheck (`never` case)                                                                   |
| 3   | The payload: a schema in `core/triage/payloads.ts` if it carries data; `payloadOf` (`triage/service.ts`)                                                  | typecheck (no `default` in `payloadOf`)                                                    |
| 4   | A migration that adds the type to `actions_type_check`, then `bun run db:types`                                                                           | `actions-transitions.test.ts` (the CHECK list equals `actionTypes`)                        |
| 5   | `actions/transitions.ts`: an `ACTION_ENTRIES` row for `createPlanned`, its `ACTION_EDGES`, `WRITER_GUARDS` and `LATENT_EDGES`                             | `completeness.test.ts` cases 3 and 4; `transitions.test.ts`; `actions-transitions.test.ts` |
| 6   | An entry in `APPLY_HANDLERS` (`actions/apply.ts`) with its `needs`; the handler in its own file that imports `./apply-shared`, not `./apply`              | typecheck (`Record<ActionType, ApplyHandler>`); `completeness.test.ts` cases 2 and 6       |
| 7   | `TYPE_RANK` (`actions/repo/claims.ts`); a claim filter if the type has its own scope                                                                      | typecheck (`Record<ActionType, number>`)                                                   |
| 8   | Its line in the digest, the notices and the web activity: `phrase` in `core/digest/would-do.ts`, or `NO_PHRASE` in `completeness.test.ts` with the reason | typecheck (exhaustive `switch`); `completeness.test.ts` case 5                             |
| 9   | A notice for the type, if it has one: § "Notices are facts", checklist "Add a notice kind"                                                                | that checklist's test                                                                      |
| 10  | `docs/capabilities/actions-and-undo.md` § Data (status flow) and `docs/modules.md` §3.5                                                                   | review only                                                                                |

A type that sends mail needs `needs.sender` and an approval record (ADR 0003): the system never sends without one. `completeness.test.ts` case 7 fails until the owner's decision is written into it.

A new draft kind, in this order:

| #   | Place                                                                                                                                                                                                                                                                                                                                     | What fails when it is missed                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `draftKinds` and a `draftPayloadSchema` member (`core/triage/payloads.ts`)                                                                                                                                                                                                                                                                | `draft-kinds.test.ts` case 1; the send schema, `sendKindSchema` (`actions/repo/reads.ts`) and the notice views follow the list                                            |
| 2   | `DRAFT_TEMPLATES` (`core/outgoing/templates.ts`)                                                                                                                                                                                                                                                                                          | typecheck; `draft-kinds.test.ts` case 3                                                                                                                                   |
| 3   | The planner or the job that creates it (`core/triage/planners.ts`, `delegation/chaser.ts`)                                                                                                                                                                                                                                                | its own tests                                                                                                                                                             |
| 4   | The lines that branch on `kind` and fall through to a default: `core/outgoing/message.ts` (quote, `In-Reply-To`), `core/outgoing/sender.ts` (sender label), `core/digest/approvals.ts` (card title), `core/digest/would-do.ts` (`draftPhrase`), `actions/approvals.ts`, `actions/expiry.ts`, `delegation/service.ts`, `channels/notices/` | no test: read each hit of `grep -rnE '(kind\|\.kind) (===\|!==) "(delegation\|clarification\|reminder)"\|"reminder" in' packages/core/src apps/server/src --include=*.ts` |
| 5   | A prompt or model change for it                                                                                                                                                                                                                                                                                                           | `bun run eval` and its go/no-go table                                                                                                                                     |

## Notices are facts

A module that has something to tell a user through the outbox (digests and notices) queues facts. It never builds the text of a channel (ADR 0032 point 5). Direct replies (command answers, tap answers, the link texts, the operator notices) are not outbox rows and keep their texts where they are (`channels/texts.ts`, `callbacks.ts`, `channels/operator.ts`).

- A notice enters the outbox only through `queueNotice` (`apps/server/src/modules/channels/notice-queue.ts`) with `{ userId, locale, kind, view, dedupKey }`. The view is the input of the kind's renderer: ids, counts, dates, and the strings from mail data or from users that the text prints (subject, sender, names). It holds no phrase of ours: a fixed word or sentence comes from the renderer, so a new locale or a new channel changes only the renderer.
- Each kind has a strict view schema (`noticeViewSchemas`, `packages/core/src/notices/views.ts`): no field that the renderer does not print. A view holds mail-derived text: it follows the retention of `outbox.text` (`clearOutboxTexts`, `docs/architecture.md` §7) and never reaches a log line, an error text or a test name.
- `queueNotice` renders the view once as a check. A view that does not render never enters the outbox, and the event gets no row. Where the producer marks its source row (approvals, sets, send results, delegation answers, action failures, digests), the mark is in the same transaction, so it rolls back and the event is tried again. Urgent, `auth_error`, `sync_stale` and `sync_ok` have no mark: the next tick finds the event again and retries through the dedup key.
- The sender renders when it sends: `renderNotice(kind, view, { channel, detail, locale })` from `@ea/core`. `outbox.text` and `outbox.buttons` are the cache of the sent message (null and `[]` until the send). A row whose view does not render becomes `failed` / `bad_view`.
- A row waits up to 24 h in the outbox (the sender fails an older row with `expired`), and newer code may render it. A change of a view schema or of a view field must still accept the views of the rows queued in the last 24 h. If it cannot, the change waits until those rows drain (`deploy/README.md` § Notices as facts). Otherwise every waiting row of the kind becomes `failed` / `bad_view` and the user gets nothing.
- A clock in a view is a fact of the queue time (`now`, `timeZone`): a notice held by the quiet hours prints the same text when it goes out.
- The edit after a tap keeps the stored text of the card and adds one status line (`renderNoticeEdit`); it never renders the card again.
- Texts are `en` today. The row's `locale` comes from `users.locale` (null = `pl`, as the auth mails); a renderer selects the `pl` text when E7-T1 adds it.

### Add a notice kind

1. Core: add the kind to `noticeKinds` (`packages/core/src/notices/kinds.ts`), a strict view schema to `noticeViewSchemas` (`views.ts`) and an entry with a `telegram.full` function to `noticeRenderers` (`renderers.ts`). Unit test: the exact text for one fixed view.
2. Migration: add the kind to `outbox_kind_check` (drop and add the constraint, as `db/migrations/20261111000001_delete_mailbox.sql` does); the `down` part deletes the rows of the kind first. A kind that needs `email_id`, `mailbox_id` or `digest_id` gets that check too.
3. Server: one detector file `apps/server/src/modules/channels/notices/<kind>.ts` that exports a `Detector` listed in `detectors` (`notices/index.ts`), or, for a producer outside the notifier, an entry in `queuedBy`. The producer calls `queueNotice`.
4. Tests: `channels/notices/registry.test.ts` and the `CHECK` test in `apps/server/test/integration/telegram-schema.test.ts` fail until steps 1–3 are complete. Add an integration case in `channels-notices.test.ts`: one row per member, no second row on a second run.
5. Docs: the `outbox` row of `docs/architecture.md` §5 (kind, dedup key) and the `channels` table of `docs/modules.md` §3.8.

## Ports and adapters

- A port (interface) lives in the module that owns it: `MailProvider` in `mail/port.ts`, `ChatChannel` in `channels/port.ts`.
- Each adapter is a folder in its module (`mail/imap/`, `mail/fake/`, `channels/telegram/`). A module builds its adapters from config.
- No central factory, no generic CRUD wrapper, no table names as strings.
- Only `platform/llm/providers/gemini.ts` imports `@google/genai`; only `platform/llm/providers/openai.ts` imports `openai` (ESLint enforces it). The shared client and the registry are in `platform/llm/`. Only `mail/imap/` imports `imapflow` and `mailparser`. Only `mail/imap/` and `platform/auth-mail.ts` (the auth-mail sender, S6b) import `nodemailer`. Only `channels/telegram/` imports `grammy`.

## Data access

- Typed repositories with Kysely. One repository function = one clear query. Column names are snake_case in TypeScript.
- Generated DB types live in `apps/server/src/platform/db/schema.ts`. Never edit this file by hand. Run `bun run db:types` after each migration.
- Every repository function takes a `TenantContext` and filters by `org_id`. A test checks each new function for the filter. Only these take no `TenantContext`:
  - `insertOrganization`, `insertUser`.
  - `listSyncTargets`, `listMailboxTargets` and `countSyncTargets` (`mail/repo/targets.ts`): the sync, triage, committer, returned and chaser jobs list the active mailboxes of all organizations with `listSyncTargets`; the S4 expiry job lists mailboxes of several statuses with `listMailboxTargets`. `listMailboxTargets` skips the mailboxes of `suspended` organizations unless `includeSuspended: true` (only the expiry asks for it); `listSyncTargets` always skips them; `countSyncTargets` counts the same rows (start log line).
  - `listMembershipsOfUser` (`tenancy/repo.ts`, S5a): the user gives the tenant; the web resolves the organization from the session.
  - `getUserAuthProfile`, `setUserTerms`, `setUserLocale` (`tenancy/repo.ts`, S6b): the user gives the row; the web resolves the user from the session.
  - `createLockoutStore` functions (`platform/auth-lockout.ts`, S6b): the user gives the row; the table `auth_lockouts` has no `org_id` and goes with the user by cascade.
  - `listOrganizations` (`tenancy/repo.ts`, S6a): the retention job, the operator job and `org:status` walk all organizations.
  - `listOrgFeatureRowsOfAll` (`tenancy/repo.ts`, F087): `GET /api/operator/flags` lists the flags of every organization. Only routes under `/api/operator`, behind `requireOperator`, call it.
  - `listAuthErrorMailboxesBefore` (`mail/repo/targets.ts`, S6a): the operator job lists mailboxes in `auth_error` for 24 h across organizations; it skips `suspended` organizations.
  - S2, `channels/repo.ts`: `findChatLink` (the chat id gives the tenant), `listLinkedChats` (the notifier and digest jobs read all organizations; it skips `suspended` organizations unless `includeSuspended: true`), `useLinkToken` and `findLinkToken` (the token gives the tenant), `replaceChatLink` (it deletes the old link of a chat across organizations), `claimDueOutbox` (the sender claims rows of all organizations except `suspended` ones; their rows wait).
  - Rule: a job that walks organizations uses `listSyncTargets`, `listMailboxTargets`, `listLinkedChats` or `listOrganizations`, and states whether it runs for `suspended` organizations. The sync, triage and committer loops also check `isOrgSuspended` before each mailbox, so a suspend stops the next mailbox of a running job.
- A new table with `org_id`, in the ticket of its migration: a `tenant filter` test for each new repository function (as in `actions-repo.test.ts` and `delegation-repo.test.ts`); the `tenant_rows` policy in the same migration (copy the block of `db/migrations/20261114100002_rls_tenant_policies.sql`; `rls-policy.test.ts` fails without it) and the table in `TENANT_TABLES` and in its seed (`seedOrg`) of that test; a clear function and a row in `docs/architecture.md` §7 if it holds text; and a row in the organization delete and the DSR address map. The last two do not exist yet (E7-T3 builds them); until then, the migration ticket names the table in its plan so E7-T3 finds it.
- A new security-relevant audit event (sign-in factor, export, delete, DSR) gets an entry in `securityEvents` (`packages/core/src/security-log.ts`) and a `sec_kind_*` text; `security-log-text.test.ts` fails until the text exists.
- A new view bypasses RLS (it runs as its owner): create it `WITH (security_invoker = true)`; no materialized view over tenant tables. `rls-policy.test.ts` checks both.
- A new `SECURITY DEFINER` function bypasses RLS: its first statement refuses another organization when `app_current_org()` is set (as `delete_mailbox` does); `rls-policy.test.ts` checks that each one calls `app_current_org()`.
- RLS (F092) is the second line, never the first: every repository function still filters by `org_id`. Only `platform/db/scoped-driver.ts` writes `app.org_id`. A test sets it only with `set_config('app.org_id', <id>, true)` inside a transaction, never with `SET` or a session-level `set_config`.
- Retention (S6a): the module that owns a text column exports a tenant-scoped clear function for it (`clearMailBodies`, `clearTriageTexts`, `clearActionPayloads`, `clearDelegationTasks`, `clearOutboxTexts` and the others). It works in batches of 1 000 rows by id with `FOR UPDATE SKIP LOCKED`, filters by no mailbox status and no plan, and a repeat run changes nothing. `apps/server/src/retention.ts` calls them for every organization. A new text column gets a clear function and a row in `docs/architecture.md` §7.
- The tables `auth_sessions`, `auth_accounts`, `auth_verifications` and the Better Auth columns of `users` are read and written only by the Better Auth library through `platform/auth.ts`; no repository function touches them. The session list reads `auth_sessions` through `listUserSessions` (`platform/auth.ts`, the Better Auth internal adapter), never with SQL of ours. One exception: `deleteExpiredVerifications` (`platform/auth.ts`) deletes expired `auth_verifications` rows for the retention job, because Better Auth removes an expired row only when it reads one.
- Mail host check (S6b): every IMAP and SMTP connect resolves its host through `resolveMailHost` (`mail/host-guard.ts`) and connects to the checked address. `imapFlowOptions` and `buildSmtpTransportOptions` take the resolved target, so a new connect path cannot skip the check. `main.ts` and every entry script that imports `../modules/mail…` or `../composition` call `configureMailHosts` after `loadConfig`.
- Status changes and their `audit_log` row go in one transaction.
- A function that changes `actions.status` gets a row in `actions/transitions.ts` and a case in `actions-transitions.test.ts`.
- Work items are claimed with `FOR UPDATE SKIP LOCKED`. Conditional updates (`WHERE status = …`) guard every status change.
- Schema changes only through a new dbmate file `db/migrations/YYYYMMDDHHMMSS_<name>.sql` with `-- migrate:up` and `-- migrate:down`. Never edit an applied migration.
- Migrations run as the `migrator` role with `bun run db:migrate`. The server runs as the `app` role.

## Side effects

- Only `actions.committer` changes a mailbox or sends mail. Planners and the policy are pure functions in `packages/core`.
  The exceptions are the test tools that refuse every address except `TEST_MAILBOX_ADDRESS` (`mailbox:seed` with `--folder <path>` to APPEND into another folder, `testmail-target deliver`, `mailbox:probe-move`, `mailbox:probe-send`).
  The committer finds its mailboxes with `listSyncTargets`; it adds no new entry point without a `TenantContext`.
- A mail is located by identity (`locateMessage`), never by `SEARCH HEADER`: Interia finds nothing by `Message-ID`.
- Non-idempotent provider calls (`create_draft`, `send`): commit status `applying` first; add the header `X-EA-Action-Id`.
- `send` is at-most-once: never retry it by itself after SMTP DATA starts (`docs/capabilities/drafts-and-send.md` § Rules).
- Every send passes the send limits (PD-044): `startSendWithinLimits` (`actions/send-limit.ts`) counts the sends of the mailbox under a per-mailbox advisory lock, in the transaction that marks the send `applying`. A held send stays `approved` with `next_attempt_at` at the end of the window and `last_error = send_limit:<kind>`. A new send path (E4 "send all", E5 follow-ups, E6 replies, E9 OAuth mailboxes) goes through the committer and so through this check; it never calls SMTP itself. The limits are env keys (`SEND_LIMIT_*`), not a flag.
- SMTP errors are classified by stage (`SmtpSendError.stage`: `connect`, `login`, `envelope`, `content`, `unknown`). The committer never retries after `content` or `unknown`.
- A recipient comes only from a `delegates` row or from `emails.from_address` (a clarification). Never use LLM text as a recipient.
  The raw message is built only by `buildOutgoingMessage` (`packages/core`) and `composeMessage` (`mail`): the draft and the send share the bytes.
- `actions.payload` is parsed with the core payload schemas (`draftPayloadSchema`, `sendPayloadSchema`), never read as loose JSON.
- A module that `actions` must call back (a delegation changes with a send) gets a hooks interface in `actions` (`DelegationHooks`); `main.ts` wires the implementation. `actions` never imports `delegation`.
- No import cycles between modules: a module sets a column that another module's worker reads (`docs/modules.md` §2).
- The LLM returns data that a Zod schema checks. LLM text is untrusted: never use it as a recipient, a folder name or a command.
- An LLM call names a role: `llm.generate({ role, promptVersion, schema, system, prompt })`. The role table (`llmRoleTable`, `platform/config.ts`) decides provider, model, timeout, rate and effort; code never picks a model. A new role is a row: a name in `packages/core/src/llm-roles.ts`, its `LLM_<ROLE>_*` keys, a prompt entry.
- Every role returns data that a Zod schema checks, also a free-text role (its text is a schema field).
- Prompts live in the registry (`modules/triage/prompts/index.ts`, `prompts`): one entry per role with its version, and one file `<role>-v<n>.ts` per version whose `PROMPT_VERSION` equals the file name. A changed prompt text is a new file and a new version. A role without a prompt is in `rolesWithoutPrompt` with the epic that writes it. The registry test fails on a gap.
- Every LLM call in a job or a request writes one `llm.call` row through `recordLlmCall` (`modules/audit`) with `role` and `prompt_version`; the daily cap and the cost per role read these rows. `llm:check` and `eval` write none.
- A prompt or model change of any role runs the eval gate of PD-025 (`bun run eval`, the go/no-go table) before the merge.
- A new behaviour that a user can see is read through `isFeatureOn`; the flag is in the registry with an owner epic and a remove-by date; default off; the pilot organization turns it on first.
- The registry is `featureFlags` in `packages/core/src/features.ts`. The order is `FEATURES_OFF` (env, the kill switch) → the `org_features` row → the registry default (`resolveFeature`). The kill list comes from `FEATURES_OFF`: `main.ts` sets it with `configureFeatures` after `loadConfig`; any other process reads the env on the first flag read. No read function takes a settings argument; tests change the kill list only with `configureFeatures` and reset it in `afterEach`. A job reads a flag once per mailbox run, not once per mail. Flags are not product settings: the mailbox mode and the per-category `auto` switches stay as they are (ADR 0027 point 6).
- A flag is changed only through `setOrgFeature` (`tenancy`, audit row `org.flag_changed`); the CLI `org:flag` and a later console call it. A unit test fails when a flag is past its remove-by date: then a cleanup ticket removes the key from `FEATURES_OFF` on every server first (an unknown key stops the start), deletes its rows in a migration (`DELETE FROM org_features WHERE flag = '<key>'`), and removes the reads and the registry entry.
- Roll-out: an epic turns its flag on for an organization with `org:flag --on`, the pilot first. A default that changes to `true` reaches only organizations with no row: an earlier `--off` row stays off.

## HTTP routes (S5)

A route file (`routes.ts`) is thin: it parses the body with `parseBody` and a `@ea/core` schema, calls one service or repository function, and maps the result to JSON. No SQL, no business rule, no `org_id` from the request: `requireTenant` sets `ctx` from the session. Every route test covers 401 (no session), 403 (an assistant on an owner route, when the route is owner-only), 404 (another organization's id, when the route takes an id) and 400 (a bad body, `details` without the input). The platform (`platform/http.ts`) imports no module; the composition root (`apps/server/src/web.ts`) wires the module routers. A service that needs another module's write inside its own transaction gets it as an injected hook from the composition root (`removeMailbox.onRemoved`, which queues the owner notice of `channels`), and the onboarding state is injected into `tenancyRoutes` (S5b). A route that needs another module's service gets it as an injected dependency from the composition root: `settingsRoutes` gets the gate (`triage`) and the folder setter (`mail`) through `settingsRouteDeps` in `web.ts` (S5c). `config` reads `mailboxes` for `mailboxInOrg`, as it does for `getMovesSupported`, because it cannot import `mail`.

Every `/api` write (any method except GET, HEAD, OPTIONS) of a `suspended` organization answers `403 org_suspended` through `refuseSuspendedWrites` (`platform/http.ts`). A write that must work in `suspended` goes into `SUSPENDED_WRITE_ALLOW` with a test.

Routes under `/api/operator` are the only web code that reads across organizations (ADR 0027). `createApp` guards the whole prefix with `requireOperator`: only users in `OPERATOR_USER_IDS` pass; every other user, also an owner, gets the same `404 { error: "not_found" }` as an unknown path. The guard runs after `requireTenant`, so the operator is a member of an organization. Mount an operator router at `/operator`. A router never calls `use("*")` when it is mounted at `/`: Hono then runs it for every `/api` path. Every operator route test covers 401 (no session), 404 for an owner who is not an operator, and the operator's answer. `requireTenant` runs the rest of each `/api` request in the tenant scope; `requireOperator` runs operator routes without it. Only `platform/http.ts` and `platform/scheduler.ts` call `withTenantScope` and `withoutTenantScope` (`tenant-scope-sites.test.ts`). Work that a request starts and that outlives it (a timer, a loop, a promise chain), and an object made in a request whose callbacks outlive it (an `EventEmitter`, an IMAP IDLE client, a stream: its callbacks run in the scope of the request), is made in `withoutTenantScope`, or it stays limited to that organization. The `operator` module (layer 5) owns every `/api/operator/*` route. It reads other organizations only through tenant-scoped functions, one organization at a time (it adds no exception to § Data access). Its answers hold ids, codes, counts and dates (ADR 0027 point 3); a route test asserts the key set and that the body holds no name or address. A write calls the CLI's service function with the operator's user id as actor. `POST /api/operator/*` is in `SUSPENDED_WRITE_ALLOW`. The page `/operator` answers non-operators the 404 page (`OPERATOR_PAGE` in `platform/http.ts`); its JS chunk under `/_astro/` stays public, so a page never holds data in its build.

An id in a body or a query that fails the schema is 400. An unknown or foreign id that passes the schema is 404 `{ error: "not_found" }`, with no row written (S5d, B8). The service decides the 404 (`recordWebFeedback`, `undoWithFeedback` return `not_found`), not the route. Telegram and the web call the same service for Undo, so both channels answer alike.

## Config and secrets

- All config comes from env, checked with a Zod schema at start (`platform/config`). A missing key stops the start.
- `.env.example` lists every key with a placeholder. Never commit `.env`, keys, passwords or tokens. Never log them.
- Mailbox secrets are encrypted with `platform/crypto` (AES-256-GCM, key version) before they reach the DB.
- LLM keys: `LLM_PROVIDER` and `*_MODEL_CLASSIFIER` set the classifier; `LLM_<ROLE>_PROVIDER`, `_MODEL`, `_TIMEOUT_MS`, `_RPM`, `_REASONING` set another role; an empty key falls back to the classifier (same provider) or to the provider's keys (`docs/architecture.md` §6.3).

## Logs (ADR 0024)

- A log line is an event: `log.<level>("<event_code>", { <fields> })`. The code is a snake_case literal of at most 64 characters, constant, and names what happened (`auth_mail_failed`). `msg` equals the code. One code for one kind of line.
- Fields come only from `logFieldNames` in `apps/server/src/platform/log-fields.ts`. A value is a number, a boolean, `null`, or a code of at most 64 characters from `A–Z a–z 0–9 _ . : / * -` without `://` (ids and route patterns are codes; the code fields include `provider`, `model` and `role`).
  The writer drops any other field or value and counts it in `dropped_fields`. A line with `dropped_fields` is a bug to fix.
  A change that logs a new field name adds it to the list. The review checks that its values are ids, codes, counts or times.
  The value rule does not stop a secret that looks like a code: never add a field for a token, a password or a key value, and never pass one in a code field.
- Errors: `...errorFields(error)` (name and code). Never `error.message`, a mail text, an address, a URL or a token.
- Context: the scheduler gives every line of a job tick `job` and `run_id` (`runJobTick`). The HTTP layer gives every line of a request `request_id` and sets the `x-request-id` header.
  Per-item ids come from a child logger: `const mailboxLog = log.with({ org_id, mailbox_id })`. Name a child logger `<thing>Log` (the lint finds it by that name).
  Inside a run or a request, never pass `job`, `run_id` or `request_id` by hand (the context value wins and the call value is dropped).
  Only a line outside any context names a job with `job` (`job_scheduled`, `job_skipped`).
  Create a long-lived timer, interval, socket or pool at start, outside any context: it keeps the context it was created in.
- Format: the server prints `json` by default (its config) and the VPS pins `LOG_FORMAT: json` (`deploy/compose.yaml`). `text` prints `[module] event key=value …` (dev, `.env.example`).
  A process that does not load the config (a CLI, a test) prints `text` unless `LOG_FORMAT=json`. Tests run in `text` (the test preload).
- Lint: `no-restricted-syntax` in `eslint.config.js` (`logEventSelectors`) warns on any other log call in `apps/server/src`, and fails in the converted files (`platform/`, `main.ts`).
  E8a converts the modules one by one, moves each to the `error` block, and flips the rest at the end. A new log line in any file is an event from now on.
- `docs/known-alerts.md` keys the entries of event lines by the event code.

## Style

- TypeScript strict. `const` / `let` only, never `var`.
- Template literals for strings with variables, never `+` concatenation.
- Use the `log` util (`platform/log`), never `console.log`. The rules are in § Logs.
- Folder keys in logs and audit rows, never paths from mail data or user input.
- Telegram errors: log only `telegramErrorLabel(error)`. Never log `error.message` of an inner error, `payload` or `description` (they can hold the bot token or message text). Other errors: `errorFields(error)` in an event line, `describeError(error)` only in an old-form line that E8a has not converted yet.
- Errors: throw typed errors (`SoftError` for timeout / 429 / 503 / lost connection, `HardError` for the rest); the job runner decides the retry.
- A comment states the rule in one sentence. If it needs a source, it names an ADR (`ADR 0014`) or a ticket folder path (`spec/features/done/2026-11/F083-…/`). No bare stage or decision codes (`S3`, `D29`, `U11`, `A23`, `F079`): their plan files move, and no reader can resolve them. Fix the codes of a comment when you change its code; no mass edit.

## Web app (`apps/web`)

- Every user-visible string is a key in `apps/web/src/i18n/en.ts` and reaches a component through `t()`. A component never holds a literal text (`react/jsx-no-literals` on the islands and the shell and auth components).
- No inline `<script>` and no hand-written `<style>`: the build hashes the scripts (D5), and styles come from Tailwind classes.
- shadcn components come from the shadcn CLI, never by hand.
- One island per page. The shell is a React component inside the island.
- Data comes from `/api/*` through `lib/api.ts`; only the auth paths (`/api/auth/*`) go through `lib/auth-client.ts`. The request and response shapes are the `@ea/core/web` schemas. The web imports core only through that subpath.
- A form that sits under polling (`useResource` reloads every 30 s) keeps the user's typing with `lib/draft.ts` (`nextDraft`) and the hook `lib/use-draft.ts`: a new server value moves in only while the form has no change.
- The Telegram answer words live in `packages/core/src/digest/answers.ts`. The web keeps its own keys in `en.ts` (every string stays there for S6), and `lib/activity-text.test.ts` ties each key to the core function (S5d, B2). Change a Telegram answer: the test fails until `en.ts` follows.
- A web feature behind a flag reads `me.features` (`/api/me`); the server route checks `isFeatureOn` too and answers 404 when it is off.

## Capability map (PD-009)

- A change that lands a feature or changes behaviour updates `docs/capabilities/<capability>.md` in the same change; once E10a exists, a user-visible change also updates its user doc page (en) (PD-100).
- Behaviour rules go to the capability page, not to `docs/architecture.md`. A plan that names a section of `architecture.md` that now holds a link line writes to the page it links.
- The page template and the index: `docs/capabilities/README.md`; `apps/server/src/capability-map.test.ts` checks paths, scripts and ADR numbers.

## Tests

- `bun run test:unit` and `bun run test:int` run on the local Bun. `bun run test:unit:ci` and `bun run test:int:ci` run on the Bun in `.bun-version`, the version of CI and the server image (`scripts/ci-bun.sh`). A stage proof uses the `:ci` scripts. A test that passes only on the local Bun is a failing test.
- Unit tests stay next to the code. Pure logic in `packages/core`: unit tests without mocks.
- Integration tests live in `apps/server/test/integration/`. Repositories: tests against Postgres in a container (each test in a transaction that rolls back).
- Adapters: contract tests; the fake and the real adapter pass the same suite.
- A prompt or model change runs `bun run eval` and must pass the go/no-go table.
- A test that waits for time-driven code waits for its condition: `waitFor(condition, what)` from `apps/server/test/wait-for.ts` (polls every 25 ms, fails after 5 s). No fixed sleep over 100 ms. A fake that holds a response releases it in its `stop()`.
- No retry in CI, no re-run as a fix, no longer test timeout as a fix for a test that hangs. A retry hides a real race.
- Quarantine: a test that fails twice in CI on `master` without a code change (the test file and the code it tests did not change between the two runs) is quarantined the same day. The coordinator creates a ticket (`limen ticket new "<test> passes on the pinned Bun" --lane planned`) and, in one commit, marks the test `test.skip(…)` with the comment `// Quarantined YYYY-MM-DD: fails in CI without a code change. Fix: spec/features/planned/FNNN-slug/`. A worker never quarantines by itself; it reports the test in its final message.
