# s6a-customer-core — Stage 3

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A1, A4, "Differences found at collect" item 2 and "Rules for every step" first.

## Stage 3 — Badges, `/api/me` scope reasons, web texts, Telegram `/status` texts

Two steps. After this stage no user-visible text says "test mailbox".

- [ ] **3.1 Core and server: badge reasons without the address**
  - Goal: the mailbox badges and the `/api/me` scope infos say the new meaning of `all` (A4), and the server builds them without `TEST_MAILBOX_ADDRESS`.
  - Files: change `packages/core/src/web/mailboxes.ts` (`badgeReasons`, `ScopeEnv`, `badgeOf`, `mailboxScopeBadges`), `packages/core/src/web/mailboxes.test.ts`, `packages/core/src/web/me.ts` (`scopeReasons`, `scopeInfoOf`), `packages/core/src/web/me.test.ts`, `apps/server/src/modules/mail/views.ts:24`, `apps/server/src/modules/mail/views.test.ts`, `apps/server/src/web.ts:64-79` (`scopeInfos`, `scopeEnvOf`), `apps/server/test/integration/web-mailboxes.test.ts`, `apps/server/test/integration/web-me.test.ts` (only the expected reason values).
  - Interfaces:

    ```ts
    // packages/core/src/web/mailboxes.ts
    export const badgeReasons = [
      "env_off",
      "synthetic_only",
      "test_addresses_only",
      "all_mailboxes",
      "by_mode",
      "after_approval",
    ] as const;
    export interface ScopeEnv {
      triage: "off" | "synthetic" | "all";
      actions: "off" | "synthetic" | "all";
      send: "off" | "self" | "all";
    }
    export function mailboxScopeBadges(env: ScopeEnv): { triage: ScopeBadge; actions: ScopeBadge; send: ScopeBadge };
    // packages/core/src/web/me.ts
    export const scopeReasons = [
      "env_off",
      "synthetic_only",
      "test_addresses_only",
      "all_mailboxes",
      "by_mode",
      "after_approval",
    ] as const;
    export function scopeInfoOf(
      scope: "triage" | "actions" | "send",
      kind: "off" | "synthetic" | "self" | "all"
    ): ScopeInfo;
    ```

    `all` → `{ state: "on", reason }` (badge) and `{ kind: "all", reason }` (info) with `reason` = `all_mailboxes` for triage, `by_mode` for actions, `after_approval` for send. `off`, `synthetic`, `self` keep their reasons.
    `sameAddress` stays exported if another file uses it (grep); else remove it.

  - Decisions:
    - `views.ts` (`listMailboxViews`, `viewOf`, `views.ts:10,28`) and `getMailboxView` call `mailboxScopeBadges(env)`; the address argument goes. `MailRouteDeps.scopeEnv` keeps its name.
    - `web.ts`: `scopeEnvOf(config)` returns the three scope values only; `scopeInfos` calls `scopeInfoOf("triage", config.TRIAGE_LLM_SCOPE)` and so on.
    - The response schemas change their enums; the web build in 3.2 follows in the same stage, so `typecheck` passes at the stage commit (3.1 and 3.2 are one commit).
  - Test:
    1. `mailboxes.test.ts`: `mailboxScopeBadges({ triage: "all", actions: "all", send: "all" })` → `on/all_mailboxes`, `on/by_mode`, `on/after_approval`; `{ off, synthetic, self }` → as today. Delete the tests of `other_mailbox` and `test_mailbox_only`.
    2. `me.test.ts`: `scopeInfoOf("actions", "all")` → `{ kind: "all", reason: "by_mode" }`; `scopeInfoOf("send", "self")` → `test_addresses_only`; `scopeInfoOf("triage", "off")` → `env_off`.
    3. `views.test.ts`: add back the `all` entries that stage 1 removed (`{ kind: "all" }` in both scope lists); two mailboxes with different addresses under `all` get the same badges.
    4. `web-mailboxes.test.ts` / `web-me.test.ts`: the expected `reason` values follow (no other assertion changes).
  - Check: in 3.2.
  - Done when: in 3.2.
  - Out of scope: the web texts (3.2).

- [ ] **3.2 Web texts and Telegram `/status` texts**
  - Goal: the panel and `/status` say the new meaning (A4).
  - Files: change `apps/web/src/i18n/en.ts` (remove `reason_other_mailbox`; add `reason_by_mode`, `reason_after_approval`), `apps/web/src/lib/scope-text.ts` (`reasonKey`), `apps/web/src/lib/scope-text.test.ts`, `apps/server/src/modules/channels/commands.ts:53-68` (`SCOPE_TEXTS`, `ACTIONS_SCOPE_TEXTS`, `SEND_SCOPE_TEXTS`), `apps/server/test/integration/channels-commands.test.ts` (only expected `/status` texts, if a test asserts them).
  - Interfaces: `reasonKey(scope, reason)`: `env_off` → `envOffKeys[scope]`; `synthetic_only` → `reason_synthetic_only`; `test_addresses_only` → `reason_test_addresses_only`; `by_mode` → `reason_by_mode`; `after_approval` → `reason_after_approval`; `all_mailboxes` → `null`.
  - Decisions (texts, exact):
    - `reason_by_mode: "Mailbox changes follow the mode of each mailbox: none in shadow mode."`
    - `reason_after_approval: "A mail goes out only after an owner taps Send."`
    - `/status`: triage `all` → `"real mail of every active mailbox (TRIAGE_LLM_SCOPE=all)"`; actions `all` → `"real mail, by the mode of each mailbox (ACTIONS_SCOPE=all)"`; send `all` → `"real recipients, after an owner's tap (SEND_SCOPE=all)"`.
    - `ScopeBadges.tsx` does not change (it reads `badgeKey` and `reasonKeys`).
  - Test:
    1. `scope-text.test.ts`: all three `on` with the new reasons → `reasonKeys` = `["reason_by_mode", "reason_after_approval"]`; the env-off and self cases stay; delete the `other_mailbox` case.
    2. `channels-commands.test.ts`: `/status` under `all` holds "every active mailbox" and no "test mailbox" (if the file has a `/status` scope test; else add one with the existing `/status` helper).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int && bun run web:build && bun run test:e2e -- mailboxes.spec.ts`; then `grep -rni "test mailbox\|TEST_MAILBOX" apps/web/src packages/core/src/web apps/server/src/modules/channels apps/server/src/web.ts` → no match (paste it).
  - Done when: the checks pass and the grep is empty.
  - Out of scope: the consent line and the plan texts (stage 16).
