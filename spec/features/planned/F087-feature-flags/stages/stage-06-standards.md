# F087 stage 05 — Standards and docs

Part of [`../plan.md`](../plan.md). Read its D6, D8, D9, D11, D15–D18, "Differences found at collect" and "Rules for every stage" first. Needs stages 1–4 landed and the owner's go at checkpoint 1. Docs only: no code change.

Two steps. About 80 changed lines. Write in the style of the file you change (short sentences, active voice, plain technical English).

- [ ] **5.1 The flag standard and the operator rule in the rule files**
  - Goal: every later planning session and worker reads that a new user-visible behaviour ships behind a flag, how a flag is added and removed, and how an operator route is guarded.
  - Files:
    - change `docs/code-patterns.md` (§ Side effects, § HTTP routes);
    - change `.agents/limen/styleguide.md` (§ Shape, § Prefer, § Avoid);
    - change `docs/known-alerts.md` (two entries, newest first, after `## Template` and its `---`).
  - Text to add (adapt only the wording around it; keep the facts). If F086 already wrote a flag line or a "new table" checklist, merge into it, do not repeat it.
    - `docs/code-patterns.md` § Side effects, new bullets at the end:
      - "A new behaviour that a user can see is read through `isFeatureOn`; the flag is in the registry with an owner epic and a remove-by date; default off; the pilot organization turns it on first." (D6, word for word.)
      - "The registry is `featureFlags` in `packages/core/src/features.ts`. The order is `FEATURES_OFF` (env, the kill switch) → the `org_features` row → the registry default (`resolveFeature`). `main.ts` and every entry script that reads a flag call `configureFeatures` after `loadConfig`; without it every flag reads off. A job reads a flag once per mailbox run, not once per mail. Flags are not product settings: the mailbox mode and the per-category `auto` switches stay as they are (ADR 0027 point 6)."
      - "A flag is changed only through `setOrgFeature` (`tenancy`, audit row `org.flag_changed`); the CLI `org:flag` and a later console call it. A unit test fails when a flag is past its remove-by date: then a cleanup ticket removes the key from `FEATURES_OFF` on every server first (an unknown key stops the start), deletes its rows in a migration (`DELETE FROM org_features WHERE flag = '<key>'`), and removes the reads and the registry entry."
    - `docs/code-patterns.md` § HTTP routes, a new paragraph after the `refuseSuspendedWrites` paragraph:
      - "Routes under `/api/operator` are the only web code that reads across organizations (ADR 0027). `createApp` guards the whole prefix with `requireOperator`: only users in `OPERATOR_USER_IDS` pass; every other user, also an owner, gets the same `404 { error: "not_found" }` as an unknown path. The guard runs after `requireTenant`, so the operator is a member of an organization. Mount an operator router at `/operator`. A router never calls `use("*")` when it is mounted at `/`: Hono then runs it for every `/api` path. Every operator route test covers 401 (no session), 404 for an owner who is not an operator, and the operator's answer."
    - `.agents/limen/styleguide.md`:
      - § Shape, one bullet: "`/api/operator/*` is the only cross-organization web path; `requireOperator` in `createApp` guards the prefix (users in `OPERATOR_USER_IDS`, everyone else 404)."
      - § Prefer, one bullet: "A new user-visible behaviour reads `isFeatureOn(db, ctx, flag)`; the flag is in `packages/core/src/features.ts` with an owner epic and a remove-by date, default off, on for the pilot first. Change a flag only through `setOrgFeature`."
      - § Avoid, one bullet: "`use("*")` in a router mounted at `/` (it runs for every `/api` path); reading `FEATURES_OFF` or `OPERATOR_USER_IDS` outside `platform/config`."
    - `docs/known-alerts.md`, two entries with the template fields (First seen: the build day, "not seen live"; Status: `investigating (per case)` for the first, `won't fix` for the second, because a refusal is the expected answer):
      - `` `feature flags are not configured (configureFeatures was not called): every flag reads off` `` — Source `apps/server/src/modules/tenancy/features.ts`, level `warn`. Cause: an entry point read a flag without `configureFeatures` after `loadConfig`. Fix: add the call to that entry (`main.ts` has it); until then every flag reads off there.
      - `` `operator route refused for user <userId>` `` — Source `apps/server/src/platform/http.ts` (`requireOperator`), level `warn`. Cause: a signed-in user who is not in `OPERATOR_USER_IDS` called `/api/operator/*`. Fix: none for a single line; many lines for one user id mean someone probes the operator routes: check the user. If the user is the operator, add the id to `OPERATOR_USER_IDS` and restart.
  - Decisions: D6, D8, D9, D11, D15, D17.
  - Test: none (docs). The styleguide stays at or below 1000 lines (`wc -l .agents/limen/styleguide.md`).
  - Check: `bunx prettier --check docs/code-patterns.md .agents/limen/styleguide.md docs/known-alerts.md`; `wc -l .agents/limen/styleguide.md`.
  - Done when: the text is in the three files; every function name in the text exists in the code (`grep -rn "export async function setOrgFeature\|export const requireOperator\|export function configureFeatures\|export function resolveFeature" apps/server/src packages/core/src` finds four lines).
  - Out of scope: `spec/build.md`, `docs/product/stage-2/*`.

