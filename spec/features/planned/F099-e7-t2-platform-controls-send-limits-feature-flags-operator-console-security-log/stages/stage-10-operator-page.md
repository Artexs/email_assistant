# F099 stage 10 — Operator page

Part of [`../plan.md`](../plan.md). Read its D15, D19, D22, D23, D29, "Rules for every stage" and `docs/code-patterns.md` § Web app first. Needs stages 06–08 (`me.operator`, `GET /api/operator/orgs`, `GET /api/operator/orgs/:orgId`, `GET /api/operator/notices`, the core schemas).

Two steps. About 300 changed lines. No server change.

- [ ] **10.1 Page, island and nav item**
  - Goal: an operator opens `/operator` from the nav and sees the organization list, the detail of one organization and the notice list.
  - Files:
    - add `apps/web/src/pages/operator.astro` (shape of `settings.astro`: `<App title={en.title_operator}><OperatorPage client:load /></App>`);
    - add `apps/web/src/islands/OperatorPage.tsx`;
    - add `apps/web/src/components/operator/OrgTable.tsx`, `OrgDetail.tsx`, `NoticeList.tsx`;
    - change `apps/web/src/components/shell/nav-items.ts` (`NavKey` gets `"operator"`; `OPERATOR_ITEM` with the lucide icon `ShieldCheck`, the shape of `ONBOARDING_ITEM`);
    - change `apps/web/src/components/shell/Nav.tsx` and `AppShell.tsx` (show `OPERATOR_ITEM` after the tabs, in the sidebar and in the phone menu, only when `me?.operator === true`);
    - change `apps/web/src/i18n/en.ts` (the `op_*` keys, `nav_operator`, `title_operator`); D29 for `pl.ts`.
  - Interfaces:
    - `OperatorPage` renders `<AppShell active="operator" title="title_operator">`. Inside: `useResource(() => api("/api/operator/orgs", operatorOrgListSchema), { pollMs: 60_000 })` and the same for `/api/operator/notices` (`operatorNoticesSchema`); a selected organization id in state; the detail through `useResource(() => api(\`/api/operator/orgs/${id}\`, operatorOrgDetailSchema), { pollMs: 60_000 })` when one is selected.
    - An API 404 (a non-operator who reached the page shell by a race) shows `t("op_not_found")` and nothing else.
    - `OrgTable` (shadcn `table`): one row per organization: short org id (first 8 characters, the full id in `title`), plan badge, trial end date, mailboxes `total / authError`, last sync (relative), failures 24 h (`sends` / `outbox`), LLM today (`calls`, cost as `$0.0000` with 4 decimals; `+ <n> unpriced` when `unpricedCalls > 0`). A row click selects the organization.
    - `OrgDetail` (`card`): the plan state, the mailbox list (id, status badge, `statusChangedAt`, `lastSyncedAt`), `lastRuns` (five lines), failures, LLM today, the flag list (key, on/off, source). Read only in this stage.
    - `NoticeList`: newest first; each line: time, org id (short), kind, key. A select of 1, 7 or 30 days changes `?days=`.
    - A "Reload" button reloads all three resources.
  - Decisions: D15 (the page shows only what the API gives: ids, codes, counts, dates), D19, D22 (the panel's polling pattern, 60 s), D23.
  - Test: unit tests of the pure helpers in step 10.2; the components have no own test (the repo tests web logic in `lib/`).
  - Check: `bun run typecheck`; `bun run lint` (`react/jsx-no-literals` holds for the new components); `bun run web:build`.
  - Done when: `bun run web:build` writes `dist/operator/index.html`; the nav shows the item only for `me.operator === true`.
  - Out of scope: writes (stage 11); a Polish text when `pl.ts` does not exist.

- [ ] **10.2 Pure view helpers with tests**
  - Goal: the formatting rules of the page are tested without a browser.
  - Files: add `apps/web/src/lib/operator-view.ts` and `apps/web/src/lib/operator-view.test.ts`.
  - Interfaces:

    ```ts
    // lib/operator-view.ts — pure
    export function shortId(id: string): string; // first 8 characters
    export function costText(costUsd: number): string; // `$${costUsd.toFixed(4)}`
    export function llmTodayText(llm: OperatorOrgRow["llmToday"]): string;
    //   t("op_llm_today", { calls, cost: costText(costUsd) }) + (unpricedCalls > 0 ? ` ${t("op_llm_unpriced", { count })}` : "")
    export function ageText(at: string | null, now: Date): string;
    //   null → t("op_never"); < 1 min → t("op_just_now"); < 60 min → t("op_minutes_ago", { count }); < 48 h → t("op_hours_ago", { count }); else t("op_days_ago", { count })
    export function sortNotices<T extends { at: string; orgId: string }>(rows: readonly T[]): T[]; // at desc, then orgId
    ```

  - Decisions: D15.
  - Test (`operator-view.test.ts`; `NOW = 2026-11-20T10:00:00Z`):
    1. `shortId("0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11")` = `"0b0f3b3e"`.
    2. `costText(0.06)` = `"$0.0600"`; `costText(0)` = `"$0.0000"`.
    3. `llmTodayText({ since, calls: 5, costUsd: 0.06, unpricedCalls: 2 })` holds `5`, `$0.0600` and `2`; with `unpricedCalls: 0` it holds no unpriced part.
    4. `ageText(null, NOW)` = `t("op_never")`; `ageText("2026-11-20T09:59:30Z", NOW)` = `t("op_just_now")`; `09:55Z` → 5 minutes; `08:00Z` → 2 hours; `2026-11-17T10:00:00Z` → 3 days.
    5. `sortNotices` orders by `at` desc, then `orgId` asc on equal `at`.
    6. Every `op_*` key that the helpers use exists in `en` (a loop over the list of keys).
  - Check: `bun test apps/web/src/lib/operator-view.test.ts apps/web/src/i18n`.
  - Done when: tests 1–6 pass.
  - Out of scope: component tests.

## Done when

- Steps 10.1 and 10.2 are done and committed by explicit paths.
- The web-stage Proof command of `plan.md` for stage 10 (`/tmp/f099-s10`, with `bun run web:build`) prints `PROOF_OK`.
