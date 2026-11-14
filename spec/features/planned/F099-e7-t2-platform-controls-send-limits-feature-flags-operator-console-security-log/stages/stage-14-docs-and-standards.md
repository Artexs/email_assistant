# F099 stage 14 — Docs and standards

Part of [`../plan.md`](../plan.md). Read the whole plan first: this stage writes down what stages 01–13 built. Needs stages 05, 11 and 13 landed (all lanes). Docs only: no code, no test change.

Three steps. About 150 changed lines.

- [ ] **14.1 Standards: `docs/code-patterns.md` and the styleguide**
  - Goal: later epics follow the send-limit, operator and security-log rules without reading this plan.
  - Files: change `docs/code-patterns.md`, `.agents/limen/styleguide.md`.
  - Text to add (adapt the wording to the file's style; keep every rule):
    - § Side effects, after the `send` at-most-once bullets: "Every send passes the send limits (PD-044): `startSendWithinLimits` (`actions/send-limit.ts`) counts the sends of the mailbox under a per-mailbox advisory lock, in the transaction that marks the send `applying`. A held send stays `approved` with `next_attempt_at` at the end of the window and `last_error = send_limit:<kind>`. A new send path (E4 "send all", E5 follow-ups, E6 replies, E9 OAuth mailboxes) goes through the committer and so through this check; it never calls SMTP itself. The limits are env keys (`SEND_LIMIT_*`), not a flag."
    - § HTTP routes, the operator paragraph: "The `operator` module (layer 5) owns every `/api/operator/*` route. It reads other organizations only through tenant-scoped functions, one organization at a time (it adds no exception to § Data access). Its answers hold ids, codes, counts and dates (ADR 0027 point 3); a route test asserts the key set and that the body holds no name or address. A write calls the CLI's service function with the operator's user id as actor. `POST /api/operator/*` is in `SUSPENDED_WRITE_ALLOW`. The page `/operator` answers non-operators the 404 page (`OPERATOR_PAGE` in `platform/http.ts`)."
    - § Data access, the bullet "A new table with `org_id`": add "A new security-relevant audit event (sign-in factor, export, delete, DSR) gets an entry in `securityEvents` (`packages/core/src/security-log.ts`) and a `sec_kind_*` text; `security-log-text.test.ts` fails until the text exists."
    - § Web app: "A web feature behind a flag reads `me.features` (`/api/me`); the server route checks `isFeatureOn` too and answers 404 when it is off."
    - § Layers and borders: the table already has layer 5 (stage 06); check it.
    - Styleguide § Prefer: one line each for the send-limit rule and the operator-module rule; § Shape: `operator` in the layer list (stage 06 did it; check it).
  - Decisions: D6, D13–D16, D20–D23, D25.
  - Check: `bunx prettier --check docs/code-patterns.md .agents/limen/styleguide.md`; the styleguide stays under 1000 lines (`wc -l`).
  - Done when: the five rules are in the files.
  - Out of scope: rewording other sections.

- [ ] **14.2 Architecture, modules, ADR 0027**
  - Goal: the reference docs describe the new parts.
  - Files: change `docs/architecture.md`, `docs/modules.md`, `docs/decisions/0027-operator-role-and-feature-flags.md`.
  - Text to add:
    - `docs/architecture.md` §4.1 (the send rules near rule 6): the send limits, the count (statuses of plan D4), the lock, the hold, the 48 h approval clock (D8), the soft cap from the tap (D9). §5 (data model): `actions.send_started_at` (stage 05 already added the `send_held` outbox row; check it). §7 (security and privacy): the operator console shows ids, codes, counts and dates; the security log shows names of members, no addresses. §8 (operations): the operator notice `send_limit`.
    - `docs/modules.md`: a new §3.12 `operator` (what it owns: the routes of D16, `listOperatorOrgs`, `getOperatorOrg`, `listOperatorNotices`, `changeOrgPlan`, `changeOrgFlag`; which modules it reads); §3.1 `tenancy`: "Built in F099: `listSecurityLog`, `GET /api/security-log`, `/api/me` `operator` and `features`; `operatorRoutes` moved to `operator`"; §3.5 `actions`: "Built in F099: `send-limit.ts`, `send_started_at`, `listRecentSends`, `lockMailboxSends`, `listSendLimitHolds`, `countFailedSendsSince`, `lastSendAppliedAt`"; §3.6 `audit`: `listAuditEvents`, `sumLlmCallsByModelSince`, `action.send_limited`; §3.8 `channels`: the operator notice `send_limit`, `countFailedOutboxSince`, `lastOutboxSentAt`; §3.10 HTTP API: the new routes; §4 web pages: `/operator`.
    - ADR 0027 status line: "Landed by F087 (flags, operator check, `GET /api/operator/flags`) and F099 (the `operator` module, the console page and routes, `/api/me` features). Open: TOTP for the operator (E7-T6), SSO provider setup (E7-T7)."
  - Check: `bunx prettier --check docs/architecture.md docs/modules.md docs/decisions/0027-operator-role-and-feature-flags.md`.
  - Done when: each named section has its line.
  - Out of scope: other ADRs.

- [ ] **14.3 Operator runbook: `deploy/README.md`, the capability page**
  - Goal: the operator knows the keys, the console and what a send-limit notice means.
  - Files: change `deploy/README.md`; change `docs/capabilities/` only if the folder exists (E1 builds it): the row or page of platform controls gets "send limits, operator console, security log (flag)".
  - Text to add in `deploy/README.md`:
    - § Approvals and sends, a new `### Send limits`: the three keys and defaults; what a hold looks like (panel "approved, waiting: send limit", Telegram `send_held`, operator notice `send_limit`); how to raise a limit (set the key in `.env`, restart; a held send goes out at its next claim after the window); never set a limit above the provider's limit (Exchange Online 30 per minute and 10 000 recipients a day; Gmail 2 000 a day, 500 for a trial; E07 discovery notes W11, W12).
    - § Customers (S6a), a new `### Operator console`: `OPERATOR_USER_IDS` (the user id from `bun run org:status` output or `SELECT id FROM users WHERE email = …` on the server; a user id is not a secret, but keep it out of the repo); the page `/operator`; what each block shows; plan and flag changes write the same audit rows as `org:plan` and `org:flag`; the operator must be a member of an organization.
    - § Customers (S6a), a line for `security_log`: `bun run org:flag --org-id <id> --flag security_log --on`.
  - Check: `bunx prettier --check deploy/README.md`.
  - Done when: the three parts are in the file.
  - Out of scope: the VPS run (stage 15).

## Done when

- Steps 14.1–14.3 are done and committed by explicit paths.
- The docs-stage Proof command of `plan.md` for stage 14 (`/tmp/f099-s14`, `<files>` = the files you changed) prints `PROOF_OK`.