- [ ] **5.2 Architecture, modules and ADR 0027**
  - Goal: the reference docs describe the table, the CLI, the operator identity and the guard, and ADR 0027 is accepted.
  - Files:
    - change `docs/architecture.md` (§5 diagram and table, §7, §8);
    - change `docs/modules.md` §3.1 `tenancy`;
    - change `docs/decisions/0027-operator-role-and-feature-flags.md` (status line only).
  - Text to add:
    - `docs/architecture.md` §5: in the Mermaid `erDiagram`, the line `organizations ||--o{ org_features : "feature flags (F087)"`; in the table, a row `org_features` | `org_id, flag (a key of packages/core/src/features.ts), enabled, set_by (cli or a user id), set_at; primary key (org_id, flag); ON DELETE CASCADE. No row = the registry default` (match the column layout of the other rows).
    - `docs/architecture.md` §7, a bullet after "Tenant isolation": "**Operator (ADR 0027, F087):** the operator is a user whose id is in `OPERATOR_USER_IDS` (env only; a DB write cannot make an operator). Routes under `/api/operator` are the only web code that reads across organizations; `requireOperator` answers 404 to every other user, also an owner. Today there is one route, `GET /api/operator/flags` (organization ids, flag keys, on or off). The operator must be a member of an organization. The console page is E7."
    - `docs/architecture.md` §8, a bullet after "Plan state (S6a)": "**Feature flags (F087):** `bun run org:flag --org-id <uuid> [--flag <key> --on|--off]` lists or changes the flags of one organization (audit row `org.flag_changed`). `FEATURES_OFF` turns flags off for every organization at the next restart (kill switch); an unknown key stops the start. The start log line `features off by FEATURES_OFF: <keys|none>` shows it."
    - `docs/modules.md` §3.1: add `org_features` to **Owns**; a bullet "**Built in F087:** feature flags: `getOrgFeature`, `listOrgFeatureRows`, `upsertOrgFeature`, `listOrgFeatureRowsOfAll` (repo), `isFeatureOn`, `featureStates`, `featureStatesOfAll`, `configureFeatures` (`features.ts`), `setOrgFeature` (service, audit row `org.flag_changed`); CLI `bun run org:flag`; the operator route `GET /api/operator/flags` (`operator-routes.ts`, guarded by `requireOperator` in `platform/http.ts`). The registry is in `packages/core/src/features.ts`."
    - ADR 0027 status line: `- Status: accepted (<build day>). Landed by F087: the flag registry, \`org_features\`, \`FEATURES_OFF\`, \`isFeatureOn\`, \`org:flag\`, \`OPERATOR_USER_IDS\` and \`requireOperator\` with \`GET /api/operator/flags\`. Open (E7): the console page and the other operator routes, TOTP for the operator.`
  - Decisions: D5, D16–D18, D21.
  - Test: none (docs).
  - Check: `bunx prettier --check docs/architecture.md docs/modules.md docs/decisions/0027-operator-role-and-feature-flags.md`.
  - Done when: the four texts are in place; the Mermaid block still parses (no syntax change other than the one line).
  - Out of scope: `docs/product/stage-2/*` (the coordinator updates the epic and plan pages); `spec/build.md`.

## Done when

- Steps 5.1 and 5.2 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 05 (`/tmp/f087-s05`, with the six changed files) prints `PROOF_OK`.
